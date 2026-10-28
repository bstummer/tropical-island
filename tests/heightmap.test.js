// The heightmap's grids (world/heightmap.js): how they are laid out for the
// island, nest and cover it, that they hold the island's heights and ground
// however their rows arrive, that the drawn height has no seams, and that the
// drawn ground keeps the zones' rules. The GPU's side is checked in the
// browser (src/fixtures/terrain.js).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRandom } from '../src/core/random.js';
import { config } from '../src/config.js';
import { createIsland, LAND_ZONES } from '../src/world/island.js';
import { buildHeightmap, createGrids, CUBIC_OVERSHOOT, cubicWeights, fillRows, gridAlign, GROUND, layoutLevel } from '../src/world/heightmap.js';

const settings = config.world.terrain;
const SEEDS = Array.from({ length: 20 }, (_, i) => i + 1);

// The box a level covers, shrunk by `inset` samples.
function box({ origin, texel, samples }, inset = 0) {
  return {
    minA: origin[0] + inset * texel,
    maxA: origin[0] + (samples - 1 - inset) * texel,
    minO: origin[1] + inset * texel,
    maxO: origin[1] + (samples - 1 - inset) * texel,
  };
}
const contains = (outer, inner) => outer.minA <= inner.minA && outer.maxA >= inner.maxA && outer.minO <= inner.minO && outer.maxO >= inner.maxO;
const holds = (b, a, o) => a >= b.minA && a <= b.maxA && o >= b.minO && o <= b.maxO;

// A small layout, quick to build in a test: its levels where it puts them.
const small = {
  samples: 64,
  blend: 4,
  levels: [8, 16, 32, 64].map((texel) => ({ texel, centre: [0, -300] })),
};
const smallLevels = (island) => small.levels.map((_, k) => layoutLevel(island, small, k));

// The game's grids at a quarter of their resolution, laid out for each
// island as the game's are: quick to build for every seed.
const quarter = { blend: settings.blend / 4, levels: settings.levels.map((level) => ({ ...level, texel: 4 * level.texel })) };

// The game's layout for a seed: the coarse grid's heights (fillRows's, which
// the fine one's layout reads alone), the fine one laid out on them.
const gameLayouts = new Map();
function gameLayout(seed) {
  if (!gameLayouts.has(seed)) {
    const island = createIsland(createRandom(seed));
    const coarse = layoutLevel(island, settings, 1);
    const { origin, texel, samples } = coarse;
    const heights = new Float32Array(samples ** 2);
    const out = {};
    for (let j = 0; j < samples; j++) for (let i = 0; i < samples; i++) heights[j * samples + i] = island.evaluate(origin[0] + i * texel, origin[1] + j * texel, out).height;
    gameLayouts.set(seed, { island, levels: [layoutLevel(island, settings, 0, { ...coarse, heights }), coarse] });
  }
  return gameLayouts.get(seed);
}
// The game's layout is checked for these: seeds 17, 19, 48, 68 and 70 laid the
// fine grid out past the coarse one's edge.
const GAME_SEEDS = [...SEEDS, 48, 68, 70];

// Round the cove, the game's grids but smaller, quick to build for every
// seed: 2 m apart over the beach, the bay and the headland, where sand meets rock.
const cove = { samples: 256, blend: 8, levels: settings.levels.map(({ texel }) => ({ texel, centre: [55, 0] })) };
const coveMaps = new Map(); // seed -> { island, heightmap }, built once for the tests
function coveMap(seed) {
  if (!coveMaps.has(seed)) {
    const island = createIsland(createRandom(seed));
    coveMaps.set(seed, { island, heightmap: buildHeightmap(island, cove) });
  }
  return coveMaps.get(seed);
}

test("each level lies inside the next coarser one's full share", () => {
  const layouts = [
    { blend: small.blend, levels: smallLevels(null) },
    ...GAME_SEEDS.map((seed) => ({ blend: settings.blend, levels: gameLayout(seed).levels })),
    ...SEEDS.map((seed) => ({ blend: quarter.blend, levels: quarterMap(seed).levels })),
  ];
  for (const { blend, levels } of layouts) {
    for (let k = 0; k < levels.length - 1; k++) {
      // The coarsest has its full say but at its last sample.
      const full = box(levels[k + 1], k + 1 === levels.length - 1 ? 1 : blend + 1);
      assert.ok(contains(full, box(levels[k])), `the ${levels[k].texel} m level reaches into the ${levels[k + 1].texel} m level's blend band`);
    }
  }
});

