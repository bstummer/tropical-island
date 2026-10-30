// What the sea knows of the island (water/sea-map.js): invariants over seeds
// 1-20, on grids 8 m apart, the coarsest the reef's crest still shows on. The
// GPU's side is the water fixture's to check.
import test from 'node:test';
import assert from 'node:assert/strict';
import { config } from '../src/config.js';
import { createRandom } from '../src/core/random.js';
import { createIsland } from '../src/world/island.js';
import { buildHeightmap } from '../src/world/heightmap.js';
import { buildSeaMap, seaMapLayers } from '../src/water/sea-map.js';

const side = config.world.island.cove.headlandSide;
const terrain = { ...config.world.terrain, levels: [{ texel: 8 }] };
const settings = { ...config.water.map, texel: 8 };
const SEEDS = Array.from({ length: 20 }, (_, i) => i + 1);

const built = new Map();
function seaOf(seed) {
  if (!built.has(seed)) {
    const island = createIsland(createRandom(seed));
    const heightmap = buildHeightmap(island, terrain);
    built.set(seed, { island, heightmap, map: buildSeaMap(heightmap, settings, side, terrain.blend) });
  }
  return built.get(seed);
}
const heightOf = (heightmap, map, i, j) => {
  const level = heightmap.levels[0];
  return level.heights[j * level.samples + i];
};

test('the map covers the coarsest grid, its samples on the lines of the grid, and at() reads a sample as it is', () => {
  const { map, heightmap } = seaOf(1);
  assert.deepEqual(map.origin, heightmap.levels[0].origin);
  const r = createRandom(1)('test/sea-map');
  for (let n = 0; n < 1000; n++) {
    const i = r.int(1, map.samples - 2);
    const j = r.int(1, map.samples - 2);
    const k = j * map.samples + i;
    const at = map.at(map.origin[0] + i * map.texel, map.origin[1] + j * map.texel);
    for (const name of ['shore', 'depth', 'reef', 'swell', 'wind', 'surf']) assert.ok(Math.abs(at[name] - map[name][k]) < 1e-5, `${name} at ${i}, ${j}: ${at[name]}, not ${map[name][k]}`);
  }
});

test('the shore: zero on the drawn waterline, + at sea, - on land, growing by a metre a metre, its way leading to the nearest waterline', () => {
  for (const seed of SEEDS) {
    const { map, heightmap } = seaOf(seed);
    const n = map.samples;
    let sloped = 0;
    let judged = 0;
    let arrived = 0;
    let walked = 0;
    for (let j = 1; j < n - 1; j++) {
      for (let i = 1; i < n - 1; i++) {
        const k = j * n + i;
        const d = map.shore[k];
        const h = heightOf(heightmap, map, i, j);
        assert.equal(d > 0, h < 0, `seed ${seed} at ${i}, ${j}: height ${h}, shore ${d}`);
        if (h < 0 !== heightOf(heightmap, map, i + 1, j) < 0) assert.ok(Math.abs(d) <= map.texel, `seed ${seed} at ${i}, ${j}: the waterline lies next to it, ${d} m by the map`);
        const grad = Math.hypot(map.shore[k + 1] - map.shore[k - 1], map.shore[k + n] - map.shore[k - n]) / (2 * map.texel);
        judged++;
        if (grad > 0.8 && grad < 1.15) sloped++;
        if ((i + j) % 7 === 0 && d > 20 && d < 400) {
          walked++;
          const a = map.origin[0] + i * map.texel;
          const o = map.origin[1] + j * map.texel;
          const there = map.at(a + map.toShoreA[k] * d, o + map.toShoreO[k] * d).shore;
          if (Math.abs(there) < 1.5 * map.texel) arrived++;
        }
      }
    }
    // Ridges of the field, midway between shores, are few.
    assert.ok(sloped / judged > 0.93, `seed ${seed}: the distance grows by a metre a metre at only ${((100 * sloped) / judged).toFixed(1)}% of samples`);
    assert.ok(walked > 100 && arrived / walked > 0.95, `seed ${seed}: following the way to the shore reaches it from only ${((100 * arrived) / walked).toFixed(1)}% of ${walked} points`);
  }
});

test('the swell: full over the open sea on the side it comes from, none over land, small in the lagoon behind the reef, and never more than the water allows', () => {
  const { from, breaks } = settings.swell;
  for (const seed of SEEDS) {
    const { map, heightmap } = seaOf(seed);
    const n = map.samples;
    // Straight in from the open sea, along the middle of its fan, to the cove.
    const t = (from * Math.PI) / 180;
    const [da, dO] = [side * Math.sin(t), Math.cos(t)];
    const out = map.at(da * 800, dO * 800);
    assert.ok(out.reef > 0 && out.swell > 0.97, `seed ${seed}: 800 m out on the swell's side it reaches ${out.swell}`);
    for (let j = 0; j < n; j++) {
      for (let i = 0; i < n; i++) {
        const k = j * n + i;
        const h = heightOf(heightmap, map, i, j);
        if (h >= 0) assert.equal(map.swell[k], 0, `seed ${seed}: swell ${map.swell[k]} over land at ${i}, ${j}`);
        assert.ok(map.swell[k] <= Math.min(Math.max(-h, 0) / breaks, 1) + 1e-5, `seed ${seed}: swell ${map.swell[k]} over ${-h} m at ${i}, ${j}`);
      }
    }
    // Inside the crest, behind the reef straight out from the beach but for the
    // pass, the swell is a fraction of what stands outside it.
    let inside = 0;
    let count = 0;
    for (let a = 40; a < 140; a += 8) {
      for (let o = 60; o < 300; o += 8) {
        const s = map.at(a, o);
        if (s.reef < -20 && s.shore > 15) {
          inside += s.swell;
          count++;
        }
      }
    }
    assert.ok(count > 20 && inside / count < 0.5, `seed ${seed}: in the lagoon the swell reaches ${(inside / count).toFixed(2)} on average over ${count} points`);
  }
});

