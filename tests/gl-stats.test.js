import test from 'node:test';
import assert from 'node:assert/strict';
import { bytesPerTexel, createGpuTimer, instrument, triangles } from '../src/core/gl-stats.js';

// WebGL enum values used below.
const GL = {
  POINTS: 0x0000, LINES: 0x0001, TRIANGLES: 0x0004, TRIANGLE_STRIP: 0x0005, TRIANGLE_FAN: 0x0006,
  FRAMEBUFFER: 0x8d40, DRAW_FRAMEBUFFER: 0x8ca9, READ_FRAMEBUFFER: 0x8ca8, RENDERBUFFER: 0x8d41,
  TEXTURE_2D: 0x0de1, TEXTURE_CUBE_MAP: 0x8513, TEXTURE_CUBE_MAP_POSITIVE_X: 0x8515, TEXTURE_2D_ARRAY: 0x8c1a, TEXTURE_3D: 0x806f,
  ARRAY_BUFFER: 0x8892, ELEMENT_ARRAY_BUFFER: 0x8893,
  RGBA: 0x1908, RGB: 0x1907, RGBA8: 0x8058, RGBA16F: 0x881a, RGBA32F: 0x8814, R8: 0x8229,
  DEPTH_COMPONENT24: 0x81a6, DEPTH24_STENCIL8: 0x88f0, DEPTH32F_STENCIL8: 0x8cad,
  UNSIGNED_BYTE: 0x1401, FLOAT: 0x1406, HALF_FLOAT: 0x140b, UNSIGNED_SHORT_5_6_5: 0x8363,
};
const BINDINGS = { [GL.TEXTURE_2D]: 0x8069, [GL.TEXTURE_CUBE_MAP]: 0x8514, [GL.TEXTURE_2D_ARRAY]: 0x8c1d, [GL.TEXTURE_3D]: 0x806a, [GL.RENDERBUFFER]: 0x8ca7, [GL.ARRAY_BUFFER]: 0x8894, [GL.ELEMENT_ARRAY_BUFFER]: 0x8895 };
const near = (actual, expected) => assert.ok(Math.abs(actual - expected) < 1e-6, `${actual} vs ${expected}`);

// A stand-in for a WebGL2 context: it only keeps the bindings that gl-stats.js queries.
function fakeContext({ antialias = false, width = 100, height = 50 } = {}) {
  const bound = new Map();
  const ext = { calls: 0 };
  for (const name of ['multiDrawArraysWEBGL', 'multiDrawElementsWEBGL', 'multiDrawArraysInstancedWEBGL', 'multiDrawElementsInstancedWEBGL']) {
    ext[name] = () => ext.calls++;
  }
  const gl = {
    drawingBufferWidth: width,
    drawingBufferHeight: height,
    getContextAttributes: () => ({ antialias, depth: true }),
    getParameter: (pname) => (pname === 0x80a9 ? 4 : bound.get(pname) ?? null),
    getExtension: (name) => (name === 'WEBGL_multi_draw' ? ext : null),
    bind: (target, object) => bound.set(BINDINGS[target], object),
    calls: [],
  };
  const methods = [
    'drawArrays', 'drawElements', 'drawArraysInstanced', 'drawElementsInstanced', 'drawRangeElements', 'clear', 'blitFramebuffer',
    'useProgram', 'linkProgram', 'deleteProgram', 'bindFramebuffer', 'texImage2D', 'texImage3D', 'copyTexImage2D',
    'compressedTexImage2D', 'texStorage2D', 'texStorage3D', 'generateMipmap', 'deleteTexture', 'framebufferTexture2D',
    'framebufferTextureLayer', 'renderbufferStorage', 'renderbufferStorageMultisample', 'deleteRenderbuffer', 'bufferData', 'deleteBuffer',
  ];
  for (const name of methods) gl[name] = (...args) => gl.calls.push([name, ...args]);
  return gl;
}

test('triangles per draw mode', () => {
  assert.equal(triangles(GL.TRIANGLES, 9), 3);
  assert.equal(triangles(GL.TRIANGLES, 10), 3);
  assert.equal(triangles(GL.TRIANGLE_STRIP, 6), 4);
  assert.equal(triangles(GL.TRIANGLE_FAN, 2), 0);
  assert.equal(triangles(GL.LINES, 100), 0);
  assert.equal(triangles(GL.TRIANGLES, 6, 50), 100);
});