test('the shaders know as many levels as config.world.terrain lays out', () => {
  const wgsl = readFileSync(new URL('../src/shaders/chunks/terrain.wgsl', import.meta.url), 'utf8');
  const js = readFileSync(new URL('../src/world/terrain.js', import.meta.url), 'utf8');
  assert.equal(Number(wgsl.match(/const TERRAIN_LEVELS: i32 = (\d+);/)[1]), settings.levels.length, 'chunks/terrain.wgsl');
  assert.equal(Number(js.match(/const TERRAIN_LEVELS = (\d+);/)[1]), settings.levels.length, 'world/terrain.js');
});

test('the grids laid out for an island halve exactly for every level of their mipmaps, and their samples lie on one set of lines', () => {
  // The GPU halves a texture's size rounding down: a level that rounded would
  // lie off where it is read, by up to a texel of it. The last level's texels
  // reach past a far pixel's footprint: 256 samples, 512 m on the fine grid.
  assert.ok(gridAlign(settings) >= 256);
  for (const seed of GAME_SEEDS) {
    const { levels } = gameLayout(seed);
    const coarse = levels.at(-1);
    for (const { texel, origin, samples } of levels) {
      for (let size = samples, level = 1; level < settings.mips; level++) {
        assert.equal(size % 2, 0, `seed ${seed}: the ${texel} m grid's mip ${level - 1} is ${size} texels across`);
        size /= 2;
      }
      // On the coarse grid's lines, so where both have a sample it is the same.
      for (const c of [0, 1]) assert.ok(origin[c] % coarse.texel === 0, `seed ${seed}: the ${texel} m grid's corner ${origin}`);
    }
  }
});

test('between samples the curve overshoots the 4 x 4 samples it is made of by no more than CUBIC_OVERSHOOT of their range, and by that much at worst', () => {
  const r = createRandom(1)('test/overshoot');
  const [wa, wo] = [new Float64Array(4), new Float64Array(4)];
  const height = (h, tx, ty) => {
    cubicWeights(tx, wa);
    cubicWeights(ty, wo);
    let sum = 0;
    for (let y = 0; y < 4; y++) for (let x = 0; x < 4; x++) sum += wo[y] * wa[x] * h[4 * y + x];
    return sum;
  };
  let worst = 0;
  for (let n = 0; n < 20_000; n++) {
    // Random heights, and cliffs: each sample low or high.
    const h = Array.from({ length: 16 }, () => (n % 2 ? r.range(-50, 50) : r.chance(0.5) ? 0 : 40));
    const [lo, hi] = [Math.min(...h), Math.max(...h)];
    if (hi === lo) continue;
    const v = height(h, r.next(), r.next());
    worst = Math.max(worst, (v - hi) / (hi - lo), (lo - v) / (hi - lo));
  }
  assert.ok(worst <= CUBIC_OVERSHOOT + 1e-12, `overshoots by ${worst.toFixed(4)} of the range`);
  // The worst: high where one weight is an outer one, low elsewhere, at the middle.
  const pit = [0, 1, 1, 0, 1, 0, 0, 1, 1, 0, 0, 1, 0, 1, 1, 0];
  assert.ok(Math.abs(height(pit, 0.5, 0.5) + CUBIC_OVERSHOOT) < 1e-12, `the worst case dips to ${height(pit, 0.5, 0.5)}`);
});

test('the coarse grid reaches past the island and its reef into deep water', () => {
  const out = {};
  for (const seed of SEEDS) {
    const island = createIsland(createRandom(seed));
    const edge = box(layoutLevel(island, settings, settings.levels.length - 1), 1);
    for (let t = 0; t <= 1; t += 0.005) {
      for (const [a, o] of [
        [edge.minA + t * (edge.maxA - edge.minA), edge.minO],
        [edge.minA + t * (edge.maxA - edge.minA), edge.maxO],
        [edge.minA, edge.minO + t * (edge.maxO - edge.minO)],
        [edge.maxA, edge.minO + t * (edge.maxO - edge.minO)],
      ]) {
        const h = island.evaluate(a, o, out).height;
        assert.ok(h < -30, `seed ${seed}: ${h.toFixed(1)} m at the coarse grid's edge, ${a.toFixed(0)}, ${o.toFixed(0)}`);
      }
    }
  }
});

