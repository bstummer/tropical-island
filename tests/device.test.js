import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createDevice } from '../src/gpu/device.js';

globalThis.GPUTextureUsage ??= { COPY_DST: 0x02, RENDER_ATTACHMENT: 0x10 };

// A browser with WebGPU that records the samplers asked of its device.
function fakeWebGPU() {
  const samplers = [];
  const device = {
    queue: {},
    lost: new Promise(() => {}),
    addEventListener() {},
    createSampler: (descriptor) => {
      samplers.push(descriptor);
      return { descriptor };
    },
    createBindGroupLayout: (descriptor) => ({ descriptor }),
    createBindGroup: (descriptor) => ({ descriptor }),
  };
  const adapter = { features: new Set(), info: {}, requestDevice: async () => device };
  Object.defineProperty(globalThis, 'navigator', {
    value: { gpu: { requestAdapter: async () => adapter, getPreferredCanvasFormat: () => 'bgra8unorm' } },
    configurable: true,
  });
  const canvas = { getContext: () => ({ configure() {} }) };
  return { samplers, open: () => createDevice(canvas, { capture: false, onError: () => {}, instrument: () => ({}) }) };
}

test('samplers are made once per descriptor, a comparison one with its compare', async () => {
  const { samplers, open } = fakeWebGPU();
  const gpu = await open();
  const plain = gpu.sampler({ mag: 'nearest', min: 'nearest' });
  const comparing = gpu.sampler({ mag: 'nearest', min: 'nearest', compare: 'greater-equal' });
  assert.notEqual(comparing, plain);
  assert.equal(comparing.descriptor.compare, 'greater-equal');
  assert.equal('compare' in plain.descriptor, false); // a filtering or non-filtering sampler has none
  // Equal descriptors share one, also as new objects.
  assert.equal(gpu.sampler({ mag: 'nearest', min: 'nearest', compare: 'greater-equal' }), comparing);
  assert.equal(gpu.sampler({ mag: 'nearest', min: 'nearest' }), plain);
  assert.equal(samplers.length, 2);
});
