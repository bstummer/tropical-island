// The island's own shade (world/shade.js): a wall's shadow where geometry puts
// it, soft as the sun's disk makes it; over every seed's island, shade exactly
// where a march towards the sun meets the ground above the sun's line, and a
// lower sun from the same way never lighting what a higher one shaded; worked
// out in bands, as the workers do, the same. The GPU's side is checked in the
// browser (src/fixtures/shade.js).
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRandom } from '../src/core/random.js';
import { config } from '../src/config.js';
import { createIsland } from '../src/world/island.js';
import { buildHeightmap } from '../src/world/heightmap.js';
import {
  ABOVE_GROUND,
  islandShade,
  latticeHeights,
  packPiece,
  packShade,
  seen,
  shadeAbove,
  shadeAt,
  shadeBands,
  shadeLayout,
  shadeMerger,
  shadeStrips,
  sunDisk,
  turnShade,
} from '../src/world/shade.js';

const SEEDS = Array.from({ length: 20 }, (_, i) => i + 1);
const SUN = (config.sky.atmosphere.sunRadius * Math.PI) / 180;
const DEG = Math.PI / 180;

// Towards the sun at `elevation` degrees, `azimuth` degrees from +a towards +o, in the cove's frame.
function towards(elevation, azimuth) {
  const e = elevation * DEG;
  const z = azimuth * DEG;
  return [Math.cos(e) * Math.cos(z), Math.sin(e), Math.cos(e) * Math.sin(z)];
}

// Flat ground at 0 with heights from fn(a, o), 2 m apart from -200, -200, and a coarse level round it.
function plain(fn, samples = 256, texel = 2) {
  const origin = [-200, -200];
  const heights = new Float32Array(samples * samples);
  for (let j = 0; j < samples; j++) for (let i = 0; i < samples; i++) heights[j * samples + i] = fn(origin[0] + i * texel, origin[1] + j * texel);
  const per = 4;
  const coarseSamples = samples / per;
  const coarse = new Float32Array(coarseSamples * coarseSamples);
  for (let j = 0; j < coarseSamples; j++) for (let i = 0; i < coarseSamples; i++) coarse[j * coarseSamples + i] = heights[j * per * samples + i * per];
  return [
    { origin, texel, samples, heights },
    { origin, texel: texel * per, samples: coarseSamples, heights: coarse },
  ];
}

test('the sun disk: whole below a horizon a radius under its centre, gone a radius over, half at its centre, symmetric', () => {
  assert.equal(sunDisk(-1), 1);
  assert.equal(sunDisk(-5), 1);
  assert.equal(sunDisk(1), 0);
  assert.equal(sunDisk(3), 0);
  assert.ok(Math.abs(sunDisk(0) - 0.5) < 1e-12);
  for (let x = -1; x <= 1; x += 0.05) {
    assert.ok(Math.abs(sunDisk(x) + sunDisk(-x) - 1) < 1e-12, `at ${x}`);
    assert.ok(sunDisk(x + 0.05) <= sunDisk(x), `falls at ${x}`);
  }
});