test('the fine grid has its full say over all the land and the sea shallower than its depth, the cove no different', () => {
  // Wherever the fine grid hasn't, the ground lies deeper: checked every 8 m
  // with the game's layout and every 16 m with the quarter's, for every seed.
  const cases = [
    ...GAME_SEEDS.map((seed) => ({ seed, ...gameLayout(seed), blend: settings.blend, step: 8 })),
    ...SEEDS.map((seed) => ({ seed, island: createIsland(createRandom(seed)), levels: quarterMap(seed).levels, blend: quarter.blend, step: 16 })),
  ];
  const out = {};
  for (const { seed, island, levels, blend, step } of cases) {
    const [fine, coarse] = levels;
    const full = box(fine, blend + 1);
    const all = box(coarse, 1);
    let outside = 0;
    for (let a = all.minA; a <= all.maxA; a += step) {
      for (let o = all.minO; o <= all.maxO; o += step) {
        if (holds(full, a, o)) continue;
        outside++;
        const h = island.evaluate(a, o, out).height;
        assert.ok(h <= -settings.levels[0].depth, `seed ${seed}: ${h.toFixed(1)} m at ${a}, ${o}, off the ${fine.texel} m grid's full say`);
      }
    }
    assert.ok(outside > 1000, `seed ${seed}: only ${outside} points off the fine grid`);
    // The cove's bay, beach and hills are on it like the rest.
    assert.ok(contains(full, { minA: -350, maxA: 300, minO: -650, maxO: 190 }), `seed ${seed}: the cove is not all on the fine grid`);
  }
});

test('a level fitted to a coarser one is laid out, and its rows handed out, once that one is in', () => {
  const island = createIsland(createRandom(3));
  const laidOut = [];
  const grids = createGrids(island, quarter, { onLayout: (k, layout) => laidOut.push([k, layout]) });
  assert.deepEqual(laidOut.map(([k]) => k), [1], 'the coarse grid first, alone');
  const coarse = laidOut[0][1];
  assert.deepEqual(coarse, layoutLevel(island, quarter, 1));
  // Its rows in two blocks: the fine grid waits for the second.
  const half = coarse.samples >> 1;
  const blocks = [[0, half], [half, coarse.samples]].map(([j0, j1]) => {
    const n = (j1 - j0) * coarse.samples;
    const block = { level: 1, j0, heights: new Float32Array(n), info: new Float32Array(4 * n), ground: new Uint8Array(GROUND * n) };
    fillRows(island, coarse, j0, j1, block.heights, block.info, block.ground);
    return block;
  });
  grids.store(blocks[0]);
  assert.equal(laidOut.length, 1, 'the fine grid laid out before the coarse one is in');
  grids.store(blocks[1]);
  assert.deepEqual(laidOut.map(([k]) => k), [1, 0]);
  assert.deepEqual(laidOut[1][1], layoutLevel(island, quarter, 0, grids.levels[1]));
  assert.throws(() => grids.finish(), /rows missing/);
  assert.equal(layoutLevel(island, quarter, 0), null, 'a fine grid laid out without the coarse one');
});

test("every sample is the island's height there", () => {
  for (const seed of SEEDS.slice(0, 4)) {
    const island = createIsland(createRandom(seed));
    const heightmap = buildHeightmap(island, small);
    const r = createRandom(seed)('test/samples');
    const out = {};
    for (const { origin, texel, heights } of heightmap.levels) {
      for (let n = 0; n < 200; n++) {
        const i = r.int(0, small.samples - 1);
        const j = r.int(0, small.samples - 1);
        const h = island.evaluate(origin[0] + i * texel, origin[1] + j * texel, out).height;
        assert.equal(heights[j * small.samples + i], Math.fround(h), `seed ${seed}: sample ${i}, ${j} of the ${texel} m level`);
      }
    }
  }
});

test('the drawn height has no seams: it changes smoothly across the edges of every level', () => {
  for (const seed of SEEDS.slice(0, 4)) {
    const island = createIsland(createRandom(seed));
    const heightmap = buildHeightmap(island, small);
    let steepest = 0;
    for (const { info } of heightmap.levels) for (let n = 0; n < info.length; n += 4) steepest = Math.max(steepest, Math.hypot(info[n], info[n + 1]));
    // Lines out from the levels' common centre, across every level's edge.
    for (let k = 0; k < 16; k++) {
      const angle = (k * Math.PI) / 8 + 0.1;
      const step = 0.5;
      let last = heightmap.heightAtCove(0, -300);
      for (let t = step; t < 1900; t += step) {
        const h = heightmap.heightAtCove(Math.cos(angle) * t, -300 + Math.sin(angle) * t);
        assert.ok(Math.abs(h - last) <= 2 * steepest * step + 1e-3, `seed ${seed}: a step of ${(h - last).toFixed(2)} m over ${step} m, ${t} m out at ${((angle * 180) / Math.PI).toFixed(0)}°`);
        last = h;
      }
    }
  }
});

