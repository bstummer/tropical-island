import test from 'node:test';
import assert from 'node:assert/strict';
import { bytesPerTexel, instrument, textureBytes, triangles } from '../src/core/gpu-stats.js';

// GPUTextureUsage values (fixed by the spec).
const USAGE = { COPY_SRC: 0x01, COPY_DST: 0x02, TEXTURE_BINDING: 0x04, RENDER_ATTACHMENT: 0x10 };

// A stand-in for a GPUDevice: records the calls that reach it.
function fakeDevice() {
  const calls = [];
  const object = (kind) => ({ kind, destroy: () => calls.push(['destroy', kind]) });
  const device = {
    calls,
    createTexture: () => object('texture'),
    createBuffer: () => object('buffer'),
    createQuerySet: () => object('querySet'),
    createCommandEncoder: () => ({
      beginRenderPass: () => {
        const pass = {};
        for (const name of ['draw', 'drawIndexed', 'setPipeline', 'end']) pass[name] = (...args) => calls.push([name, ...args]);
        return pass;
      },
      copyTextureToTexture: () => calls.push(['copy']),
    }),
  };
  return device;
}

const passDescriptor = ({ clear = false, depthClear = false, resolve = false } = {}) => ({
  colorAttachments: [{ loadOp: clear ? 'clear' : 'load', ...(resolve && { resolveTarget: {} }) }],
  depthStencilAttachment: { depthLoadOp: depthClear ? 'clear' : 'load' },
});

test('triangles of triangle lists, instancing included', () => {
  assert.equal(triangles(9), 3);
  assert.equal(triangles(10), 3);
  assert.equal(triangles(6, 50), 100);
});

test('texture bytes count every mip level, layer and sample; 3D levels shrink in depth', () => {
  assert.equal(bytesPerTexel('rgba16float'), 8);
  assert.equal(textureBytes({ size: [4, 4, 1], format: 'rgba8unorm' }), 64);
  assert.equal(textureBytes({ size: [4, 4, 1], format: 'rgba8unorm', mipLevelCount: 3 }), 4 * (16 + 4 + 1));
  assert.equal(textureBytes({ size: [4, 4, 5], format: 'r32float', mipLevelCount: 2 }), 4 * 5 * (16 + 4)); // an array keeps its layers
  assert.equal(textureBytes({ size: [4, 4, 4], format: 'r32float', mipLevelCount: 2, dimension: '3d' }), 4 * (64 + 8));
  assert.equal(textureBytes({ size: [10, 10, 1], format: 'depth32float', sampleCount: 4 }), 1600);
});

test('draw calls and triangles are counted per frame, and calls still reach the device', () => {
  const device = fakeDevice();
  const stats = instrument(device);
  const pass = device.createCommandEncoder().beginRenderPass(passDescriptor({ clear: true }));
  pass.setPipeline('a');
  pass.draw(30);
  pass.drawIndexed(6, 1000);
  pass.setPipeline('b');
  pass.setPipeline('a');
  pass.end();
  assert.deepEqual(stats.frame(), { drawCalls: 2, triangles: 10 + 2000, passes: 1, blits: 0, pipelinesUsed: 2 });
  assert.equal(device.calls.filter(([name]) => name.startsWith('draw')).length, 2);
  stats.beginFrame();
  assert.deepEqual(stats.frame(), { drawCalls: 0, triangles: 0, passes: 0, blits: 0, pipelinesUsed: 0 });
  assert.equal(stats.lastFrame().drawCalls, 2);
});

test('a pass counts when it draws or clears; one that only resolves, and a copy, are blits', () => {
  const device = fakeDevice();
  const stats = instrument(device);
  const encoder = device.createCommandEncoder();
  encoder.beginRenderPass(passDescriptor({ depthClear: true })).end(); // clears
  const drawing = encoder.beginRenderPass(passDescriptor());
  drawing.draw(3);
  drawing.end();
  encoder.beginRenderPass(passDescriptor()).end(); // nothing at all
  encoder.beginRenderPass(passDescriptor({ resolve: true })).end(); // resolves only
  encoder.copyTextureToTexture();
  assert.deepEqual([stats.frame().passes, stats.frame().blits], [2, 2]);
});