test('the layout covers the coarsest level on the finer lines, halving as it does', () => {
  const levels = plain(() => 0);
  const layout = shadeLayout(levels, 2);
  assert.deepEqual(layout, { origin: [-200, -200], texel: 2, samples: 256 });
  assert.throws(() => shadeLayout(levels, 3), /doesn't divide/);
});

test("a wall's shadow runs as far as its height over the sun's slope, soft by the disk at that reach", () => {
  // A wall 10 m high along o, 4 m thick at a = 0..4; the sun from +a, tan e = 0.1: shade to a = -100.
  const levels = plain((a) => (a >= 0 && a <= 4 ? 10 : 0));
  const e = Math.atan(0.1) / DEG;
  const shade = islandShade(levels, towards(e, 0), { texel: 2, radius: SUN });
  // The disk spans its radius either side of the line, which on the ground,
  // 100 m from the wall's top, is d(atan(10 / d)) / dd = 1 / 1010 per metre:
  // its end is soft over 4.7 m either side of a = -100.
  for (const o of [-60, 0, 60]) {
    assert.ok(shadeAt(shade, -50, o) < 0.01, `in its shadow at ${o}`);
    assert.ok(shadeAt(shade, -94, o) < 0.02, `before its soft end at ${o}`);
    assert.ok(shadeAt(shade, -106, o) > 0.98, `past its soft end at ${o}`);
    assert.ok(shadeAt(shade, -97, o) < shadeAt(shade, -100, o) && shadeAt(shade, -100, o) < shadeAt(shade, -103, o), `softening at ${o}`);
    assert.ok(shadeAt(shade, 40, o) > 0.99, `on its sunny side at ${o}`);
    // Half of the disk seen at the line.
    assert.ok(Math.abs(shadeAt(shade, -100, o) - 0.5) < 0.1, `half at its end at ${o}: ${shadeAt(shade, -100, o)}`);
    // Above the ground: lit above the shade's top, which falls towards the shadow's end.
    assert.ok(shadeAbove(shade, -50, o, 6, 0) > 0.99, `above its top at -50, ${o}`);
    assert.ok(shadeAbove(shade, -50, o, 4, 0) < 0.01, `under its top at -50, ${o}`);
  }
  // A wider disk spreads the end over more ground.
  const soft = islandShade(levels, towards(e, 0), { texel: 2, radius: 4 * SUN });
  assert.ok(shadeAt(soft, -92, 0) > shadeAt(shade, -92, 0) + 0.1);
  assert.ok(shadeAt(soft, -108, 0) < shadeAt(shade, -108, 0) - 0.1);
});

test('a sun from any way casts the same shadow, turned', () => {
  // A tower 20 m high, 8 m across, at the middle; the sun 15° up from four ways.
  const levels = plain((a, o) => (Math.abs(a) <= 4 && Math.abs(o) <= 4 ? 20 : 0));
  const length = 20 / Math.tan(15 * DEG);
  for (const azimuth of [0, 90, 180, 270, 37]) {
    const shade = islandShade(levels, towards(15, azimuth), { texel: 2, radius: SUN });
    const [ca, co] = [Math.cos(azimuth * DEG), Math.sin(azimuth * DEG)];
    const at = (d) => shadeAt(shade, -ca * d, -co * d);
    assert.ok(at(length * 0.6) < 0.05, `in it, from ${azimuth}°`);
    assert.ok(at(length + 12) > 0.95, `past it, from ${azimuth}°`);
    assert.ok(shadeAt(shade, ca * 30, co * 30) > 0.99, `on the sunny side, from ${azimuth}°`);
  }
});

test('a sun overhead shades nothing', () => {
  const levels = plain((a) => (a >= 0 && a <= 4 ? 10 : 0));
  const shade = islandShade(levels, [0, 1, 0], { texel: 2, radius: SUN });
  assert.ok(shade.visible.every((v) => v === 1));
});

// The game's grids at a quarter of their resolution for every seed, as tests/heightmap.test.js builds them.
const quarter = { ...config.world.terrain, blend: config.world.terrain.blend / 4, levels: config.world.terrain.levels.map((level) => ({ ...level, texel: 4 * level.texel })) };
const maps = new Map();
function quarterMap(seed) {
  if (!maps.has(seed)) maps.set(seed, buildHeightmap(createIsland(createRandom(seed)), quarter));
  return maps.get(seed);
}

// The ground as the shade sees it: the drawn heights at its samples (which
// lie on the finest grid's), as lines between them.
function seenGround(heightmap, { origin, texel, samples: n }) {
  const heights = new Float64Array(n * n);
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) heights[j * n + i] = heightmap.heightAtCove(origin[0] + i * texel, origin[1] + j * texel);
  return (a, o) => {
    const fx = Math.min(Math.max((a - origin[0]) / texel, 0), n - 1.001);
    const fy = Math.min(Math.max((o - origin[1]) / texel, 0), n - 1.001);
    const [i, j] = [Math.floor(fx), Math.floor(fy)];
    const [u, v] = [fx - i, fy - j];
    const k = j * n + i;
    return (heights[k] * (1 - u) + heights[k + 1] * u) * (1 - v) + (heights[k + n] * (1 - u) + heights[k + n + 1] * u) * v;
  };
}

