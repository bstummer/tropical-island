// Counts what the GPU is asked to do by wrapping the WebGL2 context's methods,
// so it sees every call three.js makes, internal passes included. Per frame:
// draw calls, triangles, render passes (runs of drawing into one framebuffer),
// framebuffer blits and programs used. Live: the memory of textures, render
// targets (textures drawn into, renderbuffers, the canvas) and buffers, and
// the number of linked programs. Byte counts are estimates of what the driver
// allocates, before any padding it adds.
//
// No browser APIs at import time, so tests/gl-stats.test.js runs it on a fake context.

// WebGL enum values (fixed by the spec).
const TRIANGLES = 0x0004;
const TRIANGLE_STRIP = 0x0005;
const TRIANGLE_FAN = 0x0006;
const FRAMEBUFFER = 0x8d40;
const DRAW_FRAMEBUFFER = 0x8ca9;
const TEXTURE_CUBE_MAP = 0x8513;
const SAMPLES = 0x80a9;

const BINDING = {
  0x0de1: 0x8069, // TEXTURE_2D
  0x8513: 0x8514, // TEXTURE_CUBE_MAP
  0x806f: 0x806a, // TEXTURE_3D
  0x8c1a: 0x8c1d, // TEXTURE_2D_ARRAY
  0x8d41: 0x8ca7, // RENDERBUFFER
  0x8892: 0x8894, // ARRAY_BUFFER
  0x8893: 0x8895, // ELEMENT_ARRAY_BUFFER
  0x8a11: 0x8a28, // UNIFORM_BUFFER
  0x8f36: 0x8f36, // COPY_READ_BUFFER
  0x8f37: 0x8f37, // COPY_WRITE_BUFFER
  0x88eb: 0x88ed, // PIXEL_PACK_BUFFER
  0x88ec: 0x88ef, // PIXEL_UNPACK_BUFFER
  0x8c8e: 0x8c8f, // TRANSFORM_FEEDBACK_BUFFER
};
for (let face = 0x8515; face <= 0x851a; face++) BINDING[face] = 0x8514; // cube map faces

// Bytes per texel of sized internal formats.
const SIZED = {
  1: [0x8229, 0x8f94, 0x8232, 0x8231, 0x8d48], // R8, R8_SNORM, R8UI, R8I, STENCIL_INDEX8
  2: [0x822d, 0x8234, 0x8233, 0x822b, 0x8f95, 0x8238, 0x8237, 0x8d62, 0x8057, 0x8056, 0x81a5], // R16F/UI/I, RG8 variants, RGB565, RGB5_A1, RGBA4, DEPTH16
  3: [0x8051, 0x8c41, 0x8f96, 0x8d7d, 0x8d8f], // RGB8, SRGB8, RGB8_SNORM, RGB8UI, RGB8I
  4: [0x822e, 0x8236, 0x8235, 0x822f, 0x823a, 0x8239, 0x8c3a, 0x8c3d, 0x8058, 0x8c43, 0x8f97, 0x8059, 0x8d7c, 0x8d8e, 0x906f, 0x81a6, 0x8cac, 0x88f0],
  6: [0x881b, 0x8d77, 0x8d89], // RGB16F/UI/I
  8: [0x8230, 0x823c, 0x823b, 0x881a, 0x8d76, 0x8d88, 0x8cad], // RG32F/UI/I, RGBA16F/UI/I, DEPTH32F_STENCIL8
  12: [0x8815, 0x8d71, 0x8d83], // RGB32F/UI/I
  16: [0x8814, 0x8d82, 0x8d70], // RGBA32F/I/UI
};
const SIZED_BYTES = new Map(Object.entries(SIZED).flatMap(([bytes, formats]) => formats.map((f) => [f, Number(bytes)])));
// Unsized formats: channels; types: bytes per channel, or per texel for packed types.
const CHANNELS = { 0x1906: 1, 0x1907: 3, 0x1908: 4, 0x1909: 1, 0x190a: 2, 0x1903: 1, 0x8227: 2, 0x1902: 1, 0x84f9: 1 };
const TYPE_BYTES = { 0x1400: 1, 0x1401: 1, 0x1402: 2, 0x1403: 2, 0x1404: 4, 0x1405: 4, 0x1406: 4, 0x140b: 2 };
const PACKED_BYTES = { 0x8363: 2, 0x8033: 2, 0x8034: 2, 0x84fa: 4, 0x8368: 4, 0x8c3b: 4, 0x8c3e: 4, 0x8dad: 8 };

