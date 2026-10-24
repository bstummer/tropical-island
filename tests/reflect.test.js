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
  uWeights: array<vec4f, 2>,
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
    uWeights: [224, 32],
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
  writeField(view, 0, fields.uWeights, [[7, 0, 0, 0], [8, 0, 0, 0]]);
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

test('writeField refuses values that would land half-written or wrapped', () => {
  const { structs } = reflect(SOURCE);
  const fields = Object.fromEntries(structLayout('Light', structs).map((f) => [f.name, f]));
  const view = new DataView(new ArrayBuffer(structSize('Light', structs)));
  // A vector with more or fewer components than the field, also in an array.
  assert.throws(() => writeField(view, 0, fields.uSunDirection, { x: 1, y: 2 }), /"uSunDirection" \(vec3f\) got 2 components/);
  assert.throws(() => writeField(view, 0, fields.uSunDirection, { x: 1, y: 2, z: 3, w: 4 }), /got 4 components/);
  assert.throws(() => writeField(view, 0, fields.uWeights, [{ x: 1, y: 2 }, [1, 2, 3, 4]]), /"uWeights\[0\]" \(vec4f\) got 2/);
  // A matrix of the wrong size: a Matrix4's elements into a mat3x3f.
  assert.throws(() => writeField(view, 0, fields.uNormal, { elements: new Array(16).fill(0) }), /needs 9 elements, got 16/);
  // Whole numbers in range only, and booleans only as u32.
  assert.throws(() => writeField(view, 0, fields.uFlag, -1), /-1 is no u32/);
  assert.throws(() => writeField(view, 0, fields.uFlag, 1.5), /1.5 is no u32/);
  assert.throws(() => writeField(view, 0, fields.uExposure, true), /expected a number for f32/);
});

test('layouts that differ between browsers are refused', () => {
  // Under uniform_buffer_standard_layout these sit closer than core WGSL puts them.
  const nested = reflect('struct In { x: f32 } struct Out { a: f32, s: In, b: f32 }').structs;
  assert.throws(() => structLayout('Out', nested), /struct In in a uniform struct aligns to 4 bytes/);
  assert.equal(structLayout('Out', { ...nested, In: [{ name: 'x', type: 'vec4f' }] })[2].offset, 32);
  assert.throws(() => structLayout('M', reflect('struct M { a: f32, m: array<mat2x2f, 2> }').structs), /array of mat2x2f/);
  // Attributes the layout doesn't know.
  assert.throws(() => reflect('struct S { a: f32, @size(16) b: f32, c: f32 }'), /@align\/@size in struct S/);
  assert.throws(() => reflect('struct S { @align(16) a: f32 }'), /@align\/@size in struct S/);
});

test('a uniform array of elements narrower than 16 bytes is refused', () => {
  const { structs } = reflect('struct A { ranges: array<f32, 16>, morphs: array<vec2f, 4>, ok: array<vec4f, 2> }');
  assert.throws(() => structLayout('A', structs), /array of f32 \(4 bytes apart\); use vec4f/);
  assert.throws(() => structLayout('A', { A: [structs.A[1]] }), /array of vec2f/);
  assert.equal(structLayout('A', { A: [structs.A[2]] })[0].size, 32);
});