test('a pass lets through more swell than the reef beside it, and the surf breaks on the reef and not in the pass', () => {
  const { pass } = config.world.island.seabed;
  const [a0, o0] = pass.from;
  const [a1, o1] = pass.to;
  for (const seed of SEEDS) {
    const { map } = seaOf(seed);
    // Along the pass, the deepest it gets: where it runs through the crest.
    let through = null;
    for (let t = 0; t <= 1; t += 0.02) {
      const at = [a0 + (a1 - a0) * t, o0 + (o1 - o0) * t];
      const s = map.at(...at);
      if (!through || Math.abs(s.reef) < Math.abs(through.s.reef)) through = { at, s };
    }
    assert.ok(through.s.surf < 0.05, `seed ${seed}: surf ${through.s.surf} in the pass`);
    // Just inside it, against the same place behind the reef 120 m along the crest.
    const inside = (a, o) => {
      for (let step = 0; step < 200; step += 2) {
        const s = map.at(a, o - step);
        if (s.reef < -15) return s;
      }
      return null;
    };
    const behindPass = inside(...through.at);
    const behindReef = inside(through.at[0] + 120, through.at[1]);
    assert.ok(behindPass && behindReef, `seed ${seed}: the crest not found`);
    assert.ok(behindPass.swell > behindReef.swell + 0.05, `seed ${seed}: behind the pass ${behindPass.swell.toFixed(2)}, behind the reef ${behindReef.swell.toFixed(2)}`);
    // On the crest straight out from the beach, it breaks.
    let most = 0;
    for (let o = 200; o < 330; o += 2) most = Math.max(most, map.at(through.at[0] + 120, o).surf);
    assert.ok(most > 0.1, `seed ${seed}: surf at most ${most} on the crest beside the pass`);
  }
});

test('surf only where the water is shallow, and only where swell arrives', () => {
  const { breaks } = settings.swell;
  for (const seed of SEEDS) {
    const { map, heightmap } = seaOf(seed);
    const n = map.samples;
    for (let j = 1; j < n - 1; j++) {
      for (let i = 1; i < n - 1; i++) {
        const k = j * n + i;
        if (map.surf[k] <= 0.01) continue;
        assert.ok(heightOf(heightmap, map, i, j) > -breaks - 1e-3, `seed ${seed}: surf ${map.surf[k]} over ${-heightOf(heightmap, map, i, j)} m at ${i}, ${j}`);
      }
    }
  }
});

test('the wind: nothing on land, calm close under the lee of the island, grown by a kilometre of open water', () => {
  for (const seed of SEEDS) {
    const { map, heightmap } = seaOf(seed);
    const n = map.samples;
    for (let j = 0; j < n; j++) {
      for (let i = 0; i < n; i++) {
        if (heightOf(heightmap, map, i, j) >= 0) assert.equal(map.wind[j * n + i], 0);
      }
    }
    const near = map.at(0, 30);
    const far = map.at(0, 1200);
    assert.ok(near.wind < 0.3, `seed ${seed}: 30 m off the beach, with the wind off the land, chop ${near.wind}`);
    assert.ok(far.wind > 0.8, `seed ${seed}: 1200 m out, chop only ${far.wind}`);
  }
});

test('a crest narrower than the samples are apart still holds the swell back', () => {
  // A coarse grid of deep water, and a fine one with a narrow ridge between the map's lines.
  const flat = (samples, texel, origin, height) => ({ samples, texel, origin, heights: new Float32Array(samples * samples).fill(height), info: new Float32Array(4 * samples * samples) });
  const coarse = flat(32, 8, [0, 0], -10);
  const fine = flat(128, 2, [0, 0], -10);
  const ridge = 61; // odd: on no line of a map 4 m apart
  for (let j = 0; j < fine.samples; j++) fine.heights[j * fine.samples + ridge] = -0.3;
  const map = buildSeaMap({ levels: [fine, coarse] }, { ...config.water.map, texel: 4 }, side, 0);
  const k = 32 * map.samples + (ridge - 1) / 2; // the line next to it
  assert.equal(map.depth[k], 10, 'the map\'s own line lies in deep water');
  assert.ok(map.swell[k] <= 0.3 / config.water.map.swell.breaks + 1e-5, `the swell reaches ${map.swell[k]} beside a crest 0.3 m deep`);
  assert.ok(map.wind[k] <= 0.3 / config.water.map.wind.depth + 1e-5, `the chop reaches ${map.wind[k]} beside a crest 0.3 m deep`);
});

test('the layers the GPU reads hold each value where water/sea-map.wgsl looks for it', () => {
  const map = { shore: [1], depth: [2], swell: [3], wind: [4], toShoreA: [5], toShoreO: [6], surf: [7], reef: [8] };
  const [first, second] = seaMapLayers(map, (v) => v);
  assert.deepEqual([...first], [1, 2, 3, 4]);
  assert.deepEqual([...second], [5, 6, 7, 8]);
});