export function bytesPerTexel(internalformat, format, type) {
  if (SIZED_BYTES.has(internalformat)) return SIZED_BYTES.get(internalformat);
  if (PACKED_BYTES[type]) return PACKED_BYTES[type];
  return (CHANNELS[format ?? internalformat] ?? 4) * (TYPE_BYTES[type] ?? 1);
}

export function triangles(mode, count, instances = 1) {
  if (mode === TRIANGLES) return Math.floor(count / 3) * instances;
  if (mode === TRIANGLE_STRIP || mode === TRIANGLE_FAN) return Math.max(0, count - 2) * instances;
  return 0;
}

// GPU time of spans of work, where the browser exposes timer queries; null
// otherwise. Results arrive some frames later: poll() returns the spans that
// have finished since the last poll, in milliseconds, oldest first, and drops
// any the GPU marked as disjoint (unreliable).
export function createGpuTimer(gl) {
  const ext = gl.getExtension('EXT_disjoint_timer_query_webgl2');
  if (!ext) return null;
  const pending = [];
  return {
    begin() {
      const query = gl.createQuery();
      gl.beginQuery(ext.TIME_ELAPSED_EXT, query);
      pending.push(query);
    },
    end() {
      gl.endQuery(ext.TIME_ELAPSED_EXT);
    },
    poll() {
      const done = [];
      const disjoint = gl.getParameter(ext.GPU_DISJOINT_EXT);
      while (pending.length && gl.getQueryParameter(pending[0], gl.QUERY_RESULT_AVAILABLE)) {
        const query = pending.shift();
        if (!disjoint) done.push(gl.getQueryParameter(query, gl.QUERY_RESULT) / 1e6);
        gl.deleteQuery(query);
      }
      return done;
    },
    get pending() {
      return pending.length;
    },
  };
}

// WebGL object kinds whose live count teardown checks compare: created and not yet deleted.
const OBJECTS = ['Texture', 'Buffer', 'Framebuffer', 'Renderbuffer', 'Program', 'Shader', 'VertexArray', 'Query', 'Sampler'];

