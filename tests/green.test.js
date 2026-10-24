// Where the green grows inland (world/green.js, chunks/green.glsl's twin):
// its patches cover as much of the ground as the green's share says, at any
// share and for any seeds, and lie where they lie.
import test from 'node:test';
import assert from 'node:assert/strict';
import { config } from '../src/config.js';
import { greenByBand, greenCover, greenPatches } from '../src/world/green.js';

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