test('bytes per texel for sized, unsized and packed formats', () => {
  assert.equal(bytesPerTexel(GL.RGBA8), 4);
  assert.equal(bytesPerTexel(GL.RGBA16F), 8);
  assert.equal(bytesPerTexel(GL.RGBA32F), 16);
  assert.equal(bytesPerTexel(GL.DEPTH24_STENCIL8), 4);
  assert.equal(bytesPerTexel(GL.DEPTH32F_STENCIL8), 8);
  assert.equal(bytesPerTexel(GL.RGBA, GL.RGBA, GL.UNSIGNED_BYTE), 4);
  assert.equal(bytesPerTexel(GL.RGBA, GL.RGBA, GL.FLOAT), 16);
  assert.equal(bytesPerTexel(GL.RGB, GL.RGB, GL.UNSIGNED_SHORT_5_6_5), 2);
});

test('draw calls and triangles are counted per frame, instancing included, and calls still reach the context', () => {
  const gl = fakeContext();
  const stats = instrument(gl);
  gl.drawArrays(GL.TRIANGLES, 0, 30);
  gl.drawElements(GL.TRIANGLE_STRIP, 12, GL.UNSIGNED_BYTE, 0);
  gl.drawElementsInstanced(GL.TRIANGLES, 6, GL.UNSIGNED_BYTE, 0, 1000);
  gl.drawArrays(GL.LINES, 0, 50);
  assert.deepEqual([stats.frame().drawCalls, stats.frame().triangles], [4, 10 + 10 + 2000]);
  assert.equal(gl.calls.filter(([name]) => name.startsWith('draw')).length, 4);
  stats.beginFrame();
  assert.deepEqual([stats.frame().drawCalls, stats.frame().triangles], [0, 0]);
});

test('a render pass is a run of drawing into one framebuffer', () => {
  const gl = fakeContext();
  const stats = instrument(gl);
  const [a, b] = [{ fb: 'a' }, { fb: 'b' }];
  gl.bindFramebuffer(GL.FRAMEBUFFER, a);
  gl.clear(0);
  gl.drawArrays(GL.TRIANGLES, 0, 3);
  gl.drawArrays(GL.TRIANGLES, 0, 3);
  gl.bindFramebuffer(GL.FRAMEBUFFER, b); // bound but never drawn into
  gl.bindFramebuffer(GL.FRAMEBUFFER, a);
  gl.drawArrays(GL.TRIANGLES, 0, 3);
  gl.bindFramebuffer(GL.READ_FRAMEBUFFER, a); // reading does not change where draws go
  gl.bindFramebuffer(GL.DRAW_FRAMEBUFFER, null);
  gl.blitFramebuffer();
  gl.drawArrays(GL.TRIANGLES, 0, 3);
  assert.deepEqual([stats.frame().passes, stats.frame().blits], [2, 1]);
  stats.beginFrame();
  gl.drawArrays(GL.TRIANGLES, 0, 3);
  assert.equal(stats.frame().passes, 1, 'every frame starts a new pass');
});

test('programs: used this frame, and linked minus deleted', () => {
  const gl = fakeContext();
  const stats = instrument(gl);
  const [p, q, r] = [{}, {}, {}];
  for (const program of [p, q, r]) gl.linkProgram(program);
  gl.linkProgram(p); // relinking is not a new program
  gl.deleteProgram(r);
  gl.useProgram(p);
  gl.useProgram(q);
  gl.useProgram(p);
  assert.equal(stats.frame().programsUsed, 2);
  assert.equal(stats.memory().programs, 2);
});

test('texture memory follows uploads, storage, mipmaps and deletes', () => {
  const gl = fakeContext({ width: 0, height: 0 });
  const stats = instrument(gl);
  const [a, b, c, d] = [{}, {}, {}, {}];

  gl.bind(GL.TEXTURE_2D, a);
  gl.texImage2D(GL.TEXTURE_2D, 0, GL.RGBA8, 256, 256, 0, GL.RGBA, GL.UNSIGNED_BYTE, null);
  gl.texImage2D(GL.TEXTURE_2D, 0, GL.RGBA8, 256, 256, 0, GL.RGBA, GL.UNSIGNED_BYTE, null); // re-upload replaces
  assert.equal(stats.memory().textureBytes, 256 * 256 * 4);
  gl.generateMipmap(GL.TEXTURE_2D);
  near(stats.memory().textureBytes, (256 * 256 * 4 * 4) / 3);

  gl.bind(GL.TEXTURE_2D, b);
  gl.texImage2D(GL.TEXTURE_2D, 0, GL.RGBA, GL.RGBA, GL.UNSIGNED_BYTE, { width: 10, height: 20 }); // image source
  gl.bind(GL.TEXTURE_CUBE_MAP, c);
  gl.texStorage2D(GL.TEXTURE_CUBE_MAP, 2, GL.RGBA16F, 64, 64);
  gl.bind(GL.TEXTURE_2D_ARRAY, d);
  gl.texStorage3D(GL.TEXTURE_2D_ARRAY, 1, GL.R8, 32, 32, 8);
  const expected = (256 * 256 * 4 * 4) / 3 + 10 * 20 * 4 + 6 * (64 * 64 + 32 * 32) * 8 + 32 * 32 * 8;
  near(stats.memory().textureBytes, expected);

  gl.deleteTexture(a);
  near(stats.memory().textureBytes, expected - (256 * 256 * 4 * 4) / 3);
});

