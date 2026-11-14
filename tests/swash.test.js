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
import { createSwash, highest, swellWay } from '../src/water/swash.js';
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
// Each seed's, on maps 8 m apart, built once.
const seedBeaches = new Map();
const seedBeach = (seed) => {
  if (!seedBeaches.has(seed)) seedBeaches.set(seed, beachOf(seed, { ...config.world.terrain, levels: [{ texel: 8 }] }, { ...config.water.map, texel: 8 }));
  return seedBeaches.get(seed);
};

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
      // A whole run only: one the window cuts off isn't one, nor one the next runs up over before it has drained.
      const drained = levels[i] < Math.min(...levels) + 0.005;
      if (top > start && i > top && i < levels.length - 1 && drained && levels[top] - levels[start] > 0.01) runs.push({ up: (top - start) * step, down: (i - top) * step, height: levels[top] });
    }
    // Five waves' time holds two whole runs at least, and no more than one a wave.
    assert.ok(runs.length >= 2 && runs.length <= 5, `at ${point}: ${runs.length} runs up in ${5 * period} s`);
    for (const run of runs) assert.ok(run.up < run.down, `at ${point}: up in ${run.up} s, back in ${run.down} s`);
  }
});

test('a wave lands at one time all along each line inland: as it comes in, at the waterline and up the beach', () => {
  for (const beach of [gameBeach(), ...SEEDS.map(seedBeach)]) {
    for (const [x, z] of alongCove(beach)) {
      const [a, o] = beach.island.toCove(x, z);
      const { inlandA, inlandO } = beach.map.at(a, o);
      // From 3 m up the beach to 5 m out, where the waves come in, break and run up.
      const lands = [];
      for (let out = -3; out <= 5; out += 0.5) lands.push(beach.map.at(a - inlandA * out, o - inlandO * out).lands);
      const spread = Math.max(...lands) - Math.min(...lands);
      assert.ok(spread < 0.15, `at ${x}, ${z.toFixed(2)}: the waves land over ${spread.toFixed(2)} s along the line inland`);
    }
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
  for (const point of alongCove(beach)) {
    const [a, o] = beach.island.toCove(...point);
    const runs = beach.swash.runs(beach.map.at(a, o));
    // water/swash-wet.wgsl: the sets' wetness reaches as high as the highest wave runs.
    const wetTop = runs * highest(config.water.swash, config.water.surf);
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

test('above as high as the waves wet the ground now, the beach is bare: no water, film or foam (water/water.wgsl lies under the ground there)', () => {
  const beach = gameBeach();
  const out = {};
  let bare = 0;
  let filmed = 0;
  for (const [x, z0] of alongCove(beach)) {
    for (let inland = 0; inland < 8; inland += 0.5) {
      const z = z0 - inland;
      const ground = beach.heightmap.heightAt(x, z);
      for (let t = 400; t < 400 + 2 * period; t += 0.25) {
        beach.at(x, z, t, out);
        if (ground > out.top + 4 * config.water.swash.lineWidth) {
          assert.ok(out.cover === 0 && out.film === 0 && out.foam + out.line < 1e-3, `above the waves' top ${out.top.toFixed(3)} at ${x}, ${z} (ground ${ground.toFixed(3)}), t ${t}: ${JSON.stringify(out)}`);
          bare++;
        } else if (out.film > 0) {
          filmed++;
        }
      }
    }
  }
  // Both happen: the test sees bare beach above the waves, and film under their top.
  assert.ok(bare > 1000 && filmed > 1000, `${bare} bare, ${filmed} filmed`);
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
    const beach = seedBeach(seed);
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

// The waves coming in at world x, z and time t, as the game reads them.
function boreAt(beach, x, z, t, out = {}) {
  const [a, o] = beach.island.toCove(x, z);
  return beach.swash.bore(beach.map.at(a, o), a, o, t - loop * Math.floor(t / loop), out);
}

// Points along a line straight out from the cove's beach, `step` m apart as far as the waves come in from.
function outFrom(beach, [x, z0], step = 0.5) {
  const points = [];
  for (let z = z0 + step; ; z += step) {
    const [a, o] = beach.island.toCove(x, z);
    if (beach.map.at(a, o).depth >= config.water.swash.bore.from[0]) return points;
    points.push([x, z]);
  }
}

test('each wave comes in over the shallows at the speed shallow water lets it, and reaches the waterline as it lands there', () => {
  const beach = gameBeach();
  const out = {};
  for (const point of alongCove(beach).filter((_, i) => i % 3 === 0)) {
    const line = outFrom(beach, point);
    const [a, o] = beach.island.toCove(...point);
    const lands = beach.map.at(a, o).lands;
    // When each crest passes each point, over a few waves: the highest it stands there.
    for (let k = 20; k < 23; k++) {
      const landing = lands + k * period;
      const crests = line.map(([x, z]) => {
        let best = { t: 0, h: -Infinity };
        for (let t = landing - 8; t < landing + 0.5; t += 0.02) {
          const h = boreAt(beach, x, z, t, out).height;
          if (h > best.h) best = { t, h };
        }
        // How far out it is, along the way it comes in.
        return { z, out: beach.map.at(...beach.island.toCove(x, z)).shore, ...best };
      }).filter((c) => c.h > 0.01);
      assert.ok(crests.length > 4, `at ${point}, wave ${k}: ${crests.length} points it stands up at`);
      // Nearer the shore, later; never faster than a bore twice as tall as the water is deep would run.
      for (let i = 1; i < crests.length; i++) {
        const [near, far] = [crests[i - 1], crests[i]];
        assert.ok(near.t >= far.t - 0.03, `at ${point}, wave ${k}: the crest at ${near.z} passes at ${near.t.toFixed(2)}, before it passes ${far.z} at ${far.t.toFixed(2)}`);
      }
      const speed = (crests.at(-1).out - crests[0].out) / Math.max(crests[0].t - crests.at(-1).t, 1e-3);
      assert.ok(speed > 0.5 && speed < 4, `at ${point}, wave ${k}: it comes in at ${speed.toFixed(2)} m/s`);
      // Its crest by the waterline passes as it lands: within the time to cross the last half metre.
      assert.ok(Math.abs(crests[0].t - landing) < 1, `at ${point}, wave ${k}: its crest ${crests[0].z - point[1]} m out at ${crests[0].t.toFixed(2)} s, landing at ${landing.toFixed(2)}`);
    }
  }
});

test('a big wave breaks further out and leaves more foam than a small one, and none stands taller than the water lets it, but for the sheet it collapses into at the waterline', () => {
  const beach = gameBeach();
  const out = {};
  const { breaks } = config.water.swash.bore;
  const tallest = config.water.swash.sheet * highest(config.water.swash, config.water.surf);
  for (const point of alongCove(beach).filter((_, i) => i % 3 === 1)) {
    const line = outFrom(beach, point, 0.25);
    const [a, o] = beach.island.toCove(...point);
    const here = beach.map.at(a, o);
    const collapses = tallest * beach.swash.runs(here);
    const waves = [];
    for (let k = 0; k < loop / period; k += 3) {
      const landing = here.lands + k * period;
      let outermost = 0;
      let foam = 0;
      for (let t = landing - 6; t < landing; t += 0.1) {
        for (const [x, z] of line) {
          const [pa, po] = beach.island.toCove(x, z);
          const depth = beach.map.at(pa, po).depth;
          boreAt(beach, x, z, t, out);
          assert.ok(out.height <= Math.hypot(breaks * depth, collapses) + 1e-6, `at ${x}, ${z}, t ${t}: ${out.height.toFixed(3)} m over ${depth.toFixed(3)} m of water`);
          if (out.foam > 0.1) outermost = Math.max(outermost, z - point[1]);
          foam = Math.max(foam, out.foam);
        }
      }
      waves.push({ runUp: Math.max(...edgeOver(beach.at, point, landing, landing + period, 0.1)), outermost, foam });
    }
    waves.sort((p, q) => p.runUp - q.runUp);
    const [small, big] = [waves.slice(0, 5), waves.slice(-5)];
    const mean = (list, key) => list.reduce((s, w) => s + w[key], 0) / list.length;
    assert.ok(mean(big, 'outermost') > mean(small, 'outermost') + 0.5, `at ${point}: the big waves break ${mean(big, 'outermost').toFixed(2)} m out, the small ${mean(small, 'outermost').toFixed(2)}`);
    assert.ok(mean(big, 'foam') > 1.3 * mean(small, 'foam'), `at ${point}: the big waves' foam ${mean(big, 'foam').toFixed(2)}, the small's ${mean(small, 'foam').toFixed(2)}`);
  }
});

// A wave's white front and the water's height along a line straight out from the beach at
// [x, z] (its still waterline), through wave k's landing there: per frame 0.05 s apart, from
// 1.2 s before it lands to 0.6 s after, the foam (the bore's and the sheet's) and the water's
// height at points 4 cm apart from 3 m up the beach (-) to 3 m out (+), and the bore's there.
function handOff(beach, [x, z], k) {
  const { island, map, heightmap, swash } = beach;
  const [a0, o0] = island.toCove(x, z);
  const { inlandA, inlandO, lands } = map.at(a0, o0);
  const points = [];
  for (let out = -3; out <= 3 + 1e-9; out += 0.04) {
    const [a, o] = [a0 - inlandA * out, o0 - inlandO * out];
    points.push({ out, a, o, here: map.at(a, o), ground: heightmap.heightAt(...island.fromCove(a, o)) });
  }
  const [b, w] = [{}, {}];
  const landing = lands + k * period;
  const frames = [];
  for (let t = landing - 1.2; t <= landing + 0.6 + 1e-9; t += 0.05) {
    const wrapped = t - loop * Math.floor(t / loop);
    const frame = { t, foam: [], height: [], bore: [] };
    for (const p of points) {
      swash.bore(p.here, p.a, p.o, wrapped, b);
      let foam = b.foam;
      let height = 0;
      if (p.ground > -settings.band) {
        swash(p.here, p.a, p.o, p.ground, wrapped, w, 0, b.height, b.fill);
        foam += w.foam;
        height = p.ground + w.cover;
      }
      frame.foam.push(foam);
      frame.height.push(height);
      frame.bore.push(b.height);
    }
    frames.push(frame);
  }
  return { points, frames, landing };
}

test('each wave is one event from its break to its run-up: its white front only moves inland, with no gap, jump or pause, and the water behind its crest never rises again', () => {
  const lines = [[gameBeach(), [-180, -150, -120, -90, -60, -30, 0, 30, 60], [10, 11, 12, 13, 14, 15]]];
  for (const seed of SEEDS.slice(1)) lines.push([seedBeach(seed), [-150, -30, 60], [10, 11]]);
  for (const [beach, xs, waves] of lines) {
    for (const x of xs) {
      let z = -40;
      while (beach.heightmap.heightAt(x, z) > 0 && z < 300) z += 0.02;
      for (const k of waves) {
        const { points, frames, landing } = handOff(beach, [x, z], k);
        const at = `at ${x}, ${z.toFixed(2)}, wave ${k}`;
        // Its front: the most shoreward foam over a share of how white it broke near the shore,
        // from where it first shows within 2 m of the waterline until it is 1 m up the beach.
        let white = 0;
        for (const f of frames.filter((f) => f.t < landing)) points.forEach((p, i) => { if (p.out > 0.2 && p.out < 2) white = Math.max(white, f.foam[i]); });
        const enough = Math.max(0.3 * white, 0.05);
        let last = null;
        let still = 0;
        for (const f of frames) {
          const i = f.foam.findIndex((v) => v > enough);
          const front = i < 0 ? null : points[i].out;
          if (last === null) {
            if (front !== null && front < 2) last = front;
            continue;
          }
          if (last < -1) break;
          assert.ok(front !== null, `${at}, t ${f.t.toFixed(2)}: its white front has gone, ${last.toFixed(2)} m out`);
          assert.ok(front <= last + 0.03, `${at}, t ${f.t.toFixed(2)}: its white front moves back out, from ${last.toFixed(2)} to ${front.toFixed(2)} m`);
          assert.ok(last - front < 0.3, `${at}, t ${f.t.toFixed(2)}: its white front jumps from ${last.toFixed(2)} to ${front.toFixed(2)} m in 0.05 s`);
          still = Math.abs(front - last) < 0.02 && front > -0.5 ? still + 0.05 : 0;
          assert.ok(still < 0.2 + 1e-9, `${at}, t ${f.t.toFixed(2)}: its white front stands at ${front.toFixed(2)} m for ${still.toFixed(2)} s`);
          last = front;
        }
        assert.ok(last !== null, `${at}: no white front`);
        // Once its crest has passed a point near the shore, the water there only falls, or holds, until its run-up is well up the beach.
        for (const out of [0.5, 1, 1.5]) {
          const i = points.findIndex((p) => Math.abs(p.out - out) < 0.02);
          if (points[i].ground <= -settings.band) continue;
          let crest = 0;
          frames.forEach((f, j) => { if (f.t < landing + 0.3 && f.bore[i] > frames[crest].bore[i]) crest = j; });
          let low = Infinity;
          for (const f of frames.slice(crest)) {
            low = Math.min(low, f.height[i]);
            assert.ok(f.height[i] - low < 0.005, `${at}, ${out} m out, t ${f.t.toFixed(2)}: the water rises ${(f.height[i] - low).toFixed(3)} m after its crest passed`);
          }
        }
      }
    }
  }
});

test('the waves coming in raise the sea no higher on average, change smoothly, and the surface JS knows takes them in', () => {
  const beach = gameBeach();
  const [b, c] = [{}, {}];
  for (const point of alongCove(beach).filter((_, i) => i % 4 === 2)) {
    for (const [x, z] of outFrom(beach, point, 1.5)) {
      let sum = 0;
      let count = 0;
      for (let t = 0; t < loop; t += 0.25) {
        boreAt(beach, x, z, t, b);
        boreAt(beach, x, z, t + 0.02, c);
        for (const v of Object.values(b)) assert.ok(Number.isFinite(v), `at ${x}, ${z}, t ${t}: ${JSON.stringify(b)}`);
        assert.ok(Math.abs(b.height - c.height) < 0.03 && Math.abs(b.foam - c.foam) < 0.25, `at ${x}, ${z}, t ${t}: from ${JSON.stringify(b)} to ${JSON.stringify(c)}`);
        sum += b.height;
        count++;
      }
      assert.ok(Math.abs(sum / count) < 0.01, `at ${x}, ${z}: the sea stands ${(sum / count).toFixed(4)} m higher on average`);
    }
  }
  // Across the waves' loop's end.
  const [x, z] = outFrom(beach, alongCove(beach)[5], 2)[1];
  boreAt(beach, x, z, loop - 0.01, b);
  boreAt(beach, x, z, loop + 0.01, c);
  assert.ok(Math.abs(b.height - c.height) < 0.03, `across the loop: ${b.height} then ${c.height}`);
  // Out where the sea's own surface holds, JS's surface stands as high as the waves coming in raise it.
  const { waves } = config.water;
  const spectrum = buildSpectrum(waves, 64, createRandom(config.defaults.seed)('water/spectrum'), (degrees) => {
    const t = (degrees * Math.PI) / 180;
    return beach.island.fromCove(side * Math.sin(t), Math.cos(t));
  });
  const shallow = { share: config.water.shallowTroughs, groundAt: beach.heightmap.heightAt };
  const make = (beachSettings) => createSurface(spectrum, beach.map, beach.island.toCove, waves.inJs, waves.ripplesLeast, waves.ripplesDepth, null, waves.chopWander, shallow, beachSettings);
  const [bare, withBeach] = [make(null), make({ swash: beach.swash, band: settings.band, wets: settings.wets })];
  const [p, q] = [[0, 0, 0], [0, 0, 0]];
  let moved = 0;
  let leaned = 0;
  for (const point of alongCove(beach).filter((_, i) => i % 4 === 0)) {
    for (const [px, pz] of outFrom(beach, point, 1).filter(([qx, qz]) => beach.heightmap.heightAt(qx, qz) < -settings.band)) {
      for (const t of [30, 33, 36]) {
        bare.displacement(px, pz, t, p);
        withBeach.displacement(px, pz, t, q);
        const coming = boreAt(beach, px, pz, t, b);
        assert.ok(Math.abs(q[1] - Math.max(p[1] + coming.height, config.water.shallowTroughs * beach.heightmap.heightAt(px, pz))) < 1e-9, `at ${px}, ${pz}, t ${t}: ${q[1]} for ${p[1]} and the wave coming in, ${coming.height}`);
        // Its top moves inland, as far as the wave leans in.
        const here = beach.map.at(...beach.island.toCove(px, pz));
        const [ix, iz] = beach.island.fromCove(here.inlandA, here.inlandO);
        const inland = Math.hypot(ix, iz);
        assert.ok(Math.abs(q[0] - p[0] - (coming.lean * ix) / inland) < 1e-9 && Math.abs(q[2] - p[2] - (coming.lean * iz) / inland) < 1e-9, `at ${px}, ${pz}, t ${t}: moved ${q[0] - p[0]}, ${q[2] - p[2]} for a lean of ${coming.lean}`);
        moved = Math.max(moved, Math.abs(coming.height));
        leaned = Math.max(leaned, coming.lean);
      }
    }
  }
  assert.ok(moved > 0.02, `the waves coming in move the surface only ${moved} m`);
  assert.ok(leaned > 0.02, `the waves coming in lean in only ${leaned} m`);
});

test('a wave coming in leans in: its face steepens as it nears where it breaks, and folds over nowhere', () => {
  const beach = gameBeach();
  const b = {};
  const c = {};
  let steepest = 0;
  for (const point of alongCove(beach).filter((_, i) => i % 3 === 1)) {
    for (const [x, z] of outFrom(beach, point, 0.25)) {
      for (let t = 0; t < 200; t += 0.25) {
        boreAt(beach, x, z, t, b);
        // Where the water a step further out ends up: never up to this one's, so the surface folds nowhere.
        const [a, o] = beach.island.toCove(x, z);
        const here = beach.map.at(a, o);
        const step = 0.05;
        const [ia, io] = [here.inlandA, here.inlandO];
        beach.swash.bore(beach.map.at(a - ia * step, o - io * step), a - ia * step, o - io * step, t, c);
        assert.ok(c.lean - b.lean < 0.95 * step, `at ${x.toFixed(2)}, ${z.toFixed(2)}, t ${t}: the water ${step} m further out moves ${c.lean.toFixed(3)} m in, this ${b.lean.toFixed(3)}`);
        steepest = Math.max(steepest, b.slope);
      }
    }
  }
  // A face steeper than its height alone makes it: the slope as drawn past 1 (45 degrees).
  assert.ok(steepest > 1, `the steepest face rises ${steepest.toFixed(2)} per m`);
});

test('no wave comes in to break over shallows far from any beach, as over a reef\'s flat', () => {
  const beach = gameBeach();
  const { map, island } = beach;
  const { from, within } = config.water.swash.bore;
  const r = createRandom(config.defaults.seed)('test/bore');
  const span = (map.samples - 1) * map.texel;
  const out = {};
  let far = 0;
  let near = 0;
  for (let tries = 0; tries < 400000 && far < 300; tries++) {
    const a = map.origin[0] + r.range(0.02, 0.98) * span;
    const o = map.origin[1] + r.range(0.02, 0.98) * span;
    const here = map.at(a, o);
    if (!(here.depth > 0 && here.depth < from[0])) continue;
    const [x, z] = island.fromCove(a, o);
    let most = 0;
    for (let t = 0; t < period; t += 0.5) most = Math.max(most, Math.abs(boreAt(beach, x, z, t, out).height), out.foam);
    if (here.shore >= within[1]) {
      assert.equal(most, 0, `${here.shore.toFixed(1)} m from the waterline, ${here.depth.toFixed(2)} m deep: a wave ${most}`);
      far++;
    } else if (here.shore < within[0] && most > 0.01) near++;
  }
  assert.ok(far >= 100 && near >= 20, `${far} points far from a beach, ${near} near one with waves coming in`);
});
