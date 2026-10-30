// Counts what the GPU is asked to do by wrapping the WebGPU device's methods,
// so it sees every pass the game encodes, its own internal ones included. Per
// frame: draw calls, triangles, render passes (passes that draw or clear),
// blits (passes that only resolve, and texture copies) and pipelines used.
// Only render passes and their draw()/drawIndexed() count, and compute passes
// apart: render bundles and indirect draws need counting here before anything
// uses them.
// Live: the memory of textures (content: uploaded, or drawn once with its mip
// chain), render targets (what the game draws into as it runs, and the canvas)
// and buffers, and the objects alive by kind, for teardown checks.
// Byte counts are what the formats need, before any padding the driver adds.
// GPU time, where the device has timestamp queries: how long the frame's passes
// ran, each from its start to its end, a few frames late. The gaps between
// them don't count: each pass is submitted as soon as it is encoded, and the
// GPU waits there for the CPU, which WebGL's single stream of a frame hid.
//
// No browser APIs at import time, so tests/gpu-stats.test.js runs it on a fake device.

// Bytes per texel (per sample) of the formats the game uses.
const TEXEL_BYTES = {
  r8unorm: 1,
  r16float: 2,
  r32float: 4,
  rg16float: 4,
  rgba8unorm: 4,
  bgra8unorm: 4,
  rgba16float: 8,
  rg32float: 8,
  rgba32float: 16,
  depth32float: 4,
  depth24plus: 4,
};
const RENDER_ATTACHMENT = 0x10; // GPUTextureUsage, fixed by the spec
const COPY_DST = 0x02;

export function bytesPerTexel(format) {
  return TEXEL_BYTES[format] ?? 4;
}

// Bytes of a texture with all its mip levels and samples: 3D textures shrink in depth too.
export function textureBytes({ size, format, mipLevelCount = 1, sampleCount = 1, dimension = '2d' }) {
  const [width, height = 1, layers = 1] = Array.isArray(size) ? size : [size.width, size.height ?? 1, size.depthOrArrayLayers ?? 1];
  let bytes = 0;
  for (let l = 0; l < mipLevelCount; l++) {
    const depth = dimension === '3d' ? Math.max(1, layers >> l) : layers;
    bytes += Math.max(1, width >> l) * Math.max(1, height >> l) * depth;
  }
  return bytes * bytesPerTexel(format) * sampleCount;
}

// Triangles of a draw of `count` vertices or indices: the game draws triangle lists only.
export function triangles(count, instances = 1) {
  return Math.floor(count / 3) * instances;
}

