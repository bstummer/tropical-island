// The foam's lace (textures/foam.js): the levels of its tile that leave each share
// of the foam, read back from its texels, and the numbers the water's shader keeps
// of the tile's making.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { FOAM_LEVELS, foamLevels, foamLevelsUniform } from '../src/textures/foam-levels.js';

// Texels whose r is each byte of `bytes`, `count` times.
function texelsOf(bytes, count = 1) {
  const out = new Uint8Array(4 * bytes.length * count);
  let n = 0;
  for (let k = 0; k < count; k++) for (const b of bytes) out.set([b, 128, 128, 255], 4 * n++);
  return out;
}

// The share of texels whose r, in holes' radii, lies above `level`, each byte an even spread over its step.
function shareAbove(texels, level) {
  let above = 0;
  for (let n = 0; n < texels.length; n += 4) {
    const [lo, hi] = [(2 * (texels[n] - 0.5)) / 255, (2 * (texels[n] + 0.5)) / 255];
    above += Math.min(Math.max((hi - level) / (hi - lo), 0), 1);
  }
  return above / (texels.length / 4);
}

test('each level leaves its share of the tile above it, from none of it to all, falling as the share grows', () => {
  const r = (i) => Math.floor(((Math.sin(i * 12.9898) * 43758.5453) % 1 + 1) % 1 * 256);
  const cases = {
    even: texelsOf(Array.from({ length: 256 }, (_, b) => b), 4),
    lumpy: texelsOf(Array.from({ length: 5000 }, (_, i) => Math.min(255, Math.floor(40 + 0.6 * r(i) * (r(i + 7) / 255))))),
    few: texelsOf([10, 10, 10, 200]),
  };
  for (const [name, texels] of Object.entries(cases)) {
    const levels = foamLevels(texels);
    assert.equal(levels.length, FOAM_LEVELS);
    levels.forEach((level, j) => {
      const share = j / (FOAM_LEVELS - 1);
      assert.ok(Math.abs(shareAbove(texels, level) - share) < 1e-9, `${name}: the level for ${share} leaves ${shareAbove(texels, level)}`);
      if (j) assert.ok(level <= levels[j - 1], `${name}: level ${j} ${level} above the one before, ${levels[j - 1]}`);
    });
  }
  // The even tile, from 0 to 2 radii: its level for a share is where that much lies above.
  const even = foamLevels(cases.even);
  assert.ok(Math.abs(even[8] - 1) < 0.01, `half of an even tile lies above ${even[8]}`);
});

test('the levels go to the water four to a vector, as many as its shader holds and reads', () => {
  const levels = Array.from({ length: FOAM_LEVELS }, (_, j) => j);
  const packed = foamLevelsUniform(levels);
  assert.equal(packed.length, Math.ceil(FOAM_LEVELS / 4));
  levels.forEach((v, j) => assert.equal(['x', 'y', 'z', 'w'].map((c) => packed[Math.floor(j / 4)][c])[j % 4], v));
  // The uniform's array takes them all (gpu/reflect.js drops what doesn't fit), and the shader
  // spreads the shares over the levels it has: its last step starts at the one before the last.
  const water = readFileSync(new URL('../src/water/water.wgsl', import.meta.url), 'utf8');
  const foam = readFileSync(new URL('../src/water/water-foam.wgsl', import.meta.url), 'utf8');
  assert.equal(Number(water.match(/uFoamLevels: array<vec4f, (\d+)>/)[1]), packed.length);
  const level = foam.match(/fn foamLevel\([\s\S]*?\n}/)[0];
  assert.equal(Number(level.match(/\* ([0-9.]+);/)[1]), FOAM_LEVELS - 1);
  assert.equal(Number(level.match(/min\(u32\(at\), (\d+)u\)/)[1]), FOAM_LEVELS - 2);
});

test('the water reads the tile\'s holes by the largest the tile makes', () => {
  const tile = readFileSync(new URL('../src/textures/foam-tile.wgsl', import.meta.url), 'utf8');
  const water = readFileSync(new URL('../src/water/water-foam.wgsl', import.meta.url), 'utf8');
  const vec = (name) => tile.match(new RegExp(`const ${name} = vec4f\\(([^)]*)\\)`))[1].split(',').map(Number);
  const scalar = (text, name) => Number(text.match(new RegExp(`const ${name}: f32 = ([0-9.]+)`))[1]);
  const [cells, radius] = [vec('CELLS'), vec('RADIUS')];
  const largest = Math.max(...cells.map((c, k) => radius[k] / c));
  assert.ok(Math.abs(scalar(tile, 'HOLE_LARGEST') - largest) < 1e-3, `the tile's largest hole is ${largest}, it says ${scalar(tile, 'HOLE_LARGEST')}`);
  assert.equal(scalar(water, 'FOAM_HOLE_LARGEST'), scalar(tile, 'HOLE_LARGEST'));
});
