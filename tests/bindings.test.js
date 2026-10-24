import { test } from 'node:test';
import assert from 'node:assert/strict';
import { layoutEntry } from '../src/gpu/bindings.js';
import { reflect } from '../src/gpu/reflect.js';

globalThis.GPUShaderStage ??= { VERTEX: 1, FRAGMENT: 2, COMPUTE: 4 };

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