export function instrument(device) {
  let frame;
  let last;
  let tracking = true;
  const textures = new Map(); // GPUTexture -> { bytes, target }
  const buffers = new Map(); // GPUBuffer -> bytes
  const querySets = new Set();
  const pipelines = new Set(); // created and not released by the renderer
  let canvas = { width: 0, height: 0, bytesPerTexel: 4 };

  const timer = createGpuTimer(device, (fn) => untracked(fn));

  function beginFrame() {
    if (frame) {
      const { pipelines: used, ...counts } = frame;
      last = { ...counts, pipelinesUsed: used.size };
    }
    frame = { drawCalls: 0, triangles: 0, passes: 0, blits: 0, computePasses: 0, pipelines: new Set() };
    timer?.begin();
  }

  function endFrame() {
    timer?.end();
  }

  function untracked(fn) {
    tracking = false;
    try {
      return fn();
    } finally {
      tracking = true;
    }
  }

  const wrap = (object, name, after) => {
    const original = object[name];
    object[name] = function (...args) {
      const result = original.apply(object, args);
      after(result, ...args);
      return result;
    };
  };
  const onDestroy = (object, fn) => {
    const destroy = object.destroy;
    object.destroy = function () {
      fn();
      return destroy.call(object);
    };
  };

  wrap(device, 'createTexture', (texture, desc) => {
    if (!tracking) return;
    // Content is a texture: uploaded data, even when mipmaps are drawn into it, and
    // anything with a mip chain, drawn once and sampled from afar (src/textures/
    // makes the ground's tiles at boot). Anything else drawn into is a render
    // target: the frame's, the sky's tables, the rocks' offsets. A target with a
    // mip chain drawn every frame (a bloom pyramid) would need telling apart here.
    const target = Boolean(desc.usage & RENDER_ATTACHMENT) && !(desc.usage & COPY_DST) && (desc.mipLevelCount ?? 1) === 1;
    textures.set(texture, { bytes: textureBytes(desc), target });
    onDestroy(texture, () => textures.delete(texture));
  });
  wrap(device, 'createBuffer', (buffer, desc) => {
    if (!tracking) return;
    buffers.set(buffer, desc.size);
    onDestroy(buffer, () => buffers.delete(buffer));
  });
  wrap(device, 'createQuerySet', (set) => {
    if (!tracking) return;
    querySets.add(set);
    onDestroy(set, () => querySets.delete(set));
  });
  wrap(device, 'createCommandEncoder', (encoder) => {
    // A timed frame's passes write their timestamps (createGpuTimer).
    const begin = encoder.beginRenderPass;
    encoder.beginRenderPass = function (desc) {
      const writes = timer?.writes();
      return begin.call(encoder, writes ? { ...desc, timestampWrites: writes } : desc);
    };
    wrap(encoder, 'beginRenderPass', (pass, desc) => {
      let draws = 0;
      const draw = (count, instances = 1) => {
        draws++;
        frame.drawCalls++;
        frame.triangles += triangles(count, instances);
      };
      wrap(pass, 'draw', (_, count, instances) => draw(count, instances));
      wrap(pass, 'drawIndexed', (_, count, instances) => draw(count, instances));
      wrap(pass, 'setPipeline', (_, pipeline) => frame.pipelines.add(pipeline));
      const attachments = [...desc.colorAttachments.filter(Boolean), desc.depthStencilAttachment].filter(Boolean);
      const clears = attachments.some((a) => a.loadOp === 'clear' || a.depthLoadOp === 'clear');
      const resolves = desc.colorAttachments.some((a) => a?.resolveTarget);
      wrap(pass, 'end', () => {
        if (draws || clears) frame.passes++;
        else if (resolves) frame.blits++;
      });
    });
    wrap(encoder, 'copyTextureToTexture', () => frame.blits++);
    // Compute passes count apart, and take their share of the GPU's time.
    if (encoder.beginComputePass) {
      const beginCompute = encoder.beginComputePass;
      encoder.beginComputePass = function (desc = {}) {
        const writes = timer?.writes();
        frame.computePasses++;
        return beginCompute.call(encoder, writes ? { ...desc, timestampWrites: writes } : desc);
      };
    }
  });

  beginFrame();

  return {
    beginFrame,
    endFrame,
    // Counts since the last beginFrame().
    frame() {
      const { pipelines: used, ...counts } = frame;
      return { ...counts, pipelinesUsed: used.size };
    },
    // Counts of the last finished frame (for anything that reads them mid-frame).
    lastFrame() {
      return last ?? this.frame();
    },
    // fn(ms) with each frame's GPU time, a few frames late, while it listens.
    // Returns a remover, or null when the device has no timestamp queries.
    onGpuTime(fn) {
      return timer ? timer.listen(fn) : null;
    },
    // The renderer reports its pipelines: WebGPU can't destroy them, so they
    // live as long as something holds them.
    pipelineCreated(pipeline) {
      pipelines.add(pipeline);
    },
    pipelineReleased(pipeline) {
      pipelines.delete(pipeline);
    },
    // Runs fn without counting what it creates: the device's own lasting
    // objects (placeholders), which a teardown must not count as leaks.
    untracked,
    setCanvas(width, height, format) {
      canvas = { width, height, bytesPerTexel: bytesPerTexel(format) };
    },
    // Live objects by kind: { Texture: n, RenderTarget: n, Buffer: n, QuerySet: n, Pipeline: n }.
    objects() {
      let targets = 0;
      for (const { target } of textures.values()) if (target) targets++;
      return { Texture: textures.size - targets, RenderTarget: targets, Buffer: buffers.size, QuerySet: querySets.size, Pipeline: pipelines.size };
    },
    memory() {
      let textureBytes = 0;
      let renderTargetBytes = 0;
      for (const { bytes, target } of textures.values()) {
        if (target) renderTargetBytes += bytes;
        else textureBytes += bytes;
      }
      const canvasBytes = canvas.width * canvas.height * canvas.bytesPerTexel;
      let bufferBytes = 0;
      for (const bytes of buffers.values()) bufferBytes += bytes;
      return { textureBytes, renderTargetBytes: renderTargetBytes + canvasBytes, canvasBytes, bufferBytes, pipelines: pipelines.size };
    },
  };
}

