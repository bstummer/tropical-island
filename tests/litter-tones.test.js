// The leaf litter's tones evened out (textures/litter-tones.js): however
// lopsided the tile draws them, its leaves' tones come out spread evenly over
// 0 to 1, as chunks/green.wgsl greenOver and greenShownTone take them, in the
// order they had, the rest of the tile as it was; and its mip levels are its
// averages, as the GPU makes them.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRandom } from '../src/core/random.js';
import { evenTones, leafTone, litterLevels } from '../src/textures/litter-tones.js';

const SIZE = 64;

// A litter tile as litter.wgsl draws one (RGBA bytes): leaves cover a texel
// wholly, partly (their edges, the soil's 0.5 showing in the rest) or not at
// all; their tones from `tone(r)`, 0 to 1.
function tile(tone, seed = 1) {
  const r = createRandom(seed)('test/litter-tones');
  const pixels = new Uint8Array(4 * SIZE * SIZE);
  for (let i = 0; i < pixels.length; i += 4) {
    const cover = r.chance(0.15) ? 0 : r.chance(0.8) ? 1 : r.next();
    const t = tone(r);
    pixels.set([r.int(0, 255), r.int(0, 255), Math.round(255 * (cover * t + (1 - cover) * 0.5)), Math.round(255 * cover)], i);
  }
  return pixels;
}

// The share of the leaves (weighted by how much they cover) lighter than t.
function lighterThan(pixels, t) {
  let below = 0;
  let total = 0;
  for (let i = 0; i < pixels.length; i += 4) {
    const cover = pixels[i + 3] / 255;
    total += cover;
    if (cover > 0 && leafTone(pixels[i + 2] / 255, cover) < t) below += cover;
  }
  return below / total;
}

const LOPSIDED = {
  light: (r) => r.next() ** 2,
  dark: (r) => Math.sqrt(r.next()),
  middling: (r) => 0.35 + 0.3 * r.next(),
  'few of the lightest, as litter.wgsl draws them': (r) => Math.min(1, 0.03 + 0.9 * r.next() + 0.08 * r.next()),
};

test('however lopsided the tones, the leaves come out spread evenly over 0 to 1, weighted by how much they cover', () => {
  for (const [name, tone] of Object.entries(LOPSIDED)) {
    const [after] = litterLevels(tile(tone), SIZE).litter;
    for (const t of [0.05, 0.1, 0.25, 0.5, 0.75, 0.9, 0.95]) {
      const share = lighterThan(after, t);
      assert.ok(Math.abs(share - t) < 0.015, `${name}: ${share.toFixed(3)} of the leaves lighter than ${t}`);
    }
  }
});

test('the leaves keep their order, their cover and their normals, and the soil its part of a texel', () => {
  const before = tile(LOPSIDED.light);
  const [after] = litterLevels(before, SIZE).litter;
  const whole = [];
  for (let i = 0; i < before.length; i += 4) {
    assert.deepEqual([...after.subarray(i, i + 2)], [...before.subarray(i, i + 2)], `texel ${i / 4}: its normal`);
    assert.equal(after[i + 3], before[i + 3], `texel ${i / 4}: its cover`);
    const cover = before[i + 3] / 255;
    if (cover === 0) {
      assert.equal(after[i + 2], 128, `texel ${i / 4}: bare soil, 0.5`);
      continue;
    }
    // Rounding to a byte moves a leaf's tone by up to half a level of the texel's cover.
    const leaf = leafTone(after[i + 2] / 255, cover);
    const slack = 0.5 / 255 / cover;
    assert.ok(leaf >= -slack && leaf <= 1 + slack, `texel ${i / 4}: a leaf tone of ${leaf}`);
    if (cover === 1) whole.push([before[i + 2], after[i + 2]]);
  }
  whole.sort((a, b) => a[0] - b[0]);
  for (let k = 1; k < whole.length; k++) assert.ok(whole[k][1] >= whole[k - 1][1], `tone ${whole[k][0]} came out lighter than ${whole[k - 1][0]}`);
});