test("between the samples, the drawn height stays close to the island's", () => {
  // Bilinear between samples, it misses a little on curved ground; shifted
  // half a sample, in JS and GLSL alike, it misses by far more. On the game's
  // spacings, each where the game draws from it: the island's relief reaches
  // down to four of the fine grid's samples, and the coarse one draws only
  // the deep sea, smooth at its spacing.
  for (const seed of SEEDS.slice(0, 4)) {
    const { island, heightmap } = coveMap(seed);
    const r = createRandom(seed)('test/between');
    const out = {};
    const { depth } = settings.levels[0];
    heightmap.levels.forEach(({ origin, texel, samples }, k) => {
      const last = samples - 1;
      const coarsest = k === heightmap.levels.length - 1;
      const full = coarsest ? [1, last - 1] : [cove.blend + 1, last - cove.blend - 1];
      const misses = [];
      while (misses.length < 400) {
        const [a, o] = [origin[0] + r.range(...full) * texel, origin[1] + r.range(...full) * texel];
        const h = island.evaluate(a, o, out).height;
        if (coarsest && h > -depth) continue;
        misses.push(Math.abs(heightmap.heightAtCove(a, o, k) - h));
      }
      misses.sort((p, q) => p - q);
      const median = misses[misses.length >> 1];
      assert.ok(median <= 0.04 * texel, `seed ${seed}: the ${texel} m level misses the island by ${median.toFixed(2)} m (median)`);
    });
  }
});

test('the drawn ground has no corners at its samples: its slope runs on across them', () => {
  // A curve through the samples, not straight lines between them, which
  // would turn the slope at every sample: on a skyline up close, a polygon.
  const e = 1e-3;
  for (const seed of SEEDS.slice(0, 4)) {
    const { heightmap } = coveMap(seed);
    const { origin, texel, samples } = heightmap.levels[0];
    const r = createRandom(seed)('test/corners');
    const h = (a, o) => heightmap.heightAtCove(a, o);
    let worst = 0;
    for (let n = 0; n < 400; n++) {
      // On a line of samples one way, anywhere along it the other.
      const i = r.int(cove.blend + 2, samples - cove.blend - 3);
      const g = r.range(cove.blend + 2, samples - cove.blend - 3);
      for (const [a, o, da, dO] of [[origin[0] + i * texel, origin[1] + g * texel, e, 0], [origin[0] + g * texel, origin[1] + i * texel, 0, e]]) {
        const before = (h(a, o) - h(a - da, o - dO)) / e;
        const after = (h(a + da, o + dO) - h(a, o)) / e;
        worst = Math.max(worst, Math.abs(after - before));
      }
    }
    assert.ok(worst < 0.01, `seed ${seed}: the slope turns by ${worst.toFixed(3)} across a sample`);
  }
});

test("the drawn height doesn't jump where a level starts to fade or ends", () => {
  const step = 1e-3;
  for (const seed of SEEDS.slice(0, 4)) {
    const island = createIsland(createRandom(seed));
    const heightmap = buildHeightmap(island, small);
    let steepest = 0;
    for (const { info } of heightmap.levels) for (let n = 0; n < info.length; n += 4) steepest = Math.max(steepest, Math.hypot(info[n], info[n + 1]));
    const last = small.samples - 1;
    const r = createRandom(seed)('test/edges');
    heightmap.levels.slice(0, -1).forEach(({ origin, texel }) => {
      for (const f of [1, 1 + small.blend, last - 1 - small.blend, last - 1]) {
        for (let n = 0; n < 20; n++) {
          const g = r.range(f === 1 || f === last - 1 ? 1 : 1 + small.blend, f === 1 || f === last - 1 ? last - 1 : last - 1 - small.blend);
          for (const [fa, fo] of [[f, g], [g, f]]) {
            const [a, o] = [origin[0] + fa * texel, origin[1] + fo * texel];
            const [da, doo] = fa === f ? [step, 0] : [0, step];
            const jump = Math.abs(heightmap.heightAtCove(a + da, o + doo) - heightmap.heightAtCove(a - da, o - doo));
            assert.ok(jump <= 2 * steepest * 2 * step + 1e-4, `seed ${seed}: a step of ${jump.toFixed(4)} m across ${2 * step} m at the ${texel} m level's sample ${fa.toFixed(1)}, ${fo.toFixed(1)}`);
          }
        }
      }
    });
  }
});

test("the slopes are the grid's own", () => {
  const island = createIsland(createRandom(1));
  const heightmap = buildHeightmap(island, small);
  const { samples } = small;
  for (const { texel, heights, info } of heightmap.levels) {
    for (const [i, j] of [[10, 20], [31, 31], [50, 7]]) {
      const n = j * samples + i;
      const along = (heights[n + 1] - heights[n - 1]) / (2 * texel);
      const out = (heights[n + samples] - heights[n - samples]) / (2 * texel);
      assert.ok(Math.abs(info[4 * n] - along) < 1e-6 && Math.abs(info[4 * n + 1] - out) < 1e-6, `${texel} m level at ${i}, ${j}`);
    }
  }
});

