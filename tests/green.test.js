// Where the green grows inland (world/green.js, chunks/green.wgsl's twin):
// its patches cover as much of the ground as the green's share says, at any
// share and for any seeds, and lie where they lie; its detail tiles, two reads
// laid over each other, average to what the green divides by.
import test from 'node:test';
import assert from 'node:assert/strict';
import { config } from '../src/config.js';
import { createRandom } from '../src/core/random.js';
import { greenByBand, greenCover, greenLayers, greenPatches } from '../src/world/green.js';

const { green } = config.world.terrain;

// Points spread evenly over a square `size` m across round the origin (a Kronecker sequence).
const spread = (n, size) => Array.from({ length: n }, (_, k) => [((k * 0.7548776662) % 1 - 0.5) * size, ((k * 0.569840291) % 1 - 0.5) * size]);

test('the patches cover the green share of the ground, at every share and for seeds 1 to 20', () => {
  const points = spread(20_000, 1500);
  for (let seed = 1; seed <= 20; seed++) {
    const patches = greenPatches(green, [seed, 1000 + seed]);
    const ranks = points.map(([x, z]) => patches.rank(x, z));
    for (const cover of [0.1, 0.3, 0.45, 0.6, 0.85, 0.95]) {
      const share = ranks.filter((r) => r < cover).length / ranks.length;
      assert.ok(Math.abs(share - cover) < 0.025, `seed ${seed}: ${share.toFixed(3)} of the ground green at a share of ${cover}`);
    }
  }
});

test('the patches are a few metres across: neighbours a blade apart agree, points far apart do not', () => {
  const patches = greenPatches(green, [3, 4]);
  let near = 0;
  let far = 0;
  const points = spread(5000, 1000);
  for (const [x, z] of points) {
    const r = patches.rank(x, z);
    near += Math.abs(r - patches.rank(x + 0.02 * green.patches.size, z));
    far += Math.abs(r - patches.rank(x + 25 * green.patches.size, z + 7 * green.patches.size));
  }
  // Two independent evenly spread values differ by a third on average.
  assert.ok(near / points.length < 0.03, `neighbours differ by ${(near / points.length).toFixed(3)}`);
  assert.ok(Math.abs(far / points.length - 1 / 3) < 0.03, `far points differ by ${(far / points.length).toFixed(3)}`);
});

test('the seeds pick the patches', () => {
  const a = greenPatches(green, [1, 2]);
  const b = greenPatches(green, [1, 3]);
  const c = greenPatches(green, [5, 2]);
  let differ = 0;
  for (const [x, z] of spread(500, 500)) if (a.rank(x, z) !== b.rank(x, z) && a.rank(x, z) !== c.rank(x, z)) differ++;
  assert.ok(differ > 490, `${differ} of 500 points differ`);
  assert.equal(greenPatches(green, [1, 2]).rank(12.3, -45.6), a.rank(12.3, -45.6));
});

test("the green's share goes by band from the scrub through the palm belt to the jungle, and from open to lush", () => {
  const { open, lush } = green.cover;
  // Each band's own value where it isn't blending into the next (as world/island.js blends them).
  [0, 1.6, 3].forEach((band, k) => {
    assert.equal(greenCover(band, 0, green), open[k]);
    assert.equal(greenCover(band, 1, green), lush[k]);
    assert.ok(Math.abs(greenCover(band, 0.5, green) - (open[k] + lush[k]) / 2) < 1e-12);
  });
  assert.equal(greenByBand([1, 2, 3], -1), 1);
  assert.equal(greenByBand([1, 2, 3], 4), 3);
});

test("two reads of a detail tile laid over each other average to greenLayers' numbers, near and far", () => {
  // A tile as grass.wgsl makes one: blades of a colour over the ground between
  // them, covering a texel wholly, partly (their edges) or not at all.
  const r = createRandom(1)('test/green/layers');
  const size = 64;
  const ground = 0.35;
  const tile = Array.from({ length: size * size }, () => {
    const alpha = r.chance(0.3) ? 0 : r.chance(0.7) ? 1 : r.next();
    const blade = [r.range(0.2, 1.6), r.range(0.5, 1.5), r.range(0.1, 1.2)];
    return [...blade.map((c) => ground + alpha * (c - ground)), alpha];
  });
  // Its mipmaps average texels two by two, as far away a texel covers many blades.
  const mip = (t, n) =>
    Array.from({ length: (n / 2) ** 2 }, (_, k) => {
      const x = 2 * (k % (n / 2));
      const y = 2 * Math.floor(k / (n / 2));
      return [0, 1, 2, 3].map((c) => (t[y * n + x][c] + t[y * n + x + 1][c] + t[(y + 1) * n + x][c] + t[(y + 1) * n + x + 1][c]) / 4);
    });
  // As chunks/green.wgsl greenTile lays them: the top read over the other, which lies on top leaning either way.
  const over = (top, under) => [0, 1, 2].map((c) => top[c] + (1 - top[3]) * (under[c] - ground)).concat(1 - (1 - top[3]) * (1 - under[3]));
  const average = (t) => [0, 1, 2, 3].map((c) => t.reduce((s, v) => s + v[c], 0) / t.length);
  const [red, green_, blue, alpha] = average(tile);
  const { cover, mean } = greenLayers(alpha, [red, green_, blue], ground);
  for (const [level, t] of [tile, mip(tile, size), mip(mip(tile, size), size / 2)].entries()) {
    const sum = [0, 0, 0, 0];
    const pairs = 200_000;
    for (let k = 0; k < pairs; k++) {
      const a = t[r.int(0, t.length - 1)];
      const b = t[r.int(0, t.length - 1)];
      const lean = r.next();
      const [aOnTop, bOnTop] = [over(a, b), over(b, a)];
      for (let c = 0; c < 4; c++) sum[c] += lean * aOnTop[c] + (1 - lean) * bOnTop[c];
    }
    const got = sum.map((v) => v / pairs);
    assert.ok(Math.abs(got[3] - cover) < 0.005, `mip ${level}: the layers cover ${got[3].toFixed(4)}, greenLayers says ${cover.toFixed(4)}`);
    mean.forEach((m, c) => assert.ok(Math.abs(got[c] - m) / m < 0.01, `mip ${level}, channel ${c}: the layers average ${got[c].toFixed(4)}, greenLayers says ${m.toFixed(4)}`));
  }
});