test('textures drawn into, renderbuffers and the canvas count as render targets', () => {
  const gl = fakeContext({ antialias: true, width: 100, height: 50 });
  const stats = instrument(gl);
  const canvas = 100 * 50 * (4 + 4) * 4 + 100 * 50 * 4; // colour + depth per sample, plus the resolve
  assert.equal(stats.memory().renderTargetBytes, canvas);

  const [colour, depth] = [{}, {}];
  gl.bind(GL.TEXTURE_2D, colour);
  gl.texStorage2D(GL.TEXTURE_2D, 1, GL.RGBA16F, 1024, 512);
  gl.framebufferTexture2D(GL.FRAMEBUFFER, 0x8ce0, GL.TEXTURE_2D, colour, 0);
  gl.bind(GL.RENDERBUFFER, depth);
  gl.renderbufferStorageMultisample(GL.RENDERBUFFER, 4, GL.DEPTH24_STENCIL8, 1024, 512);
  const memory = stats.memory();
  assert.equal(memory.textureBytes, 0);
  assert.equal(memory.renderTargetBytes, canvas + 1024 * 512 * 8 + 1024 * 512 * 4 * 4);
  assert.equal(memory.canvasBytes, canvas);

  gl.deleteRenderbuffer(depth);
  assert.equal(stats.memory().renderTargetBytes, canvas + 1024 * 512 * 8);
});

test('buffer memory follows bufferData by size or by data', () => {
  const gl = fakeContext();
  const stats = instrument(gl);
  const [a, b] = [{}, {}];
  gl.bind(GL.ARRAY_BUFFER, a);
  gl.bufferData(GL.ARRAY_BUFFER, new Float32Array(100), 0);
  gl.bind(GL.ELEMENT_ARRAY_BUFFER, b);
  gl.bufferData(GL.ELEMENT_ARRAY_BUFFER, 64, 0);
  assert.equal(stats.memory().bufferBytes, 400 + 64);
  gl.bufferData(GL.ELEMENT_ARRAY_BUFFER, new Uint16Array(50), 0, 10, 20); // srcOffset 10, length 20
  assert.equal(stats.memory().bufferBytes, 400 + 40);
  gl.deleteBuffer(a);
  assert.equal(stats.memory().bufferBytes, 40);
});

test('a multi-draw is one draw call with all its triangles', () => {
  const gl = fakeContext();
  const stats = instrument(gl);
  const ext = gl.getExtension('WEBGL_multi_draw');
  assert.equal(gl.getExtension('WEBGL_multi_draw'), ext, 'wrapped once');
  ext.multiDrawArraysWEBGL(GL.TRIANGLES, [0, 0, 0], 0, [3, 6, 9], 0, 3);
  ext.multiDrawElementsInstancedWEBGL(GL.TRIANGLES, [0, 3, 6], 1, GL.UNSIGNED_BYTE, [0, 0, 0], 0, [9, 2, 10], 1, 2);
  assert.deepEqual([stats.frame().drawCalls, stats.frame().triangles], [2, 6 + (1 * 2 + 2 * 10)]);
  assert.equal(ext.calls, 2);
});

test('the GPU timer returns finished spans in order and drops disjoint ones', () => {
  const ext = { TIME_ELAPSED_EXT: 1, GPU_DISJOINT_EXT: 2 };
  let disjoint = false;
  const queries = [];
  const gl = {
    QUERY_RESULT_AVAILABLE: 3,
    QUERY_RESULT: 4,
    getExtension: (name) => (name === 'EXT_disjoint_timer_query_webgl2' ? ext : null),
    createQuery: () => {
      const query = { ready: false, ns: 1e6 * (queries.length + 1) };
      queries.push(query);
      return query;
    },
    beginQuery() {},
    endQuery() {},
    deleteQuery() {},
    getParameter: (pname) => (pname === ext.GPU_DISJOINT_EXT ? disjoint : null),
    getQueryParameter: (query, pname) => (pname === 3 ? query.ready : query.ns),
  };
  const timer = createGpuTimer(gl);
  for (let i = 0; i < 3; i++) {
    timer.begin();
    timer.end();
  }
  assert.deepEqual(timer.poll(), []);
  queries[1].ready = true; // finished out of order: waits for the first
  assert.deepEqual(timer.poll(), []);
  queries[0].ready = true;
  assert.deepEqual(timer.poll(), [1, 2]);
  queries[2].ready = true;
  disjoint = true;
  assert.deepEqual(timer.poll(), []);
  assert.equal(timer.pending, 0);
  assert.equal(createGpuTimer({ getExtension: () => null }), null);
});