test('rows filled in parts, as the workers fill them, are the rows filled whole', () => {
  const island = createIsland(createRandom(1));
  const { samples } = small;
  for (const level of smallLevels(island)) {
    const fill = (j0, j1) => {
      const rows = j1 - j0;
      const part = { heights: new Float32Array(rows * samples), info: new Float32Array(4 * rows * samples), ground: new Uint8Array(GROUND * rows * samples) };
      fillRows(island, level, j0, j1, part.heights, part.info, part.ground);
      return part;
    };
    const whole = fill(0, samples);
    for (let j0 = 0; j0 < samples; j0 += 7) {
      const j1 = Math.min(j0 + 7, samples);
      const part = fill(j0, j1);
      assert.deepEqual(part.heights, whole.heights.subarray(j0 * samples, j1 * samples), `heights of rows ${j0}-${j1}`);
      assert.deepEqual(part.info, whole.info.subarray(4 * j0 * samples, 4 * j1 * samples), `info of rows ${j0}-${j1}`);
      assert.deepEqual(part.ground, whole.ground.subarray(GROUND * j0 * samples, GROUND * j1 * samples), `ground of rows ${j0}-${j1}`);
    }
  }
});

test('rows stored in any order, as the workers return them, make the grids built whole; each level is handed on, lush and all, once its last rows are in', () => {
  const island = createIsland(createRandom(2));
  const whole = buildHeightmap(island, small);
  const { samples } = small;
  const levels = smallLevels(island);
  // Every level in blocks of 5 rows, shuffled.
  const blocks = [];
  levels.forEach((level, k) => {
    for (let j0 = 0; j0 < samples; j0 += 5) {
      const j1 = Math.min(j0 + 5, samples);
      const rows = j1 - j0;
      const block = { level: k, j0, heights: new Float32Array(rows * samples), info: new Float32Array(4 * rows * samples), ground: new Uint8Array(GROUND * rows * samples) };
      fillRows(island, level, j0, j1, block.heights, block.info, block.ground);
      blocks.push(block);
    }
  });
  const r = createRandom(2)('test/blocks');
  for (let i = blocks.length - 1; i > 0; i--) {
    const j = r.int(0, i);
    [blocks[i], blocks[j]] = [blocks[j], blocks[i]];
  }
  const same = (level, k, when) => {
    for (const kind of ['heights', 'info', 'ground']) assert.deepEqual(level[kind], whole.levels[k][kind], `level ${k}'s ${kind} ${when}`);
  };
  const handed = [];
  const grids = createGrids(island, small, {
    onLevel(k, level) {
      same(level, k, 'when handed on');
      handed.push(k);
    },
  });
  const lastBlock = levels.map((_, k) => blocks.findLastIndex((block) => block.level === k));
  blocks.forEach((block, i) => {
    grids.store(block);
    const due = levels.map((_, k) => k).filter((k) => lastBlock[k] <= i).sort((p, q) => lastBlock[p] - lastBlock[q]);
    assert.deepEqual(handed, due, `after ${i + 1} blocks`);
  });
  const built = grids.finish();
  levels.forEach((_, k) => same(built.levels[k], k, 'when finished'));
  assert.throws(() => createGrids(island, small).finish(), /rows missing/);
});

// The steepest the drawn ground gets in the cells round sample i, j (rise
// over run): bilinear, a cell is steepest at one of its corners, so here at
// every corner of every cell.
// height(i, j): a sample's height, of the ground or of the land under its roughness.
function steepestAround(height, samples, texel, i, j) {
  let steepest = 0;
  for (const ci of [i - 1, i]) {
    for (const cj of [j - 1, j]) {
      if (ci < 0 || cj < 0 || ci >= samples - 1 || cj >= samples - 1) continue;
      const h = (x, y) => height(ci + x, cj + y);
      for (const [x, y] of [[0, 0], [1, 0], [0, 1], [1, 1]]) steepest = Math.max(steepest, Math.hypot(h(1, y) - h(0, y), h(x, 1) - h(x, 0)) / texel);
    }
  }
  return steepest;
}