test('memory: uploaded textures, render targets, the canvas and buffers; destroyed ones are freed', () => {
  const device = fakeDevice();
  const stats = instrument(device);
  stats.setCanvas(100, 50, 'bgra8unorm');
  const data = device.createTexture({ size: [64, 64, 1], format: 'rgba8unorm', usage: USAGE.COPY_DST | USAGE.TEXTURE_BINDING | USAGE.RENDER_ATTACHMENT, mipLevelCount: 1 });
  const target = device.createTexture({ size: [100, 50, 1], format: 'rgba16float', sampleCount: 4, usage: USAGE.RENDER_ATTACHMENT });
  const buffer = device.createBuffer({ size: 4096 });
  let memory = stats.memory();
  assert.equal(memory.textureBytes, 64 * 64 * 4); // mipmaps drawn into it keep it a texture
  assert.equal(memory.canvasBytes, 100 * 50 * 4);
  assert.equal(memory.renderTargetBytes, 100 * 50 * 8 * 4 + memory.canvasBytes);
  assert.equal(memory.bufferBytes, 4096);
  assert.deepEqual(stats.objects(), { Texture: 1, RenderTarget: 1, Buffer: 1, QuerySet: 0, Pipeline: 0 });
  for (const object of [data, target, buffer]) object.destroy();
  memory = stats.memory();
  assert.deepEqual([memory.textureBytes, memory.renderTargetBytes - memory.canvasBytes, memory.bufferBytes], [0, 0, 0]);
  assert.equal(device.calls.filter(([name]) => name === 'destroy').length, 3);
});

test('objects made untracked and pipelines released leave the counts', () => {
  const device = fakeDevice();
  const stats = instrument(device);
  stats.untracked(() => device.createTexture({ size: [1, 1, 1], format: 'rgba8unorm', usage: USAGE.COPY_DST }));
  stats.pipelineCreated('p');
  stats.pipelineCreated('q');
  stats.pipelineReleased('p');
  assert.deepEqual(stats.objects(), { Texture: 0, RenderTarget: 0, Buffer: 0, QuerySet: 0, Pipeline: 1 });
  assert.equal(stats.memory().pipelines, 1);
});

test('the GPU timer times a frame from its first pass to its last, while someone listens', async () => {
  globalThis.GPUBufferUsage ??= { MAP_READ: 1, COPY_DST: 8, COPY_SRC: 4, QUERY_RESOLVE: 512 };
  globalThis.GPUMapMode ??= { READ: 1 };
  const stamps = [1000000n, 3500000n]; // ns: 2.5 ms apart
  const device = fakeDevice();
  device.features = new Set(['timestamp-query']);
  device.createQuerySet = () => ({ destroy() {} });
  device.createBuffer = () => ({ mapAsync: () => Promise.resolve(), getMappedRange: () => new BigUint64Array(stamps).buffer, unmap() {}, destroy() {} });
  const descriptors = [];
  device.createCommandEncoder = () => ({
    beginRenderPass: (desc) => {
      descriptors.push(desc);
      return { end() {} };
    },
    resolveQuerySet() {},
    copyBufferToBuffer() {},
    finish: () => ({}),
  });
  device.queue = { submit() {} };
  const stats = instrument(device);
  const times = [];
  const pass = () => device.createCommandEncoder().beginRenderPass(passDescriptor()).end();

  stats.beginFrame();
  pass();
  stats.endFrame();
  assert.equal(descriptors[0].timestampWrites, undefined); // nobody listens

  const stop = stats.onGpuTime((ms) => times.push(ms));
  stats.beginFrame();
  pass();
  pass();
  stats.endFrame();
  stats.beginFrame(); // a frame with no passes reports nothing
  stats.endFrame();
  await new Promise((resolve) => setTimeout(resolve));
  assert.deepEqual([descriptors[1].timestampWrites.beginningOfPassWriteIndex, descriptors[1].timestampWrites.endOfPassWriteIndex], [0, 1]);
  assert.deepEqual([descriptors[2].timestampWrites.beginningOfPassWriteIndex, descriptors[2].timestampWrites.endOfPassWriteIndex], [undefined, 1]);
  assert.deepEqual(times, [2.5]);
  stop();
  assert.equal(stats.memory().bufferBytes, 0); // the timer's own buffers aren't the game's
  delete device.features;
  assert.equal(instrument(device).onGpuTime(() => {}), null);
});
