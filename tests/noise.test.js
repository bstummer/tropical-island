// The island's noise, the cell hash and its seeded noise (world/noise.js): properties a noise and a
// hash must have, checked statistically on fixed seeds, with bounds loose
// enough for chance (a 99.9% chi-square bound) and tight enough for a flaw.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRandom } from '../src/core/random.js';
import { cellBits, cellHash, createNoise, fbm, seededNoise } from '../src/world/noise.js';

const noise = createNoise(createRandom(1)('test/noise'));

// Points spread evenly over 0..size in both directions (a Kronecker sequence).
const spread = (n, size) => Array.from({ length: n }, (_, k) => [((k * 0.7548776662) % size) + 0.01, ((k * 0.569840291) % size) + 0.02]);

// Chi-square of counts against an even spread, and its 99.9% bound for these degrees of freedom.
const chi2 = (counts) => {
  const expected = counts.reduce((s, c) => s + c, 0) / counts.length;
  return counts.reduce((s, c) => s + (c - expected) ** 2 / expected, 0);
};
const bound999 = (dof) => dof + 3.09 * Math.sqrt(2 * dof) + 3; // close to the table from about 20 dof up

test('noise stays within [-1, 1], averages 0, and is zero on the lattice', () => {
  let sum = 0;
  let max = 0;
  const points = spread(200_000, 300);
  for (const [x, y] of points) {
    const v = noise(x, y);
    sum += v;
    max = Math.max(max, Math.abs(v));
  }
  assert.ok(max <= 1 && max > 0.8, `max |noise| ${max}`);
  assert.ok(Math.abs(sum / points.length) < 0.01, `mean ${sum / points.length}`);
  for (let i = -20; i <= 20; i += 3) for (let j = -20; j <= 20; j += 5) assert.ok(noise(i, j) === 0, `${noise(i, j)} at ${i}, ${j}`);
});

test('noise is smooth: its value and slope carry on across the lattice cells', () => {
  const e = 1e-7;
  const h = 1e-4;
  for (let k = 0; k < 2000; k++) {
    const x = (k % 97) - 48; // on a cell border, also below zero
    const y = ((k * 0.618) % 50) + 0.3;
    assert.ok(Math.abs(noise(x - e, y) - noise(x + e, y)) < 1e-6, `a step at ${x}, ${y}`);
    const left = (noise(x - e, y) - noise(x - e - h, y)) / h;
    const right = (noise(x + e + h, y) - noise(x + e, y)) / h;
    assert.ok(Math.abs(left - right) < 1e-2, `a kink at ${x}, ${y}: slope ${left} then ${right}`);
  }
});

test('noise looks the same in every direction', () => {
  const variance = (degrees) => {
    const [c, s] = [Math.cos((degrees * Math.PI) / 180), Math.sin((degrees * Math.PI) / 180)];
    let sum = 0;
    const points = spread(50_000, 200);
    for (const [x, y] of points) sum += ((noise(x + 1e-4 * c, y + 1e-4 * s) - noise(x, y)) / 1e-4) ** 2;
    return sum / points.length;
  };
  const along = [0, 22.5, 45, 67.5, 90].map(variance);
  assert.ok(Math.max(...along) / Math.min(...along) < 1.05, `slope variance by direction: ${along.map((v) => v.toFixed(3))}`);
});

test('the stream picks the noise: the same one repeats, another differs', () => {
  const again = createNoise(createRandom(1)('test/noise'));
  const other = createNoise(createRandom(1)('test/other'));
  const points = spread(100, 50);
  assert.ok(points.every(([x, y]) => again(x, y) === noise(x, y)));
  assert.ok(points.filter(([x, y]) => other(x, y) !== noise(x, y)).length > 90);
});

test('octaves stay within [-1, 1]', () => {
  let max = 0;
  for (const [x, y] of spread(100_000, 400)) max = Math.max(max, Math.abs(fbm(noise, x, y, 4)));
  assert.ok(max <= 1 && max > 0.4, `max |fbm| ${max}`);
});