test("every sample's ground is the island's there, given the steepest the drawn ground, and the land under it, get round it", () => {
  for (const seed of SEEDS.slice(0, 4)) {
    const island = createIsland(createRandom(seed));
    const heightmap = buildHeightmap(island, small);
    const r = createRandom(seed)('test/ground');
    const out = {};
    for (const { origin, texel, heights, info, ground } of heightmap.levels) {
      for (let k = 0; k < 300; k++) {
        const n = r.int(0, small.samples * small.samples - 1);
        const [i, j] = [n % small.samples, Math.floor(n / small.samples)];
        const land = (x, y) => Math.fround(island.evaluate(origin[0] + x * texel, origin[1] + y * texel, {}).land);
        const drawn = (x, y) => heights[y * small.samples + x];
        const steep = steepestAround(drawn, small.samples, texel, i, j);
        const g = island.groundOf(island.evaluate(origin[0] + i * texel, origin[1] + j * texel, out), steep, {}, steepestAround(land, small.samples, texel, i, j));
        const rock = Math.round(g.rock * 255);
        assert.deepEqual(
          [ground[GROUND * n], ground[GROUND * n + 1], ground[GROUND * n + 3], info[4 * n + 2], info[4 * n + 3]],
          [Math.min(Math.round(g.sand * 255), 255 - rock), rock, Math.round(g.sandy * 255), Math.fround(g.band), Math.fround(g.reef)],
          `seed ${seed}: sample ${i}, ${j} of the ${texel} m level`,
        );
      }
    }
  }
});

const quarterMaps = new Map(); // seed -> heightmap, built once for the tests below
function quarterMap(seed) {
  if (!quarterMaps.has(seed)) quarterMaps.set(seed, buildHeightmap(createIsland(createRandom(seed)), quarter));
  return quarterMaps.get(seed);
}

// Calls visit(a, o, ground, k) at a seeded point in every cell of every level
// of a quarterMap, wherever that level has its say (none where a finer one has
// all of it), with the ground drawn there.
function everyCell(heightmap, r, visit) {
  const { blend } = quarter;
  // How far inside a level's box a, o lies, in samples (0 at the edge of its say).
  const inside = ({ origin, texel, samples }, a, o) => {
    const [fx, fy] = [(a - origin[0]) / texel, (o - origin[1]) / texel];
    return Math.min(fx, fy, samples - 1 - fx, samples - 1 - fy) - 1;
  };
  const g = {};
  const { levels } = heightmap;
  levels.forEach((level, k) => {
    const { origin, texel, samples } = level;
    const last = samples - 1;
    for (let j = 0; j < last; j++) {
      for (let i = 0; i < last; i++) {
        const [a, o] = [origin[0] + (i + r.next()) * texel, origin[1] + (j + r.next()) * texel];
        if (k < levels.length - 1 && inside(level, a, o) <= 0) continue;
        if (levels.slice(0, k).some((finer) => inside(finer, a, o) >= blend)) continue;
        visit(a, o, heightmap.groundAtCove(a, o, g), k);
      }
    }
  });
}

const sandMax = Math.tan((config.world.island.zones.sandSlope[1] * Math.PI) / 180);
const degrees = (slope) => (Math.atan(slope) * 180) / Math.PI;

test('nowhere on the drawn island, at any level, does sand lie steeper than sand holds: not on cliffs far out, nor on the reef', () => {
  for (const seed of SEEDS) {
    const heightmap = quarterMap(seed);
    const { levels } = heightmap;
    // Per level, on land and under the sea: how many points of sand, and the steepest.
    const found = levels.map(() => [0, 1].map(() => ({ count: 0, steepest: 0, at: '' })));
    everyCell(heightmap, createRandom(seed)('test/island-sand'), (a, o, g, k) => {
      // Drawn as sand where most of it is sand, as zoneFrom has it; under the sea too.
      if (!(g.sand > g.rock && g.sand >= 1 - g.sand - g.rock)) return;
      const slope = drawnSlope(heightmap, a, o, 1e-3 * levels[k].texel);
      const f = found[k][heightmap.heightAtCove(a, o) < 0 ? 1 : 0];
      f.count++;
      if (slope > f.steepest) Object.assign(f, { steepest: slope, at: `${a.toFixed(1)}, ${o.toFixed(1)}` });
    });
    const steep = [];
    found.forEach((both, k) =>
      both.forEach(({ count, steepest, at }, sea) => {
        const where = `the ${levels[k].texel} m level ${sea ? 'under the sea' : 'on land'}`;
        if (steepest > sandMax) steep.push(`${where}, ${degrees(steepest).toFixed(1)}° at ${at}`);
        // Every level has sand under the sea to judge, and the fine one on
        // land: the coarse one has no say there.
        if (sea || k === 0) assert.ok(count > (sea ? 500 : 5), `seed ${seed}: only ${count} points of sand on ${where}`);
      }),
    );
    assert.deepEqual(steep, [], `seed ${seed}: sand steeper than sand holds on ${steep.join('; ')}`);
  }
});