// Times frames on the GPU while someone listens, or null without the
// timestamp-query feature: every pass writes when it begins and when it ends,
// then the stamps are resolved and read back, a few frames late, and the
// passes' durations summed. A pool of query sets, so frames in flight don't
// wait for each other. Frames without passes, or with more than MAX_TIMED_PASSES,
// report nothing. Sets as large as WebGPU allows (4096 queries), two stamps per
// pass: a frame that renders the sky's tables again runs 34 passes and more.
const MAX_TIMED_PASSES = 2048;

export function createGpuTimer(device, untracked) {
  if (!device.features?.has('timestamp-query')) return null;
  const listeners = new Set();
  const free = [];
  let current = null; // this frame's slot, while timing
  let passes = 0; // timed so far this frame; more than MAX_TIMED_PASSES: none count

  function slot() {
    return (
      free.pop() ??
      untracked(() => ({
        querySet: device.createQuerySet({ type: 'timestamp', count: 2 * MAX_TIMED_PASSES }),
        resolve: device.createBuffer({ size: 16 * MAX_TIMED_PASSES, usage: GPUBufferUsage.QUERY_RESOLVE | GPUBufferUsage.COPY_SRC }),
        read: device.createBuffer({ size: 16 * MAX_TIMED_PASSES, usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST }),
      }))
    );
  }

  return {
    begin() {
      current = listeners.size ? slot() : null;
      passes = 0;
    },
    // The timestampWrites for the pass about to begin, or undefined.
    writes() {
      if (!current || passes++ >= MAX_TIMED_PASSES) return undefined;
      return { querySet: current.querySet, beginningOfPassWriteIndex: 2 * passes - 2, endOfPassWriteIndex: 2 * passes - 1 };
    },
    end() {
      const done = current;
      current = null;
      if (!done) return;
      const n = passes;
      if (!n || n > MAX_TIMED_PASSES) {
        free.push(done);
        return;
      }
      const encoder = device.createCommandEncoder();
      encoder.resolveQuerySet(done.querySet, 0, 2 * n, done.resolve, 0);
      encoder.copyBufferToBuffer(done.resolve, 0, done.read, 0, 16 * n);
      device.queue.submit([encoder.finish()]);
      done.read.mapAsync(GPUMapMode.READ).then(
        () => {
          const stamps = new BigUint64Array(done.read.getMappedRange(0, 16 * n));
          let busy = 0n;
          for (let i = 0; i < n; i++) if (stamps[2 * i + 1] > stamps[2 * i]) busy += stamps[2 * i + 1] - stamps[2 * i];
          done.read.unmap();
          free.push(done);
          if (busy > 0n) for (const fn of listeners) fn(Number(busy) / 1e6);
        },
        () => {}, // the device went away meanwhile
      );
    },
    listen(fn) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
  };
}
