import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Bindings, GROUPS, layoutEntry } from '../src/gpu/bindings.js';
import { reflect } from '../src/gpu/reflect.js';

globalThis.GPUShaderStage ??= { VERTEX: 1, FRAGMENT: 2, COMPUTE: 4 };
globalThis.GPUBufferUsage ??= { UNIFORM: 0x40, COPY_DST: 0x08 };

// A device that records what Bindings asks of it.
function fakeGpu() {
  const log = { writes: 0, groups: 0 };
  const samplers = new Map();
  const gpu = {
    log,
    layout: (entries) => ({ entries }),
    sampler: (descriptor) => {
      if (!samplers.has(descriptor)) samplers.set(descriptor, { sampler: descriptor });
      return samplers.get(descriptor);
    },
    placeholder: (type) => ({ placeholder: type }),
    queue: { writeBuffer: () => log.writes++ },
    device: {
      createBuffer: ({ size }) => ({ size, destroy() {} }),
      createBindGroup: (descriptor) => {
        log.groups++;
        return { descriptor };
      },
    },
  };
  return gpu;
}

const MATERIAL = `
struct Look { uTint: vec3f, uGain: f32 }
@group(1) @binding(0) var<uniform> look: Look;
@group(1) @binding(1) var uMap: texture_2d<f32>;
@group(1) @binding(2) var uMapSampler: sampler;
@group(1) @binding(3) var<storage, read> uCounts: array<u32>;
`;

let uid = 0;
const texture = (name) => ({ name, uid: uid++, version: 0, view: { view: name }, sampler: {} });

test('uniforms are written when they change, and bind groups made once per set of resources', () => {
  const gpu = fakeGpu();
  const bindings = new Bindings(gpu, reflect(MATERIAL), 1, 'test');
  const counts = { label: 'counts' };
  const uniforms = { uTint: { value: [1, 0.5, 0.25] }, uGain: { value: 2 }, uMap: { value: texture('a') }, uCounts: { value: counts } };
  const first = bindings.update(uniforms);
  assert.equal(bindings.update(uniforms), first);
  assert.deepEqual(gpu.log, { writes: 1, groups: 1 });
  uniforms.uGain.value = 3;
  assert.equal(bindings.update(uniforms), first);
  assert.equal(gpu.log.writes, 2);
  // Textures cycling through more sets than a small cache keeps: each set's group is made once.
  const textures = Array.from({ length: 12 }, (_, i) => texture(`t${i}`));
  for (let round = 0; round < 3; round++) {
    for (const t of textures) {
      uniforms.uMap.value = t;
      bindings.update(uniforms);
    }
  }
  assert.equal(gpu.log.groups, 1 + textures.length);
  // A storage buffer is bound by itself, not by its label.
  uniforms.uCounts.value = { label: 'counts' };
  const other = bindings.update(uniforms);
  assert.notEqual(other.descriptor.entries[3].resource.buffer, counts);
  assert.equal(other.descriptor.entries[3].resource.buffer, uniforms.uCounts.value);
});

test('the bind groups kept are those used last', () => {
  const gpu = fakeGpu();
  const bindings = new Bindings(gpu, reflect(MATERIAL), 1, 'test');
  const uniforms = { uTint: { value: [1, 1, 1] }, uGain: { value: 1 }, uMap: { value: null }, uCounts: { value: {} } };
  const textures = Array.from({ length: GROUPS + 1 }, (_, i) => texture(`t${i}`));
  const use = (t) => {
    uniforms.uMap.value = t;
    bindings.update(uniforms);
    return gpu.log.groups;
  };
  for (const t of textures.slice(0, GROUPS)) use(t);
  assert.equal(use(textures[0]), GROUPS); // kept, and now the last used
  // One set more than are kept: the least recently used goes, t1 (not t0).
  assert.equal(use(textures[GROUPS]), GROUPS + 1);
  assert.equal(bindings.groups.size, GROUPS);
  assert.equal(use(textures[0]), GROUPS + 1);
  assert.equal(use(textures[1]), GROUPS + 2);
  assert.equal(bindings.groups.size, GROUPS);
});

const SOURCE = `
@group(1) @binding(0) var uTiles: texture_2d_array<f32>;
@group(1) @binding(1) var uTilesSampler: sampler;
@group(1) @binding(2) var uPlaces: texture_2d<f32>;
@group(1) @binding(3) var uHeight: texture_2d_array<f32>;
@group(1) @binding(4) var uHeightTexels: sampler;
@group(1) @binding(5) var uShadow: texture_depth_2d;
@group(1) @binding(6) var uShadowSampler: sampler_comparison;
@group(1) @binding(7) var uAerial: texture_3d<f32>;
`;

test('a comparison sampler compares as reversed depth does, unless its texture says otherwise', () => {
  const gpu = fakeGpu();
  const bindings = new Bindings(gpu, reflect(SOURCE), 1, 'test');
  const tiles = texture('tiles');
  const shadow = { ...texture('shadow'), sampler: { mag: 'linear', min: 'linear' } };
  const uniforms = { uTiles: { value: tiles }, uPlaces: { value: null }, uHeight: { value: null }, uShadow: { value: shadow }, uAerial: { value: null } };
  const sampler = (group, name) => group.descriptor.entries[bindings.entries.findIndex((b) => b.name === name)].resource.sampler;
  const first = bindings.update(uniforms);
  assert.deepEqual(sampler(first, 'uShadowSampler'), { mag: 'linear', min: 'linear', compare: 'greater-equal' });
  assert.equal(sampler(first, 'uTilesSampler'), tiles.sampler); // a filtering one, as its texture's
  // The same descriptor every frame, so the same sampler and bind group.
  uniforms.uShadow.value = { ...shadow, uid: uid++, view: { view: 'shadow 2' } };
  assert.equal(sampler(bindings.update(uniforms), 'uShadowSampler'), sampler(first, 'uShadowSampler'));
  assert.equal(gpu.log.groups, 2);
  // A texture's own comparison, and none: the device's default sampler, comparing.
  uniforms.uShadow.value = { ...shadow, sampler: { compare: 'less' } };
  assert.equal(sampler(bindings.update(uniforms), 'uShadowSampler').compare, 'less');
  uniforms.uShadow.value = null;
  assert.deepEqual(sampler(bindings.update(uniforms), 'uShadowSampler'), { compare: 'greater-equal' });
});

test('layouts follow the sampler beside each texture', () => {
  const { bindings } = reflect(SOURCE);
  const layout = Object.fromEntries(bindings.map((b) => [b.name, layoutEntry(b, bindings)]));
  assert.deepEqual(layout.uTiles.texture, { sampleType: 'float', viewDimension: '2d-array', multisampled: false });
  assert.deepEqual(layout.uTilesSampler.sampler, { type: 'filtering' });
  // Without a sampler: read texel by texel, which any float format allows.
  assert.equal(layout.uPlaces.texture.sampleType, 'unfilterable-float');
  // With a Texels sampler: gathered unfiltered, so r32float works too.
  assert.equal(layout.uHeight.texture.sampleType, 'unfilterable-float');
  assert.deepEqual(layout.uHeightTexels.sampler, { type: 'non-filtering' });
  assert.equal(layout.uShadow.texture.sampleType, 'depth');
  assert.deepEqual(layout.uShadowSampler.sampler, { type: 'comparison' });
  assert.equal(layout.uAerial.texture.viewDimension, '3d');
  assert.equal(layout.uAerial.texture.sampleType, 'unfilterable-float');
});