test('nowhere on the drawn island, at any level, is the soil sandy steeper than sand holds: not in the hollows of a cliff behind a beach', () => {
  for (const seed of SEEDS) {
    const heightmap = quarterMap(seed);
    const { levels } = heightmap;
    let count = 0;
    const steep = [];
    everyCell(heightmap, createRandom(seed)('test/island-sandy'), (a, o, g, k) => {
      // Where some of the ground is green, its bare ground more sand than soil.
      if (!(g.sandy > 0.5 && 1 - g.sand - g.rock > 1e-3) || heightmap.heightAtCove(a, o) < 0) return;
      count++;
      const slope = drawnSlope(heightmap, a, o, 1e-3 * levels[k].texel);
      if (slope > sandMax) steep.push(`the ${levels[k].texel} m level, ${degrees(slope).toFixed(1)}° at ${a.toFixed(1)}, ${o.toFixed(1)}`);
    });
    assert.ok(count > 100, `seed ${seed}: only ${count} points of sandy soil`);
    assert.deepEqual(steep, [], `seed ${seed}: sandy soil steeper than sand holds on ${steep.slice(0, 5).join('; ')}${steep.length > 5 ? ` and ${steep.length - 5} more` : ''}`);
  }
});

test("every sample's lush is the island's there, given the grid's relief: how far it stands above the samples round it", () => {
  const { radius } = config.world.island.zones.lush;
  for (const seed of SEEDS.slice(0, 4)) {
    const island = createIsland(createRandom(seed));
    const heightmap = buildHeightmap(island, small);
    const r = createRandom(seed)('test/lush');
    const last = small.samples - 1;
    for (const { origin, texel, heights, info, ground } of heightmap.levels) {
      const reach = Math.max(1, Math.round(radius / texel));
      for (let k = 0; k < 200; k++) {
        const n = r.int(0, small.samples * small.samples - 1);
        const [i, j] = [n % small.samples, Math.floor(n / small.samples)];
        let sum = 0;
        let count = 0;
        for (let y = Math.max(j - reach, 0); y <= Math.min(j + reach, last); y++) {
          for (let x = Math.max(i - reach, 0); x <= Math.min(i + reach, last); x++) {
            sum += heights[y * small.samples + x];
            count++;
          }
        }
        const lush = heights[n] < 0 ? 0 : island.lushOf({ band: info[4 * n + 2] }, heights[n] - sum / count, origin[0] + i * texel, origin[1] + j * texel);
        assert.ok(Math.abs(ground[GROUND * n + 2] - lush * 255) <= 0.5 + 1e-6, `seed ${seed}: sample ${i}, ${j} of the ${texel} m level: ${ground[GROUND * n + 2]}, not ${(lush * 255).toFixed(2)}`);
      }
    }
  }
});

// The drawn ground's slope at a, o, by central differences.
function drawnSlope(heightmap, a, o, step = 0.25) {
  const h = (da, dO) => heightmap.heightAtCove(a + da, o + dO);
  return Math.hypot(h(step, 0) - h(-step, 0), h(0, step) - h(0, -step)) / (2 * step);
}

