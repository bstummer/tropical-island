// The heightmap's grids (world/heightmap.js): how they nest and cover the
// island, that they hold the island's heights, and that the drawn height has
// no seams. The GPU's side is checked in the browser (src/fixtures/terrain.js).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRandom } from '../src/core/random.js';
import { config } from '../src/config.js';
import { createIsland } from '../src/world/island.js';
import { buildHeightmap, layoutLevels } from '../src/world/heightmap.js';

const settings = config.world.terrain;
const SEEDS = Array.from({ length: 20 }, (_, i) => i + 1);

// The box a level covers, shrunk by `inset` samples.
function box({ origin, texel }, samples, inset = 0) {
  return {
    minA: origin[0] + inset * texel,
    maxA: origin[0] + (samples - 1 - inset) * texel,
    minO: origin[1] + inset * texel,
    maxO: origin[1] + (samples - 1 - inset) * texel,
  };
}
const contains = (outer, inner) => outer.minA <= inner.minA && outer.maxA >= inner.maxA && outer.minO <= inner.minO && outer.maxO >= inner.maxO;

// A small layout, quick to build in a test, laid out like the game's.
const small = {
  samples: 64,
  blend: 4,
  levels: [8, 16, 32, 64].map((texel) => ({ texel, centre: [0, -300] })),
};

test("each level lies inside the next coarser one's full share", () => {
  for (const layout of [settings, small]) {
    const levels = layoutLevels(layout);
    for (let k = 0; k < levels.length - 1; k++) {
      const full = box(levels[k + 1], layout.samples, layout.blend + 1);
      assert.ok(contains(full, box(levels[k], layout.samples)), `level ${k} reaches into level ${k + 1}'s blend band`);
    }
  }
});

test('the shaders know as many levels as config.world.terrain lays out', () => {
  const glsl = readFileSync(new URL('../src/shaders/chunks/terrain.glsl', import.meta.url), 'utf8');
  const js = readFileSync(new URL('../src/world/terrain.js', import.meta.url), 'utf8');
  assert.equal(Number(glsl.match(/#define TERRAIN_LEVELS (\d+)/)[1]), settings.levels.length, 'chunks/terrain.glsl');
  assert.equal(Number(js.match(/const TERRAIN_LEVELS = (\d+);/)[1]), settings.levels.length, 'world/terrain.js');
});

test('the coarsest level reaches past the island and its reef into deep water, and the finer ones cover the bay and the hills', () => {
  const levels = layoutLevels(settings);
  const { samples, blend } = settings;
  const edge = box(levels.at(-1), samples, 1);
  const out = {};
  for (const seed of SEEDS) {
    const island = createIsland(createRandom(seed));
    for (let t = 0; t <= 1; t += 0.005) {
      for (const [a, o] of [
        [edge.minA + t * (edge.maxA - edge.minA), edge.minO],
        [edge.minA + t * (edge.maxA - edge.minA), edge.maxO],
        [edge.minA, edge.minO + t * (edge.maxO - edge.minO)],
        [edge.maxA, edge.minO + t * (edge.maxO - edge.minO)],
      ]) {
        const h = island.evaluate(a, o, out).height;
        assert.ok(h < -30, `seed ${seed}: ${h.toFixed(1)} m at the coarsest level's edge, ${a.toFixed(0)}, ${o.toFixed(0)}`);
      }
    }
  }
  // In the cove's frame: the beach and bay on the 1 m grid, the hills up to the summit on the 2 m grid.
  assert.ok(contains(box(levels[0], samples, blend + 1), { minA: -200, maxA: 200, minO: -60, maxO: 190 }), 'the bay is not all on the finest grid');
  assert.ok(contains(box(levels[1], samples, blend + 1), { minA: -350, maxA: 300, minO: -650, maxO: 0 }), 'the hills are not all on the 2 m grid');
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
  // half a sample, in JS and GLSL alike, it misses by far more.
  for (const seed of SEEDS.slice(0, 4)) {
    const island = createIsland(createRandom(seed));
    const heightmap = buildHeightmap(island, small);
    const r = createRandom(seed)('test/between');
    const out = {};
    const last = small.samples - 1;
    heightmap.levels.forEach(({ origin, texel }, k) => {
      const full = k === heightmap.levels.length - 1 ? [1, last - 1] : [small.blend + 1, last - small.blend - 1];
      const misses = [];
      for (let n = 0; n < 400; n++) {
        const [a, o] = [origin[0] + r.range(...full) * texel, origin[1] + r.range(...full) * texel];
        misses.push(Math.abs(heightmap.heightAtCove(a, o) - island.evaluate(a, o, out).height));
      }
      misses.sort((p, q) => p - q);
      const median = misses[misses.length >> 1];
      assert.ok(median <= 0.04 * texel, `seed ${seed}: the ${texel} m level misses the island by ${median.toFixed(2)} m (median)`);
    });
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