test('the cell hash is even, and independent across neighbouring cells, swapped cells and consecutive seeds', () => {
  for (const seed of [7, 42, 12345, 1 << 20, 0x7ffffff0]) {
    const even = new Array(100).fill(0);
    const pairs = { 'seed + 1': new Array(100).fill(0), 'the next cell': new Array(100).fill(0), 'i and j swapped': new Array(100).fill(0) };
    const bin = (a, b) => Math.floor(a * 10) * 10 + Math.floor(b * 10);
    for (let i = -100; i < 100; i++) {
      for (let j = -100; j < 100; j++) {
        const v = cellHash(i, j, seed);
        assert.ok(v >= 0 && v < 1);
        even[Math.floor(v * 100)]++;
        pairs['seed + 1'][bin(v, cellHash(i, j, seed + 1))]++;
        pairs['the next cell'][bin(v, cellHash(i + 1, j, seed))]++;
        if (i !== j) pairs['i and j swapped'][bin(v, cellHash(j, i, seed))]++; // on the diagonal it is the same cell
      }
    }
    assert.ok(chi2(even) < bound999(99), `seed ${seed}: uneven, chi-square ${chi2(even).toFixed(0)}`);
    for (const [name, counts] of Object.entries(pairs)) {
      assert.ok(chi2(counts) < bound999(99), `seed ${seed}: tied to ${name}, chi-square ${chi2(counts).toFixed(0)}`);
    }
  }
});

test('the seeded noise stays within about [-1, 1], averages 0, is zero on the lattice and smooth across it', () => {
  let sum = 0;
  let max = 0;
  const points = spread(100_000, 300);
  for (const [x, y] of points) {
    const v = seededNoise(x - 150, y - 150, 7);
    sum += v;
    max = Math.max(max, Math.abs(v));
  }
  // Its gradients come from a square, up to 1.41 long: a little past 1 at the most.
  assert.ok(max <= 1.2 && max > 0.6, `max |noise| ${max}`);
  assert.ok(Math.abs(sum / points.length) < 0.01, `mean ${sum / points.length}`);
  for (let i = -20; i <= 20; i += 3) for (let j = -20; j <= 20; j += 5) assert.ok(seededNoise(i, j, 7) === 0, `${seededNoise(i, j, 7)} at ${i}, ${j}`);
  for (let k = 0; k < 500; k++) {
    const x = (k % 41) - 20;
    const y = ((k * 0.618) % 30) - 15;
    assert.ok(Math.abs(seededNoise(x - 1e-7, y, 3) - seededNoise(x + 1e-7, y, 3)) < 1e-5, `a step at ${x}, ${y}`);
  }
});

test('the seeded noise takes its lattice from the cell bits, and the seed picks the noise', () => {
  for (let k = 0; k < 200; k++) {
    const [i, j, seed] = [(k * 37) % 101 - 50, (k * 53) % 89 - 44, k];
    assert.equal(cellHash(i, j, seed), cellBits(i, j, seed) / 4294967296);
    assert.ok(cellBits(i, j, seed) >= 0 && cellBits(i, j, seed) < 2 ** 32 && Number.isInteger(cellBits(i, j, seed)));
    // Next to a lattice point the noise follows its gradient, the bits' halves.
    const h = cellBits(i, j, seed);
    const e = 1e-4;
    const g = [(h & 65535) / 32767.5 - 1, (h >>> 16) / 32767.5 - 1];
    assert.ok(Math.abs(seededNoise(i + e, j, seed) / (1.4 * e) - g[0]) < 1e-3 && Math.abs(seededNoise(i, j + e, seed) / (1.4 * e) - g[1]) < 1e-3, `gradient at ${i}, ${j}`);
  }
  let differ = 0;
  for (const [x, y] of spread(1000, 50)) if (seededNoise(x, y, 1) !== seededNoise(x, y, 2)) differ++;
  assert.ok(differ > 990, `${differ} of 1000 points differ between seeds`);
});
