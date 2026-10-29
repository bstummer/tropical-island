// Where shadows can fall (sky/shadow-reach.js): every point of the ground a
// caster shades lies in a cell it marks, under any sun and however the cove's
// frame is turned; its shadow stops where the ground rises into it.
import test from 'node:test';
import assert from 'node:assert/strict';
import { SHADOW_CELL, cellsMeet, shadowCells } from '../src/sky/shadow-reach.js';

const DEG = Math.PI / 180;
// The cove's frame turned and mirrored, as world/island.js's can be.
function turned(angle, side) {
  const right = [Math.cos(angle), Math.sin(angle)];
  const forward = [-Math.sin(angle), Math.cos(angle)];
  return {
    toCove: (x, z) => [side * (x * right[0] + z * right[1]), x * forward[0] + z * forward[1]],
    fromCove: (a, o) => [side * a * right[0] + o * forward[0], side * a * right[1] + o * forward[1]],
  };
}
const towards = (elevation, azimuth) => [Math.cos(elevation * DEG) * Math.cos(azimuth * DEG), Math.sin(elevation * DEG), Math.cos(elevation * DEG) * Math.sin(azimuth * DEG)];

// Whether a ray from p towards the sun meets the sphere.
function hits(p, sun, [x, y, z, r]) {
  const d = [x - p[0], y - p[1], z - p[2]];
  const along = d[0] * sun[0] + d[1] * sun[1] + d[2] * sun[2];
  if (along <= 0) return false;
  return d[0] ** 2 + d[1] ** 2 + d[2] ** 2 - along * along <= r * r;
}

test("every point of the ground a caster shades lies in a cell it marks, under any sun, the cove's frame turned or mirrored", () => {
  const ground = (x, z) => 0.05 * x - 0.03 * z + 2 * Math.sin(x / 9); // rolling, not level
  const spheres = [3, ground(3, -4) + 1.2, -4, 1.4, -20, ground(-20, 15) + 0.4, 15, 0.6];
  for (const island of [turned(0, 1), turned(1.1, -1), turned(-2.4, 1)]) {
    for (const [elevation, azimuth] of [[5, 0], [5, 130], [20, -70], [63, 200], [1, 45]]) {
      const sun = towards(elevation, azimuth);
      const cells = shadowCells(spheres, sun, { island, heightAt: ground, margin: 2, longest: 250 });
      let shaded = 0;
      for (let x = -60; x <= 60; x += 0.35) {
        for (let z = -60; z <= 60; z += 0.35) {
          const p = [x, ground(x, z), z];
          for (let k = 0; k < spheres.length; k += 4) {
            if (!hits(p, sun, spheres.slice(k, k + 4))) continue;
            shaded++;
            const [a, o] = island.toCove(x, z);
            assert.ok(cellsMeet(cells, a, o, a, o), `${elevation}° from ${azimuth}°: ${x.toFixed(1)}, ${z.toFixed(1)} shaded, not marked`);
          }
        }
      }
      assert.ok(shaded > 20, `${elevation}° from ${azimuth}°: only ${shaded} points shaded`);
    }
  }
});

test('a shadow runs as far as the ray from its caster\'s top stays above the ground, and no further', () => {
  const island = turned(0, 1);
  const sun = towards(5.71, 180); // from -x, tan e = 0.1: shadows run along +x
  const sphere = [0, 1, 0, 1]; // its top 2 m up: 20 m of shadow on level ground
  const level = shadowCells(sphere, sun, { island, heightAt: () => 0, margin: 1, longest: 250 });
  assert.ok(cellsMeet(level, 18, 0, 18, 0), 'marks the shadow near its end');
  assert.ok(!cellsMeet(level, 40, -100, 300, 100), 'marks nothing well past it');
  assert.ok(!cellsMeet(level, -100, -100, -8, 100), 'nor towards the sun');
  assert.ok(!cellsMeet(level, -100, 8, 300, 100) && !cellsMeet(level, -100, -100, 300, -8), 'nor wide of it');
  // A bank rising 1 m a metre from x = 8 takes the ray from its top 10 m sooner.
  const bank = shadowCells(sphere, sun, { island, heightAt: (x) => Math.max(0, x - 8), margin: 1, longest: 250 });
  assert.ok(cellsMeet(bank, 8, 0, 8, 0), 'marks up to the bank');
  assert.ok(!cellsMeet(bank, 20, -100, 300, 100), 'marks nothing past where it meets the bank');
  // However low the sun, no further than longest.
  const low = shadowCells(sphere, towards(0.2, 180), { island, heightAt: () => 0, margin: 1, longest: 60 });
  assert.ok(cellsMeet(low, 59, 0, 59, 0) && !cellsMeet(low, 60 + 2 * SHADOW_CELL, -100, 1000, 100), 'stops at longest');
});

test('overhead, a caster marks the cells under it alone', () => {
  const cells = shadowCells([10, 1, 10, 1], [0, 1, 0], { island: turned(0, 1), heightAt: () => 0, margin: 1, longest: 250 });
  assert.ok(cellsMeet(cells, 10, 10, 10, 10));
  assert.ok(!cellsMeet(cells, 10 + 2 * SHADOW_CELL, -100, 100, 100) && !cellsMeet(cells, -100, -100, 10 - 2 * SHADOW_CELL, 100));
});