export function instrument(gl) {
  let frame;
  let last;
  let passTarget;
  let drawTarget = null;
  const programs = new Set(); // linked and not deleted
  const textures = new Map(); // texture -> { levels: Map<key, bytes>, renderTarget }
  const renderbuffers = new Map(); // renderbuffer -> bytes
  const buffers = new Map(); // buffer -> bytes
  const live = Object.fromEntries(OBJECTS.map((kind) => [kind, new Set()]));

  // Measured once while the default framebuffer is bound: the canvas's MSAA samples.
  const attributes = gl.getContextAttributes();
  const canvasSamples = attributes.antialias ? Math.max(1, gl.getParameter(SAMPLES)) : 1;

  // Per-frame GPU time, measured only while someone listens (onGpuTime).
  const timer = createGpuTimer(gl);
  const gpuListeners = new Set();
  let timing = false;

  function beginFrame() {
    if (frame) {
      const { programs: used, ...counts } = frame;
      last = { ...counts, programsUsed: used.size };
    }
    frame = { drawCalls: 0, triangles: 0, passes: 0, blits: 0, programs: new Set() };
    passTarget = undefined;
    timing = Boolean(timer && gpuListeners.size);
    if (timing) timer.begin();
  }

  function endFrame() {
    if (timing) timer.end();
    timing = false;
    if (timer?.pending) {
      for (const ms of timer.poll()) for (const fn of gpuListeners) fn(ms);
    }
  }

  function draw(mode, count, instances) {
    frame.drawCalls++;
    frame.triangles += triangles(mode, count, instances);
    touchTarget();
  }

  function touchTarget() {
    if (drawTarget !== passTarget) {
      frame.passes++;
      passTarget = drawTarget;
    }
  }

  const bound = (target) => gl.getParameter(BINDING[target]);

  function texture(target) {
    const tex = bound(target);
    if (!tex) return null;
    if (!textures.has(tex)) textures.set(tex, { levels: new Map(), renderTarget: false });
    return textures.get(tex);
  }

  const wrap = (object, name, before) => {
    const original = object[name];
    if (typeof original !== 'function') return;
    object[name] = function (...args) {
      before(...args);
      return original.apply(object, args);
    };
  };

  for (const kind of OBJECTS) {
    const create = gl[`create${kind}`];
    if (typeof create !== 'function') continue;
    gl[`create${kind}`] = function (...args) {
      const object = create.apply(gl, args);
      if (object) live[kind].add(object);
      return object;
    };
    wrap(gl, `delete${kind}`, (object) => live[kind].delete(object));
  }

  wrap(gl, 'drawArrays', (mode, first, count) => draw(mode, count, 1));
  wrap(gl, 'drawElements', (mode, count) => draw(mode, count, 1));
  wrap(gl, 'drawArraysInstanced', (mode, first, count, instances) => draw(mode, count, instances));
  wrap(gl, 'drawElementsInstanced', (mode, count, type, offset, instances) => draw(mode, count, instances));
  wrap(gl, 'drawRangeElements', (mode, start, end, count) => draw(mode, count, 1));
  wrap(gl, 'clear', () => touchTarget());
  wrap(gl, 'blitFramebuffer', () => frame.blits++);
  wrap(gl, 'useProgram', (program) => program && frame.programs.add(program));
  wrap(gl, 'linkProgram', (program) => programs.add(program));
  wrap(gl, 'deleteProgram', (program) => programs.delete(program));
  wrap(gl, 'bindFramebuffer', (target, framebuffer) => {
    if (target === FRAMEBUFFER || target === DRAW_FRAMEBUFFER) drawTarget = framebuffer;
  });

  wrap(gl, 'texImage2D', (target, level, internalformat, ...rest) => {
    // (target, level, internalformat, width, height, border, format, type, ...) or
    // (target, level, internalformat, format, type, source)
    const [width, height, format, type] =
      rest.length >= 5 ? [rest[0], rest[1], rest[3], rest[4]] : [rest[2]?.width ?? rest[2]?.videoWidth, rest[2]?.height ?? rest[2]?.videoHeight, rest[0], rest[1]];
    texture(target)?.levels.set(`${target}:${level}`, (width ?? 0) * (height ?? 0) * bytesPerTexel(internalformat, format, type));
  });
  wrap(gl, 'texImage3D', (target, level, internalformat, width, height, depth, border, format, type) => {
    texture(target)?.levels.set(`${target}:${level}`, width * height * depth * bytesPerTexel(internalformat, format, type));
  });
  wrap(gl, 'copyTexImage2D', (target, level, internalformat, x, y, width, height) => {
    texture(target)?.levels.set(`${target}:${level}`, width * height * bytesPerTexel(internalformat));
  });
  wrap(gl, 'compressedTexImage2D', (target, level, internalformat, width, height, border, data) => {
    texture(target)?.levels.set(`${target}:${level}`, typeof data === 'number' ? data : (data?.byteLength ?? 0));
  });
  wrap(gl, 'texStorage2D', (target, levels, internalformat, width, height) => {
    let bytes = 0;
    for (let l = 0; l < levels; l++) bytes += Math.max(1, width >> l) * Math.max(1, height >> l) * bytesPerTexel(internalformat);
    texture(target)?.levels.set('storage', bytes * (target === TEXTURE_CUBE_MAP ? 6 : 1));
  });
  wrap(gl, 'texStorage3D', (target, levels, internalformat, width, height, depth) => {
    let bytes = 0;
    for (let l = 0; l < levels; l++) {
      const layers = target === 0x806f ? Math.max(1, depth >> l) : depth; // 3D textures shrink in depth too
      bytes += Math.max(1, width >> l) * Math.max(1, height >> l) * layers * bytesPerTexel(internalformat);
    }
    texture(target)?.levels.set('storage', bytes);
  });
  wrap(gl, 'generateMipmap', (target) => {
    const entry = texture(target);
    if (!entry || entry.levels.has('storage')) return;
    // Level 0 of every face (a cube map's six are stored under their own targets).
    let base = 0;
    for (const [key, bytes] of entry.levels) if (key.endsWith(':0')) base += bytes;
    if (base) entry.levels.set('mipmaps', base / 3); // the rest of the chain
  });
  wrap(gl, 'deleteTexture', (tex) => textures.delete(tex));
  const markTarget = (tex) => {
    if (tex && textures.has(tex)) textures.get(tex).renderTarget = true;
  };
  wrap(gl, 'framebufferTexture2D', (target, attachment, textarget, tex) => markTarget(tex));
  wrap(gl, 'framebufferTextureLayer', (target, attachment, tex) => markTarget(tex));

  const storeRenderbuffer = (target, samples, internalformat, width, height) => {
    const rb = bound(target);
    if (rb) renderbuffers.set(rb, width * height * bytesPerTexel(internalformat) * Math.max(1, samples));
  };
  wrap(gl, 'renderbufferStorage', (target, internalformat, width, height) => storeRenderbuffer(target, 1, internalformat, width, height));
  wrap(gl, 'renderbufferStorageMultisample', storeRenderbuffer);
  wrap(gl, 'deleteRenderbuffer', (rb) => renderbuffers.delete(rb));

  wrap(gl, 'bufferData', (target, data, usage, offset = 0, length = 0) => {
    const buffer = bound(target);
    if (!buffer) return;
    const element = data?.BYTES_PER_ELEMENT ?? 1;
    buffers.set(buffer, typeof data === 'number' ? data : length ? length * element : (data?.byteLength ?? 0) - offset * element);
  });
  wrap(gl, 'deleteBuffer', (buffer) => buffers.delete(buffer));

  // three.js asks for its extensions once, at startup; count multi-draws as one call each.
  const getExtension = gl.getExtension;
  gl.getExtension = function (name) {
    const ext = getExtension.call(gl, name);
    if (ext && name === 'WEBGL_multi_draw' && !ext.counted) {
      const sum = (list, offset, n, mode, instances) => {
        let total = 0;
        for (let i = 0; i < n; i++) total += triangles(mode, list[offset + i], instances ? instances[i] : 1);
        return total;
      };
      const multi = (mode, tris) => {
        frame.drawCalls++;
        frame.triangles += tris;
        touchTarget();
      };
      wrap(ext, 'multiDrawArraysWEBGL', (mode, firsts, fo, counts, co, n) => multi(mode, sum(counts, co, n, mode)));
      wrap(ext, 'multiDrawElementsWEBGL', (mode, counts, co, type, offsets, oo, n) => multi(mode, sum(counts, co, n, mode)));
      wrap(ext, 'multiDrawArraysInstancedWEBGL', (mode, firsts, fo, counts, co, inst, io, n) =>
        multi(mode, sum(counts, co, n, mode, inst.slice(io, io + n))),
      );
      wrap(ext, 'multiDrawElementsInstancedWEBGL', (mode, counts, co, type, offsets, oo, inst, io, n) =>
        multi(mode, sum(counts, co, n, mode, inst.slice(io, io + n))),
      );
      ext.counted = true;
    }
    return ext;
  };

  beginFrame();

  return {
    // Call at the start and the end of every frame.
    beginFrame,
    endFrame,
    // Counts since the last beginFrame().
    frame() {
      const { programs: used, ...counts } = frame;
      return { ...counts, programsUsed: used.size };
    },
    // Counts of the last finished frame (for anything that reads them mid-frame).
    lastFrame() {
      return last ?? this.frame();
    },
    // fn(ms) with each frame's GPU time, a few frames late, while it listens.
    // Returns a remover, or null when the browser has no timer queries.
    onGpuTime(fn) {
      if (!timer) return null;
      gpuListeners.add(fn);
      return () => gpuListeners.delete(fn);
    },
    // Live WebGL objects by kind: { Texture: n, Buffer: n, ... }.
    objects() {
      return Object.fromEntries(OBJECTS.map((kind) => [kind, live[kind].size]));
    },
    memory() {
      let textureBytes = 0;
      let renderTargetBytes = 0;
      for (const { levels, renderTarget } of textures.values()) {
        let bytes = 0;
        for (const b of levels.values()) bytes += b;
        if (renderTarget) renderTargetBytes += bytes;
        else textureBytes += bytes;
      }
      for (const bytes of renderbuffers.values()) renderTargetBytes += bytes;
      // The canvas: colour and depth per sample, plus the resolved colour when multisampled.
      const pixels = gl.drawingBufferWidth * gl.drawingBufferHeight;
      const canvasBytes = pixels * (4 + (attributes.depth ? 4 : 0)) * canvasSamples + (canvasSamples > 1 ? pixels * 4 : 0);
      let bufferBytes = 0;
      for (const bytes of buffers.values()) bufferBytes += bytes;
      return { textureBytes, renderTargetBytes: renderTargetBytes + canvasBytes, canvasBytes, bufferBytes, programs: programs.size };
    },
  };
}
