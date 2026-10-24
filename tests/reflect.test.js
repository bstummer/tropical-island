import { test } from 'node:test';
import assert from 'node:assert/strict';
import { reflect, structLayout, structSize, writeField } from '../src/gpu/reflect.js';

const SOURCE = `
// struct Commented { gone: f32 }
struct Light {
  uSunDirection: vec3f, // a comment, with a comma
  uExposure: f32,
  uSkySH: array<vec3f, 9>,
  uLevels: array<vec4f, 4>,
  uWeights: array<f32, 2>,
  uMatrix: mat4x4f,
  uNormal: mat3x3f,
  uSize: vec2f,
  uFlag: u32,
}
struct VertexIn {
  @location(0) position: vec3f,
  @location(1) aNode: vec4f,
}
override STEPS: i32 = 40;
override TERRAIN_SAND: bool = false;
@group(0) @binding(0) var<uniform> light: Light;
@group(0) @binding(1) var uSkyView: texture_2d<f32>;
@group(0) @binding(2) var uSkyViewSampler: sampler;
@group(1) @binding(3) var uTiles: texture_2d_array<f32>;
@group(1) @binding(4) var<storage, read_write> counts: array<u32>;
@vertex fn vertexMain(in: VertexIn) -> @builtin(position) vec4f { return vec4f(in.position, 1.0); }
@fragment fn fragmentMain(@builtin(position) at: vec4f, @location(0) @interpolate(perspective, centroid) uv: vec2f) -> @location(0) vec4f { return vec4f(1.0); }
`;

test('reflect finds structs, bindings, overrides and entry inputs', () => {
  const r = reflect(SOURCE);
  assert.deepEqual(Object.keys(r.structs), ['Light', 'VertexIn']);
  assert.equal(r.structs.Light.length, 9);
  assert.deepEqual(r.structs.Light[2], { name: 'uSkySH', type: 'array<vec3f, 9>' });
  assert.deepEqual(
    r.bindings.map(({ group, binding, name, kind }) => [group, binding, name, kind]),
    [
      [0, 0, 'light', 'uniform'],
      [0, 1, 'uSkyView', 'texture'],
      [0, 2, 'uSkyViewSampler', 'sampler'],
      [1, 3, 'uTiles', 'texture'],
      [1, 4, 'counts', 'storage'],
    ],
  );
  assert.equal(r.bindings[4].access, 'read_write');
  assert.deepEqual(r.overrides, { STEPS: { type: 'i32', value: '40' }, TERRAIN_SAND: { type: 'bool', value: 'false' } });
  assert.deepEqual(r.entries.vertexMain, {
    stage: 'vertex',
    input: [
      { name: 'position', type: 'vec3f', location: 0 },
      { name: 'aNode', type: 'vec4f', location: 1 },
    ],
  });
  assert.deepEqual(r.entries.fragmentMain.input, [{ name: 'uv', type: 'vec2f', location: 0 }]);
});

test('uniform layout follows WGSL alignment rules', () => {
  const { structs } = reflect(SOURCE);
  const offsets = Object.fromEntries(structLayout('Light', structs).map((f) => [f.name, [f.offset, f.size]]));
  assert.deepEqual(offsets, {
    uSunDirection: [0, 12],
    uExposure: [12, 4], // packs into the vec3's last lane
    uSkySH: [16, 144], // vec3 elements, each 16 bytes apart
    uLevels: [160, 64],
    uWeights: [224, 32], // f32 elements 16 apart in a uniform buffer
    uMatrix: [256, 64],
    uNormal: [320, 48], // three columns of 16
    uSize: [368, 8],
    uFlag: [376, 4],
  });
  assert.equal(structSize('Light', structs), 384);
});

test('writeField packs numbers, vectors, matrices and arrays', () => {
  const { structs } = reflect(SOURCE);
  const fields = Object.fromEntries(structLayout('Light', structs).map((f) => [f.name, f]));
  const view = new DataView(new ArrayBuffer(structSize('Light', structs)));
  writeField(view, 0, fields.uSunDirection, { x: 1, y: 2, z: 3 });
  writeField(view, 0, fields.uExposure, 0.5);
  writeField(view, 0, fields.uSkySH, Array.from({ length: 9 }, (_, k) => [k, k + 0.5, k + 0.25]));
  writeField(view, 0, fields.uWeights, [7, 8]);
  writeField(view, 0, fields.uNormal, { elements: [1, 2, 3, 4, 5, 6, 7, 8, 9] });
  writeField(view, 0, fields.uFlag, true);
  const f = (at) => view.getFloat32(at, true);
  assert.deepEqual([f(0), f(4), f(8), f(12)], [1, 2, 3, 0.5]);
  assert.deepEqual([f(16 + 16 * 8), f(20 + 16 * 8), f(24 + 16 * 8)], [8, 8.5, 8.25]);
  assert.deepEqual([f(224), f(240)], [7, 8]);
  assert.deepEqual([f(320), f(324), f(328), f(336), f(352), f(360)], [1, 2, 3, 4, 7, 9]);
  assert.equal(view.getUint32(376, true), 1);
  assert.throws(() => writeField(view, 0, fields.uSkySH, [[1, 2, 3]]), /has 1 elements, the shader 9/);
});
