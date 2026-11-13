// How the lagoon's waves end on the beach (water/swash.js): properties of the run-up,
// on the game's own map along the cove's beach, and over seeds 1-20 on maps 8 m apart.
// The GPU's twin is the waves fixture's to check.
import test from 'node:test';
import assert from 'node:assert/strict';
import { config } from '../src/config.js';
import { createRandom } from '../src/core/random.js';
import { createIsland } from '../src/world/island.js';
import { buildHeightmap } from '../src/world/heightmap.js';
import { buildSeaMap } from '../src/water/sea-map.js';
import { createSwash, swellWay } from '../src/water/swash.js';
import { createSurface } from '../src/water/surface.js';
import { buildSpectrum } from '../src/water/spectrum.js';

const side = config.world.island.cove.headlandSide;
const { period } = config.water.surf;
const { loop } = config.water.waves;
const SEEDS = Array.from({ length: 20 }, (_, i) => i + 1);
// No fray, so where the edge stands can be told from the ground as drawn.
const settings = { ...config.water.swash, fray: 0 };

function beachOf(seed, terrain, mapSettings) {
  const island = createIsland(createRandom(seed));
  const heightmap = buildHeightmap(island, terrain);
  const map = buildSeaMap(heightmap, mapSettings, side, terrain.blend);
  const swash = createSwash(settings, config.water.surf, swellWay(config), period, loop);
  // The beach's water at world x, z and time t, as the game reads it.
  const at = (x, z, t, out = {}) => {
    const [a, o] = island.toCove(x, z);
    return swash(map.at(a, o), a, o, heightmap.heightAt(x, z), t - loop * Math.floor(t / loop), out);
  };
  return { island, heightmap, map, swash, at };
}

let game = null;
const gameBeach = () => (game ??= beachOf(config.defaults.seed, config.world.terrain, config.water.map));

// Points along the cove's beach: where its still waterline crosses lines running out to
// sea (+z, world/island.js), and `inland` m up the beach from there.
function alongCove({ heightmap }, inland = 0) {
  const points = [];
  for (let x = -180; x <= 60; x += 15) {
    let z = -40;
    while (heightmap.heightAt(x, z) > 0 && z < 300) z += 0.02;
    points.push([x, z - inland]);
  }
  return points;
}

// The edge's height every `step` s over [from, to): its highs and lows, wave by wave.
function edgeOver(at, [x, z], from, to, step = 0.05) {
  const levels = [];
  for (let t = from; t < to; t += step) levels.push(at(x, z, t).level);
  return levels;
}

test('on the cove\'s beach the edge runs up and back once a wave, every wave, and runs up faster than it drains', () => {
  const beach = gameBeach();
  for (const point of alongCove(beach)) {
    const step = 0.05;
    const levels = edgeOver(beach.at, point, 0, 5 * period, step);
    // Rises: a run of rising steps from a low to a high, then falling ones back to a low.
    const runs = [];
    let i = 0;
    while (i < levels.length - 1) {
      while (i < levels.length - 1 && levels[i + 1] <= levels[i] + 1e-6) i++;
      const start = i;
      while (i < levels.length - 1 && levels[i + 1] > levels[i] + 1e-6) i++;
      const top = i;
      while (i < levels.length - 1 && levels[i + 1] < levels[i] - 1e-6) i++;
      // A whole run only: one the window cuts off isn't one.
      if (top > start && i > top && i < levels.length - 1 && levels[top] - levels[start] > 0.01) runs.push({ up: (top - start) * step, down: (i - top) * step, height: levels[top] });
    }
    // Five waves' time holds three whole runs at least, and no more than one a wave.
    assert.ok(runs.length >= 3 && runs.length <= 5, `at ${point}: ${runs.length} runs up in ${5 * period} s`);
    for (const run of runs) assert.ok(run.up < run.down, `at ${point}: up in ${run.up} s, back in ${run.down} s`);
  }
});