test('on the drawn ground the zones keep their order inland, and sand and sandy soil lie no steeper than sand holds', () => {
  for (const seed of SEEDS) {
    const { island, heightmap } = coveMap(seed);
    // From the waterline, walk up the beach and on inland on the 2 m grid: no
    // zone steps back towards the sea, but for a dent, one zone back for no
    // more than 15 m (as in tests/island.test.js).
    let walks = 0;
    const out = {};
    const coast = (a, o) => island.evaluate(a, o, out).coast;
    for (let a = -60; a <= 260; a += 8) {
      let o = 160;
      while (o > -150 && heightmap.heightAtCove(a, o) < 0) o -= 0.5;
      if (o <= -150) continue;
      walks++;
      let last = -1;
      let back = null; // where a dent began
      let behind = -Infinity;
      let [pa, po] = [a, o];
      for (let t = 0; t < 150; t++) {
        const here = coast(pa, po);
        if (here < behind + 0.5) break; // on a spine: the shore no longer falls behind
        behind = here;
        const zone = heightmap.zoneAtCove(pa, po);
        const index = LAND_ZONES.indexOf(zone);
        if (index >= 0) {
          if (index < last) {
            back ??= t;
            assert.equal(index, last - 1, `seed ${seed}: ${zone} after ${LAND_ZONES[last]} walking inland from ${a}, ${o}`);
            assert.ok(t - back <= 15, `seed ${seed}: ${zone} after ${LAND_ZONES[last]} for ${t - back} m walking inland from ${a}, ${o}`);
          } else {
            back = null;
            last = index;
          }
        }
        const [ga, go] = [coast(pa + 0.5, po) - coast(pa - 0.5, po), coast(pa, po + 0.5) - coast(pa, po - 0.5)];
        const length = Math.hypot(ga, go) || 1;
        pa += ga / length;
        po += go / length;
      }
    }
    assert.ok(walks > 30, `seed ${seed}: only ${walks} walks inland`);
    // Sand where the drawn ground is too steep for it would slide, and so
    // would the sand in sandy soil: in the hollows of the headland's cliff.
    const r = createRandom(seed)('test/drawn-sand');
    const g = {};
    let sand = 0;
    let soil = 0;
    for (let k = 0; k < 20_000; k++) {
      const [a, o] = [r.range(-170, 280), r.range(-170, 170)];
      const zone = heightmap.zoneAtCove(a, o);
      heightmap.groundAtCove(a, o, g);
      const sandy = g.sandy > 0.5 && 1 - g.sand - g.rock > 1e-3 && heightmap.heightAtCove(a, o) >= 0; // green on bare ground more sand than soil
      if (zone !== 'wet-sand' && zone !== 'dry-sand' && !sandy) continue;
      if (sandy) soil++;
      else sand++;
      const slope = drawnSlope(heightmap, a, o);
      assert.ok(slope <= sandMax, `seed ${seed}: ${sandy ? 'sandy soil' : zone} drawn on a slope of ${degrees(slope).toFixed(1)}° at ${a.toFixed(1)}, ${o.toFixed(1)}`);
    }
    assert.ok(sand > 1000 && soil > 500, `seed ${seed}: only ${sand} points of drawn sand and ${soil} of sandy soil`);
  }
});

test("the drawn zones are the island's nearly everywhere, and quick to look up", () => {
  for (const seed of SEEDS) {
    const { island, heightmap } = coveMap(seed);
    const r = createRandom(seed)('test/drawn-zones');
    let same = 0;
    const n = 2000;
    for (let k = 0; k < n; k++) {
      const [x, z] = island.fromCove(r.range(-170, 280), r.range(-170, 170));
      if (heightmap.zoneAt(x, z) === island.zone(x, z)) same++;
    }
    // They differ only along the zones' edges, where the grid's slope and its
    // bilinear ground stray from the island's: mostly on the cliffs, where the
    // green meets rock by slope and the grid, judging by the steepest ground
    // round a sample, draws more rock (98.8–99.9% the same over seeds 1–20).
    assert.ok(same / n > 0.98, `seed ${seed}: the drawn zone is the island's at only ${((100 * same) / n).toFixed(1)}% of points`);
  }
  // Placing plants by the hundred thousand (PLAN.md Stage 8) takes a blink.
  const { heightmap } = coveMap(1);
  const started = performance.now();
  let jungle = 0;
  for (let k = 0; k < 100_000; k++) if (heightmap.zoneAt((k % 400) - 200, ((k * 7) % 400) - 200) === 'jungle') jungle++;
  const ms = performance.now() - started;
  assert.ok(ms < 1000, `100,000 zones took ${ms.toFixed(0)} ms (${jungle} jungle)`);
});

test('the green is lusher in hollows and gullies than on ridges and spurs, deeper into the jungle alike', () => {
  for (const seed of SEEDS) {
    const { heightmap } = coveMap(seed);
    const g = {};
    const [hollows, ridges] = [[], []];
    // On the 2 m grid behind the beach, inland, where it is jungle: the
    // ground's relief over twice the lush's radius, from the drawn height.
    const { radius } = config.world.island.zones.lush;
    for (let a = -40; a <= 240; a += 6) {
      for (let o = -170; o <= -60; o += 6) {
        heightmap.groundAtCove(a, o, g);
        if (g.band < 2.5 || g.sand + g.rock > 0 || heightmap.heightAtCove(a, o) < 0) continue;
        let around = 0;
        for (let k = 0; k < 8; k++) around += heightmap.heightAtCove(a + radius * Math.cos((k * Math.PI) / 4), o + radius * Math.sin((k * Math.PI) / 4));
        const relief = heightmap.heightAtCove(a, o) - around / 8;
        if (relief < -1) hollows.push(g.lush);
        if (relief > 1) ridges.push(g.lush);
      }
    }
    const mean = (list) => list.reduce((sum, v) => sum + v, 0) / list.length;
    assert.ok(hollows.length > 10 && ridges.length > 10, `seed ${seed}: ${hollows.length} hollows and ${ridges.length} ridges`);
    assert.ok(mean(hollows) > mean(ridges) + 0.1, `seed ${seed}: hollows ${mean(hollows).toFixed(2)}, ridges ${mean(ridges).toFixed(2)}`);
  }
});