// By the definition: the ground's horizon at a, o towards the sun (radians
// over level), marched in quarter texels over `ground`, and how far off the
// ground that makes it lies.
function marched(ground, a, o, direction, step, end) {
  const across = Math.hypot(direction[0], direction[2]);
  const [sa, so] = [direction[0] / across, direction[2] / across];
  const here = ground(a, o);
  let horizon = -Math.PI / 2;
  let reach = step;
  for (let d = step; d < end; d += step) {
    const angle = Math.atan((ground(a + d * sa, o + d * so) - here) / d);
    if (angle > horizon) [horizon, reach] = [angle, d];
  }
  return { horizon, reach };
}

test('over every seed, the ground is in shade where its horizon towards the sun stands over the sun, and in sun where it stands under', () => {
  const ways = [towards(5, 200), towards(20, 30), towards(63, 110)];
  for (const seed of SEEDS) {
    const heightmap = quarterMap(seed);
    const { levels } = heightmap;
    // Every other sample of the finest grid: quick, and its samples still the grid's.
    const texel = 2 * levels[0].texel;
    const rng = createRandom(seed)('tests/shade');
    const fine = levels[0];
    const cells = fine.samples - 1;
    for (const direction of ways) {
      const elevation = Math.asin(direction[1]);
      const shade = islandShade(levels, direction, { texel, radius: SUN });
      const ground = seenGround(heightmap, shade);
      let lit = 0;
      let shaded = 0;
      for (let k = 0; k < 150; k++) {
        // On the land and the shallows, where the shade matters, at the shade's
        // own samples (on the finest grid's: shadeLayout).
        const a = fine.origin[0] + 2 * Math.round(rng.range(0.05, 0.45) * cells) * fine.texel;
        const o = fine.origin[1] + 2 * Math.round(rng.range(0.05, 0.45) * cells) * fine.texel;
        const here = heightmap.heightAtCove(a, o);
        if (here < -5) continue;
        // Here, and half a texel either side across the sun's way: a shadow's
        // side runs along it, and the shade knows where to the texel.
        const across = Math.hypot(direction[0], direction[2]);
        const [na, no] = [(-direction[2] / across) * (texel / 2), (direction[0] / across) * (texel / 2)];
        const sides = [[a, o], [a + na, o + no], [a - na, o - no]].map(([x, y]) => marched(ground, x, y, direction, texel / 4, 3000));
        const { horizon, reach } = sides[0];
        const low = Math.min(...sides.map((m) => m.horizon));
        const high = Math.max(...sides.map((m) => m.horizon));
        // The shade reads its horizons a little off the sample: give it the
        // angle that makes at the horizon's reach, the more where the ground is steep.
        const slope = Math.hypot(heightmap.heightAtCove(a + texel, o) - here, heightmap.heightAtCove(a, o + texel) - here) / texel;
        const margin = SUN + Math.atan((texel * (0.05 + 0.5 * slope)) / reach);
        const v = shadeAt(shade, a, o);
        const where = `seed ${seed} at ${a}, ${o}, horizon ${((horizon - elevation) / DEG).toFixed(2)}° over the sun at ${reach} m: ${v.toFixed(3)}`;
        if (high < elevation - margin) {
          assert.ok(v > 0.98, `lit ground in shade, ${where}`);
          lit++;
        } else if (low > elevation + margin) {
          assert.ok(v < 0.02, `shaded ground in sun, ${where}`);
          shaded++;
        }
      }
      if (elevation > 10 * DEG) assert.ok(lit > 10, `seed ${seed}: only ${lit} points clearly in sun at ${(elevation / DEG).toFixed(0)}°`);
      if (elevation < 10 * DEG) assert.ok(shaded > 3, `seed ${seed}: only ${shaded} points clearly in shade at ${(elevation / DEG).toFixed(0)}°`);
    }
  }
});

test('over every seed, a lower sun from the same way never lights ground a higher one shaded', () => {
  for (const seed of SEEDS) {
    const { levels } = quarterMap(seed);
    const texel = 2 * levels[0].texel;
    for (const azimuth of [30 + 9 * seed, 200 + 7 * seed]) {
      const high = islandShade(levels, towards(12, azimuth), { texel, radius: SUN });
      const low = islandShade(levels, towards(4, azimuth), { texel, radius: SUN });
      let worst = 0;
      for (let k = 0; k < high.visible.length; k++) worst = Math.max(worst, low.visible[k] - high.visible[k]);
      assert.ok(worst < 0.02, `seed ${seed}, ${azimuth}°: a lower sun lit ground by ${worst.toFixed(3)} more`);
    }
  }
});