test('each wave runs up the beach a height of its own, as far as the sets and the lobes along the beach make it', () => {
  const beach = gameBeach();
  const point = alongCove(beach)[8];
  const highs = [];
  for (let n = 0; n < loop / period; n++) {
    const levels = edgeOver(beach.at, point, n * period, (n + 1) * period, 0.1);
    highs.push(Math.max(...levels));
  }
  const mean = highs.reduce((a, b) => a + b, 0) / highs.length;
  const spread = Math.sqrt(highs.reduce((a, b) => a + (b - mean) ** 2, 0) / highs.length);
  assert.ok(spread > 0.03, `the run-ups at ${point} spread by ${spread.toFixed(3)} m only`);
  // Along the beach, one wave runs up as far as it does there.
  const along = alongCove(beach).map((p) => Math.max(...edgeOver(beach.at, p, 120, 120 + period, 0.1)));
  assert.ok(new Set(along.map((v) => v.toFixed(2))).size > along.length / 2, `along the beach over one wave: ${along.map((v) => v.toFixed(2))}`);
});

test('the waves run up no higher than the sets leave the beach wet, and draw the sea down only a little', () => {
  const beach = gameBeach();
  const { height } = config.water.swash;
  const { dry } = config.world.terrain.sand.wetness;
  for (const point of alongCove(beach)) {
    const [a, o] = beach.island.toCove(...point);
    const runs = beach.swash.runs(beach.map.at(a, o));
    // chunks/wet.wgsl: the sets' wetness, up to `dry` above the sea where a full wave runs up `height`.
    const wetTop = (dry * runs) / height;
    const levels = edgeOver(beach.at, point, 0, loop, 0.25);
    assert.ok(Math.max(...levels) < wetTop, `at ${point}: the edge runs up to ${Math.max(...levels).toFixed(2)} m, over the wet sand's top at ${wetTop.toFixed(2)}`);
    assert.ok(Math.min(...levels) > -0.25 * runs, `at ${point}: the sea drawn down to ${Math.min(...levels).toFixed(2)} m`);
  }
});

test('where the edge stands over the ground there is water over it and the ground is soaked; where it has drained the film fades first, then the soaking', () => {
  const beach = gameBeach();
  const out = {};
  for (const [x, z0] of alongCove(beach)) {
    for (const inland of [0.5, 1.5, 3]) {
      const z = z0 - inland;
      const ground = beach.heightmap.heightAt(x, z);
      let left = null; // when the water last left
      for (let t = 200; t < 200 + 3 * period; t += 0.1) {
        beach.at(x, z, t, out);
        assert.ok(out.cover >= 0 && out.foam >= 0 && out.line >= 0 && out.film >= 0 && out.film <= 1 && out.soaked >= 0 && out.soaked <= 1, `at ${x}, ${z}, t ${t}: ${JSON.stringify(out)}`);
        if (out.level > ground + 1e-3) {
          assert.ok(out.cover > 0 && out.film > 0.99 && out.soaked > 0.99, `under the water at ${x}, ${z}, t ${t}: ${JSON.stringify(out)}`);
          left = null;
        } else if (out.level < ground - 1e-3) {
          assert.equal(out.cover, 0, `bare at ${x}, ${z}, t ${t}`);
          assert.ok(out.soaked >= out.film - 1e-6, `soaked ${out.soaked} under the film ${out.film}`);
          if (left !== null) assert.ok(out.film <= left.film + 1e-6 && out.soaked <= left.soaked + 1e-6, `drying at ${x}, ${z}, t ${t}: the film from ${left.film} to ${out.film}`);
          left = { film: out.film, soaked: out.soaked };
        } else {
          left = null; // the edge right at the ground: a wave may just reach it
        }
      }
    }
  }
});