test('tones already even stay about as they were', () => {
  const before = tile((r) => r.next());
  const [after] = litterLevels(before, SIZE).litter;
  for (let i = 0; i < before.length; i += 4) assert.ok(Math.abs(after[i + 2] - before[i + 2]) <= 8, `texel ${i / 4}: ${before[i + 2]} became ${after[i + 2]}`);
});

test('the mip levels halve down to a texel, each the average of the four texels above it, rounded half to even', () => {
  const levels = litterLevels(tile(LOPSIDED.dark), SIZE).litter;
  assert.equal(levels.length, Math.log2(SIZE) + 1);
  levels.forEach((level, k) => assert.equal(level.length, 4 * (SIZE >> k) ** 2, `level ${k}`));
  for (let k = 1; k < levels.length; k++) {
    const above = levels[k - 1];
    const n = SIZE >> (k - 1);
    for (let i = 0; i < levels[k].length; i++) {
      const texel = i >> 2;
      const x = 2 * (texel % (n / 2));
      const y = 2 * Math.floor(texel / (n / 2));
      const c = i & 3;
      const sum = above[4 * (y * n + x) + c] + above[4 * (y * n + x + 1) + c] + above[4 * ((y + 1) * n + x) + c] + above[4 * ((y + 1) * n + x + 1) + c];
      const half = Math.floor(sum / 4);
      const rounded = sum % 4 === 2 ? half + (half % 2) : Math.round(sum / 4);
      assert.equal(levels[k][i], rounded, `level ${k}, byte ${i}`);
    }
  }
});

test('a tile without leaves keeps its tones', () => {
  const table = evenTones(new Uint8Array(16));
  assert.equal(table[0], 0);
  assert.equal(table[255], 1);
  assert.ok(Math.abs(table[100] - 100 / 255) < 1e-12);
});

test("the leaves' masks show the lightest leaves of each share, as much of the leaves as the share, each within the next and within the leaves", () => {
  const shares = [0.1, 0.4, 0.7, 0.9];
  const { litter, leaves } = litterLevels(tile(LOPSIDED.light), SIZE, shares);
  const [tones] = litter;
  const [masks] = leaves;
  let covered = 0;
  const shown = [0, 0, 0, 0];
  for (let i = 0; i < masks.length; i += 4) {
    covered += tones[i + 3];
    for (let c = 0; c < 4; c++) {
      shown[c] += masks[i + c];
      assert.ok(masks[i + c] <= tones[i + 3], `texel ${i / 4}: mask ${c} covers more than the leaves`);
      if (c < 3) assert.ok(masks[i + c] <= masks[i + c + 1], `texel ${i / 4}: mask ${c} beyond mask ${c + 1}`);
    }
    // A leaf in a mask is lighter than its share, one out of it darker, give or take a level's rounding.
    const cover = tones[i + 3] / 255;
    if (cover === 1) shares.forEach((share, c) => assert.ok(masks[i + c] ? tones[i + 2] / 255 <= share + 0.5 / 255 : tones[i + 2] / 255 >= share - 0.5 / 255, `texel ${i / 4}, share ${share}`));
  }
  shares.forEach((share, c) => assert.ok(Math.abs(shown[c] / covered - share) < 0.01, `${(shown[c] / covered).toFixed(3)} of the leaves in the mask of ${share}`));
});

test("the masks' mip levels halve as the tile's do, so a pixel of any size sees as much of them", () => {
  const { leaves } = litterLevels(tile(LOPSIDED.dark), SIZE, [0.1, 0.5, 0.75, 0.95]);
  assert.equal(leaves.length, Math.log2(SIZE) + 1);
  const mean = (level, c) => level.reduce((sum, v, i) => sum + (i % 4 === c ? v : 0), 0) / (level.length / 4);
  for (let c = 0; c < 4; c++) {
    for (const level of leaves) assert.ok(Math.abs(mean(level, c) - mean(leaves[0], c)) < 1, `mask ${c}: ${mean(level, c).toFixed(2)} levels at ${Math.sqrt(level.length / 4)} texels, ${mean(leaves[0], c).toFixed(2)} at the tile's`);
  }
});

test('without shares the masks show nothing', () => {
  const { leaves } = litterLevels(tile(LOPSIDED.middling), SIZE);
  assert.ok(leaves[0].every((v) => v === 0));
});