// The top alone misses the outer half of a far ridge's soft edge where nearer
// ground grazes the sun's line (world/shade.js): what stands on the ground
// sees the ground's share at its foot, and goes to the top's over ABOVE_GROUND.
test('what stands on the ground sees its share at its foot, no less higher up, and the share at its height from ABOVE_GROUND up', () => {
  const { levels } = quarterMap(1);
  const heightmap = quarterMap(1);
  const shade = islandShade(levels, towards(8, 250), { texel: levels[0].texel, radius: 4 * SUN });
  const n = shade.samples;
  for (let j = 8; j < n - 8; j += 37) {
    for (let i = 8; i < n - 8; i += 41) {
      const a = shade.origin[0] + i * shade.texel;
      const o = shade.origin[1] + j * shade.texel;
      const ground = heightmap.heightAtCove(a, o);
      if (ground < -5) continue;
      const on = shadeAt(shade, a, o);
      assert.equal(shadeAbove(shade, a, o, ground, ground), on, `at its foot at ${a}, ${o}`);
      // Past ABOVE_GROUND, the share at its height alone: the same 1 m and 10 m higher on a pole twice as high.
      const top = ABOVE_GROUND + 1;
      assert.equal(shadeAbove(shade, a, o, ground + top, ground), shadeAbove(shade, a, o, ground + top, ground - 10), `at ${top} m at ${a}, ${o}`);
      // Halfway up, between the two.
      const half = shadeAbove(shade, a, o, ground + ABOVE_GROUND / 2, ground);
      const alone = shadeAbove(shade, a, o, ground + ABOVE_GROUND / 2, ground - 10);
      assert.ok(half >= Math.min(on, alone) - 1e-9 && half <= Math.max(on, alone) + 1e-9, `halfway at ${a}, ${o}`);
      // And never less higher up.
      assert.ok(shadeAbove(shade, a, o, ground + 30, ground) >= on - 1e-6, `higher at ${a}, ${o}`);
    }
  }
});

// The workers' way (sky/shadows.js, world/shade-worker.js): bands of strips,
// packed, put together in any order.
test("the shade's bands cover every sample once, and put together are the shade however it is cut", () => {
  const { levels } = quarterMap(3);
  const texel = levels[0].texel;
  const layout = shadeLayout(levels, texel);
  const heights = latticeHeights(levels, layout);
  const n = layout.samples;
  // Along each axis (w constant along a row, or along a column), between them, and overhead.
  for (const direction of [towards(10, 0), towards(25, 90), towards(5, 217), towards(40, 333), [0, 1, 0]]) {
    const whole = packShade(islandShade(levels, direction, { texel, radius: SUN, around: 24 }));
    const turned = turnShade(layout, direction);
    for (const size of [5, 64, 1e6]) {
      const covered = new Uint8Array(n * n);
      const merger = shadeMerger(layout, 24);
      for (const [first, end] of shadeBands(turned, size).reverse()) {
        const piece = shadeStrips(heights, layout, turned, SUN, first, end);
        for (let j = 0; j < n; j++) for (let i = piece.runs[2 * j]; i < piece.runs[2 * j + 1]; i++) covered[j * n + i]++;
        merger.place(packPiece(piece));
      }
      const where = `from ${direction.map((c) => c.toFixed(2))}, in bands of ${size}`;
      assert.ok(covered.every((c) => c === 1), `a sample in ${covered.some((c) => c > 1) ? 'two bands' : 'none'}, ${where}`);
      const merged = merger.finish();
      const off = merged.findIndex((texel, k) => texel !== whole[k]);
      assert.ok(off < 0, `texel ${off} differs, ${where}`);
    }
  }
});

test('seen() is the angle the horizon stands over the sun, in disk radii', () => {
  const e = 10 * DEG;
  for (const [below, reach] of [[0, 50], [5, 100], [-5, 100], [30, 2000], [-200, 3]]) {
    const angle = Math.atan(Math.tan(e) + below / reach) - e;
    assert.ok(Math.abs(seen(below, reach, Math.sin(e), Math.cos(e), SUN) - sunDisk(angle / SUN)) < 1e-9, `${below} m under at ${reach} m`);
  }
});
