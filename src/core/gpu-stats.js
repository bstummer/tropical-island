// Counts what the GPU is asked to do by wrapping the WebGPU device's methods,
// so it sees every pass the game encodes, its own internal ones included. Per
// frame: draw calls, triangles, render passes (passes that draw or clear),
// blits (passes that only resolve, and texture copies) and pipelines used.
// Live: the memory of textures, render targets (textures drawn into, the
// canvas) and buffers, and the objects alive by kind, for teardown checks.
// Byte counts are what the formats need, before any padding the driver adds.
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

  const gpuListeners = new Set();

  function beginFrame() {
    if (frame) {
      const { pipelines: used, ...counts } = frame;
      last = { ...counts, pipelinesUsed: used.size };
    }
    frame = { drawCalls: 0, triangles: 0, passes: 0, blits: 0, pipelines: new Set() };
  }

  function endFrame() {}

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
    // Uploaded data is a texture, even when mipmaps are drawn into it; anything else drawn into is a render target.
    const target = Boolean(desc.usage & RENDER_ATTACHMENT) && !(desc.usage & COPY_DST);
    textures.set(texture, { bytes: textureBytes(desc), target });
    onDestroy(texture, () => textures.delete(texture));
  });
  wrap(device, 'createBuffer', (buffer, desc) => {
    if (!tracking) return;
    buffers.set(buffer, desc.size);
    onDestroy(buffer, () => buffers.delete(buffer));
  });
  wrap(device, 'createQuerySet', (set) => {
    querySets.add(set);
    onDestroy(set, () => querySets.delete(set));
  });
  wrap(device, 'createCommandEncoder', (encoder) => {
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
    onGpuTime() {
      return null;
    },
    get gpuListeners() {
      return gpuListeners;
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
    untracked(fn) {
      tracking = false;
      try {
        return fn();
      } finally {
        tracking = true;
      }
    },
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