test('the beach\'s water changes smoothly in time, across the waves\' loop too, and along the beach', () => {
  const beach = gameBeach();
  const [a, b] = [{}, {}];
  for (const [x, z0] of alongCove(beach)) {
    for (const inland of [-1, 0, 1, 2.5]) {
      const z = z0 - inland;
      for (let t = 300; t < 300 + period; t += 0.02) {
        beach.at(x, z, t, a);
        beach.at(x, z, t + 0.02, b);
        assert.ok(Math.abs(a.level - b.level) < 0.02, `at ${x}, ${z}, t ${t}: the edge jumps from ${a.level} to ${b.level}`);
        assert.ok(Math.abs(a.cover - b.cover) < 0.02, `at ${x}, ${z}, t ${t}: the water jumps from ${a.cover} to ${b.cover}`);
      }
      // Across the loop's end: the waves' time wraps there.
      beach.at(x, z, loop - 0.01, a);
      beach.at(x, z, loop + 0.01, b);
      assert.ok(Math.abs(a.level - b.level) < 0.02 && Math.abs(a.film - b.film) < 0.05 && Math.abs(a.foam + a.line - b.foam - b.line) < 0.1, `at ${x}, ${z} across the loop: ${JSON.stringify(a)} then ${JSON.stringify(b)}`);
    }
  }
  // Along the waterline, 25 cm apart: one wave's edge, not one wave's here and another's there.
  for (const t of [100, 101.3, 102.6, 104, 106.5]) {
    let last = null;
    for (let x = -150; x <= 40; x += 0.25) {
      let z = -40;
      while (beach.heightmap.heightAt(x, z) > 0 && z < 300) z += 0.02;
      const { level } = beach.at(x, z - 1, t, a);
      if (last !== null) assert.ok(Math.abs(level - last) < 0.03, `along the beach at x ${x}, t ${t}: the edge from ${last} to ${level}`);
      last = level;
    }
  }
});

test('on every seed\'s beaches the water is finite, never below the ground, and as wet as it must be', () => {
  for (const seed of SEEDS) {
    const beach = beachOf(seed, { ...config.world.terrain, levels: [{ texel: 8 }] }, { ...config.water.map, texel: 8 });
    const r = createRandom(seed)('test/swash');
    const { map, island } = beach;
    const span = (map.samples - 1) * map.texel;
    let judged = 0;
    for (let tries = 0; tries < 200000 && judged < 300; tries++) {
      const a = map.origin[0] + r.range(0.02, 0.98) * span;
      const o = map.origin[1] + r.range(0.02, 0.98) * span;
      const here = map.at(a, o);
      if (Math.abs(here.shore) > 10) continue;
      judged++;
      const [x, z] = island.fromCove(a, o);
      const t = r.range(0, loop);
      const s = beach.at(x, z, t);
      for (const [key, v] of Object.entries(s)) assert.ok(Number.isFinite(v), `seed ${seed} at ${x}, ${z}: ${key} ${v}`);
      assert.ok(s.cover >= 0 && s.film <= 1 && s.soaked <= 1 && s.milk <= 1, `seed ${seed} at ${x}, ${z}: ${JSON.stringify(s)}`);
      assert.ok(s.runs >= config.water.swash.least * config.water.swash.height - 1e-9 && s.runs <= config.water.swash.height + 1e-9, `seed ${seed}: a full wave runs ${s.runs} m`);
    }
    assert.ok(judged >= 100, `seed ${seed}: ${judged} points by its shores`);
  }
});

test('JS knows the water on the beach: the sheet over the sand, the bare sand, and the sea further out', () => {
  const beach = gameBeach();
  const { waves } = config.water;
  const spectrum = buildSpectrum(waves, 64, createRandom(config.defaults.seed)('water/spectrum'), (degrees) => {
    const t = (degrees * Math.PI) / 180;
    return beach.island.fromCove(side * Math.sin(t), Math.cos(t));
  });
  const groundAt = beach.heightmap.heightAt;
  const beachSettings = { swash: beach.swash, band: settings.band, wets: settings.wets };
  const surface = createSurface(spectrum, beach.map, beach.island.toCove, waves.inJs, waves.ripplesLeast, waves.ripplesDepth, null, waves.chopWander, { share: config.water.shallowTroughs, groundAt }, beachSettings);
  const out = [0, 0, 0];
  for (const [x, z0] of alongCove(beach)) {
    for (const inland of [0.5, 1.5, 3]) {
      const z = z0 - inland;
      for (const t of [50, 53, 56, 59]) {
        surface.displacement(x, z, t, out);
        const s = beach.at(x, z, t);
        // Up the beach the water's surface is the ground and the water over it.
        assert.ok(Math.abs(out[1] - (groundAt(x, z) + s.cover)) < 1e-9, `at ${x}, ${z}, t ${t}: ${out[1]} for ${groundAt(x, z)} + ${s.cover}`);
        assert.ok(Math.abs(out[0]) < 1e-12 && Math.abs(out[2]) < 1e-12, `the water moves sideways on the beach: ${out}`);
      }
    }
  }
});
