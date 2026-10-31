// What the sea knows of the island (water/sea-map.js): invariants over seeds
// 1-20, on grids 8 m apart, the coarsest the reef's crest still shows on. The
// GPU's side is the water fixture's to check.
import test from 'node:test';
import assert from 'node:assert/strict';
import { config } from '../src/config.js';
import { createRandom } from '../src/core/random.js';
import { createIsland } from '../src/world/island.js';
import { buildHeightmap } from '../src/world/heightmap.js';
import { buildSeaMap, seaMapLayers, waveSpeed } from '../src/water/sea-map.js';
import { createSurface } from '../src/water/surface.js';
import { createSurf } from '../src/water/surf.js';

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
    for (const name of ['shore', 'depth', 'reef', 'swell', 'wind', 'surf', 'late', 'wayA', 'wayO', 'speed']) assert.ok(Math.abs(at[name] - map[name][k]) < 1e-5, `${name} at ${i}, ${j}: ${at[name]}, not ${map[name][k]}`);
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

test('the surf whitens only near the shallows it breaks on, none in the pass, and none out at sea', () => {
  const surf = createSurf(config.water.surf, [0, -1]);
  const { pass } = config.world.island.seabed;
  const [a0, o0] = pass.from;
  const [a1, o1] = pass.to;
  const { ahead, fades } = config.water.surf;
  const { period } = config.water.surf;
  for (const seed of SEEDS) {
    const { map } = seaOf(seed);
    let foamed = 0;
    const here = {};
    for (let j = 0; j < map.samples; j += 3) {
      for (let i = 0; i < map.samples; i += 3) {
        const [a, o] = [map.origin[0] + i * map.texel, map.origin[1] + j * map.texel];
        map.at(a, o, here);
        if (here.swell <= 0) continue;
        for (const t of [3, 40, 3 + period / 2]) {
          const { foam, height } = surf(here, a, o, t);
          if (foam > 0.01) {
            foamed++;
            assert.ok(here.reef < ahead + 1e-3, `seed ${seed}: foam ${foam} ${here.reef} m seaward of the crest`);
          }
          if (Math.abs(height) > 1e-3) assert.ok(here.reef < fades[1] + 1e-3, `seed ${seed}: a wave ${height} m high ${here.reef} m seaward of the crest`);
        }
      }
    }
    assert.ok(foamed > 20, `seed ${seed}: only ${foamed} points foam`);
    // In the pass, where it runs through the crest, it hardly breaks at all.
    let through = null;
    for (let t = 0; t <= 1; t += 0.02) {
      const s = map.at(a0 + (a1 - a0) * t, o0 + (o1 - o0) * t);
      if (!through || Math.abs(s.reef) < Math.abs(through.reef)) through = s;
    }
    assert.ok(through.breaks < 0.2, `seed ${seed}: the surf breaks ${through.breaks} in the pass`);
    // On the crest beside it, it does.
    let most = 0;
    for (let o = 200; o < 330; o += 2) most = Math.max(most, map.at(a1 + 240, o).breaks);
    assert.ok(most > 0.5, `seed ${seed}: it breaks at most ${most} on the crest beside the pass`);
    // Away from the shallows it doesn't: the deep sea outside.
    assert.ok(map.at(a1 + 240, 500).breaks < 0.01, `seed ${seed}: it breaks ${map.at(a1 + 240, 500).breaks} out at sea`);
  }
});

test('a wave comes in from the open sea: seen hundreds of metres out, rising as it slows, tallest near the crest, gone over the flat', () => {
  const surf = createSurf(config.water.surf, [0, -1]);
  const { period, fades } = config.water.surf;
  const { pass } = config.world.island.seabed;
  const a = pass.to[0] + 240;
  for (const seed of SEEDS) {
    const { map } = seaOf(seed);
    // The tallest it stands at a point over a set of waves.
    const tallest = (s) => {
      let most = 0;
      for (let t = 0; t < 40 * period; t += period / 16) most = Math.max(most, surf(s, a, s.o, t).height);
      return most;
    };
    const line = [];
    for (let o = 700; o > 0; o -= 8) {
      const s = map.at(a, o);
      s.o = o;
      if (s.swell > 0 && s.reef > -60) line.push(s);
    }
    const out = line.find((s) => s.reef < fades[0] && s.reef > 200);
    const crest = line.reduce((best, s) => (Math.abs(s.reef) < Math.abs(best.reef) ? s : best));
    const near = Math.max(...line.filter((s) => Math.abs(s.reef) < 40).map(tallest));
    assert.ok(out, `seed ${seed}: no water 200 m and more seaward of the crest`);
    assert.ok(tallest(out) > 0.1, `seed ${seed}: ${out.reef} m out it stands ${tallest(out)} m`);
    assert.ok(near > 1.3 * tallest(out), `seed ${seed}: ${tallest(out)} m out at sea, ${near} m near the crest`);
    assert.ok(crest.speed < 0.5 * map.at(a, 700).speed, `seed ${seed}: on the crest it runs at ${crest.speed} m/s`);
    const flat = line.at(-1);
    assert.ok(tallest(flat) < 0.5 * near, `seed ${seed}: ${tallest(flat)} m high ${-flat.reef} m inside the crest, ${near} m near it`);
  }
});

test('how a wave breaks goes by its size: the big ones of a set seaward of the crest, the small on it alone, in less white', () => {
  const settings = config.water.surf;
  const surf = createSurf(settings, [0, -1]);
  const seaward = { swell: 0.64, depth: 4, breaks: 1, reef: 4, late: 0, speed: 6 };
  const onCrest = { swell: 0.2, depth: 0.8, breaks: 1, reef: -2, late: 0, speed: 3 };
  // What each of a set's waves brings just as it passes, over what lies there in a lull.
  const whiteOf = (here) => {
    const foam = Array.from({ length: 40 }, (_, n) => surf(here, 0, 0, (n + 0.002) * settings.period).foam);
    const lull = Math.min(...foam);
    return foam.map((v) => v - lull);
  };
  const [out, on] = [whiteOf(seaward), whiteOf(onCrest)];
  const breaking = (list) => list.filter((foam) => foam > 0.05).length;
  assert.ok(breaking(out) > 0 && breaking(out) < breaking(on), `${breaking(out)} waves break seaward of the crest, ${breaking(on)} on it`);
  // The set's full waves whiten the crest; a good few of its small ones hardly do.
  assert.ok(Math.max(...on) > 0.5, `a full wave brings ${Math.max(...on)} foam to the crest`);
  assert.ok(on.filter((v) => v < 0.15).length >= 3, `only ${on.filter((v) => v < 0.15).length} of a set's waves hardly whiten the crest`);
});

test('a wave stands taller as it slows, as settings.shoals says, as long as the water and the swell allow', () => {
  const settings = config.water.surf;
  const surf = createSurf(settings, [0, -1]);
  // Slow enough for both to be full peaks, deep enough for neither to be held: the rest stands the same.
  const tallest = (speed) => {
    const here = { swell: 1, depth: 100, breaks: 0, reef: 0, late: 0, speed };
    let most = 0;
    for (let t = 0; t < 40 * settings.period; t += settings.period / 64) most = Math.max(most, surf(here, 0, 0, t).height);
    return most;
  };
  const ratio = tallest(2) / tallest(4);
  assert.ok(Math.abs(ratio - 2 ** settings.shoals) < 0.05, `twice as slow, ${ratio} times as tall`);
  // Over water that won't carry it, it is held to that, however slow.
  const shallow = { swell: 1, depth: 0.5, breaks: 0, reef: 0, late: 0, speed: 2 };
  for (let t = 0; t < 40 * settings.period; t += settings.period / 64) assert.ok(surf(shallow, 0, 0, t).height <= settings.limit * 0.5 + 1e-6);
});

test('a wave of the surf runs in: its foam\'s front lies further inside the crest as time goes on, and the whole of it comes back a set later', () => {
  const settings = config.water.surf;
  const surf = createSurf(settings, [0, -1]);
  const speed = 4;
  // Over the flat, where it comes later the further in.
  const here = (reef) => ({ swell: reef < 0 ? 0.2 : 1, depth: 2, breaks: 1, reef, late: -reef / speed, speed });
  // Going seaward from far inside, where the foam first stands well above what always lies there.
  const front = (t) => {
    for (let reef = -40; reef < 0; reef += 0.1) if (surf(here(reef), 0, 0, t).foam > settings.always * Math.exp(reef / settings.run) + 0.1) return reef;
    return 0;
  };
  // The second wave of the set is a full one: pick it up breaking, then watch it.
  const t = 1.02 * settings.period + 1.5;
  const [at, later] = [front(t), front(t + 1.5)];
  assert.ok(at < -2 && at > -14, `no wave found running in: its front at ${at} m`);
  assert.ok(Math.abs(later - (at - 1.5 * speed)) < 2, `from ${at} to ${later} m in 1.5 s at ${speed} m/s`);
  // A set of waves later it all stands as it did.
  const [now, set] = [surf(here(-4), 0, 0, t), surf(here(-4), 0, 0, t + 40 * settings.period)];
  assert.ok(Math.abs(now.foam - set.foam) < 1e-6 && Math.abs(now.height - set.height) < 1e-6, `a set later: ${JSON.stringify([now, set])}`);
  // Far off the crest either way there is no foam.
  assert.equal(surf(here(settings.ahead + 1), 0, 0, t).foam, 0);
  assert.ok(surf(here(-80), 0, 0, t).foam < 0.01);
  // No swell, no surf.
  assert.deepEqual(surf({ ...here(-1), swell: 0 }, 0, 0, t), { foam: 0, height: 0, slope: 0 });
});

test('foam fades out where the swell runs out, with no edge where it stops', () => {
  const settings = config.water.surf;
  const surf = createSurf(settings, [0, -1]);
  const at = (swell, t) => surf({ swell, depth: 0.5, breaks: 1, reef: -2, late: 0, speed: 3 }, 0, 0, t).foam;
  for (let n = 0; n < 40; n++) {
    const t = (n + 0.002) * settings.period;
    assert.equal(at(0, t), 0);
    assert.ok(at(0.002, t) < 0.02, `${at(0.002, t)} foam with hardly any swell`);
    for (let swell = 0; swell < 0.1; swell += 0.002) assert.ok(Math.abs(at(swell + 0.002, t) - at(swell, t)) < 0.08, `foam jumps from swell ${swell}`);
  }
});

test('a wave stays within what the water lets it, and its slope is how its height rises along the way it runs', () => {
  const settings = config.water.surf;
  const surf = createSurf(settings, [0, -1]);
  const r = createRandom(1)('test/surf');
  for (let n = 0; n < 2000; n++) {
    const depth = r.range(0.05, 40);
    const here = { swell: Math.min(depth / 1.6, 1), depth, breaks: r.range(0, 1), reef: r.range(-50, 300), late: r.range(0, 30), speed: Math.min(Math.sqrt(9.81 * depth), 17) };
    const t = r.range(0, 900);
    const { height, slope } = surf(here, 0, 0, t);
    assert.ok(height <= settings.limit * depth + 1e-6, `${height} m over ${depth} m of water`);
    assert.ok(height >= -settings.dips * depth - 1e-6, `down ${height} m over ${depth} m of water`);
    // Moving along its way alone: where it gets to later by that much, as all else stands.
    const d = 0.001;
    const [back, on] = [surf({ ...here, late: here.late - d / here.speed }, 0, 0, t), surf({ ...here, late: here.late + d / here.speed }, 0, 0, t)];
    const rise = (on.height - back.height) / (2 * d);
    if (Math.abs(height) < settings.dips * depth * 0.99) assert.ok(Math.abs(rise - slope) < 0.02 + 0.2 * Math.abs(slope), `slope ${slope}, by its heights ${rise}`);
  }
});

test('the surf and what drifts over the water go on across the waves\' loop: whole sets in it, whole tiles', () => {
  const { loop } = config.water.waves;
  const sets = loop / (40 * config.water.surf.period);
  assert.ok(Number.isInteger(sets), `${sets} sets of the surf in the waves' loop`);
  for (const drift of config.water.glints.drift) for (const tiles of drift) assert.ok(Number.isInteger(tiles), `glints drift ${tiles} tiles in the loop`);
});

test('how fast a wave runs: as over deep water where it is deep, by the root of the depth where it is shallow', () => {
  const { period } = settings.swell;
  const inDeep = waveSpeed(Infinity, period);
  assert.ok(Math.abs(inDeep - (9.81 * period) / (2 * Math.PI)) < 1e-9);
  assert.ok(Math.abs(waveSpeed(1000, period) / inDeep - 1) < 0.01, `${waveSpeed(1000, period)} m/s over 1000 m`);
  assert.ok(Math.abs(waveSpeed(0.5, period) / Math.sqrt(9.81 * 0.5) - 1) < 0.02, `${waveSpeed(0.5, period)} m/s over 0.5 m`);
  let last = 0;
  for (let depth = 0.1; depth < 200; depth *= 1.2) {
    assert.ok(waveSpeed(depth, period) > last);
    last = waveSpeed(depth, period);
  }
});

test('the swell\'s waves get to each place later the further along their way, slowed over the shallows, bending towards them', () => {
  // Deep water with a round shoal in the middle, and the swell running straight in.
  const samples = 256;
  const flat = (texel, depthAt) => {
    const heights = new Float32Array(samples * samples);
    for (let j = 0, n = 0; j < samples; j++) for (let i = 0; i < samples; i++, n++) heights[n] = -depthAt(i * texel, j * texel);
    return { samples, texel, origin: [0, 0], heights, info: new Float32Array(4 * samples * samples) };
  };
  const swell = { ...config.water.map.swell, from: 0, spread: [[0, 1]] };
  const over = (depthAt) => buildSeaMap({ levels: [flat(8, depthAt)] }, { ...config.water.map, texel: 8, swell }, 1, 0);
  const deep = over(() => 200);
  const middle = (samples - 1) * 4;
  const [da, dO] = [0, -1]; // from: 0: in from straight out to sea
  const open = deep.at(middle, middle);
  assert.ok(Math.abs(open.wayA - da) < 1e-3 && Math.abs(open.wayO - dO) < 1e-3, `over deep water it runs ${open.wayA}, ${open.wayO}`);
  // The grid's upwind edge is where it starts: over deep water it hardly falls behind.
  assert.ok(Math.abs(open.late) < 2, `${open.late} s late over deep water`);
  const shoal = over((x, z) => (Math.hypot(x - middle, z - middle) < 200 ? 2 : 200));
  assert.ok(shoal.at(middle, middle).speed < 0.5 * deep.at(middle, middle).speed);
  // Behind the shoal it comes late; far to the side it never knew.
  const behind = shoal.at(middle, middle - 260);
  const aside = shoal.at(middle + 800, middle - 260);
  assert.ok(behind.late > aside.late + 0.5, `behind the shoal ${behind.late} s, aside ${aside.late} s`);
  // Past each flank, what went round it closes in behind it.
  const left = shoal.at(middle - 200, middle - 300);
  const right = shoal.at(middle + 200, middle - 300);
  assert.ok(left.wayA > 0.01 && right.wayA < -0.01, `behind the flanks it runs ${left.wayA} and ${right.wayA}`);
  // The island: it arrives later along its way, everywhere on the water.
  for (const seed of [1, 7, 13]) {
    const { map } = seaOf(seed);
    const r = createRandom(seed)('test/sea-map/arrivals');
    const inDeep = waveSpeed(Infinity, settings.swell.period);
    const t = (settings.swell.from * Math.PI) / 180;
    const way = [-side * Math.sin(t), -Math.cos(t)];
    const arrives = (a, o, s) => s.late + (a * way[0] + o * way[1]) / inDeep;
    let judged = 0;
    let later = 0;
    for (let n = 0; n < 4000; n++) {
      const a = map.origin[0] + r.range(0.1, 0.9) * (map.samples - 1) * map.texel;
      const o = map.origin[1] + r.range(0.1, 0.9) * (map.samples - 1) * map.texel;
      const s = map.at(a, o);
      if (s.depth < 2) continue;
      const step = 2 * map.texel;
      judged++;
      if (arrives(a + s.wayA * step, o + s.wayO * step, map.at(a + s.wayA * step, o + s.wayO * step)) > arrives(a, o, s)) later++;
    }
    assert.ok(judged > 500 && later / judged > 0.97, `seed ${seed}: later along its way at ${later} of ${judged} points`);
    const far = map.at(side * Math.sin(t) * 1200, Math.cos(t) * 1200);
    assert.ok(far.wayA * way[0] + far.wayO * way[1] > 0.95, `seed ${seed}: 1200 m out on its side it runs ${far.wayA}, ${far.wayO}`);
  }
});

test('the lagoon lies calmer than the open sea: the reef stops the open sea\'s chop as it stops the swell', () => {
  const spectrum = { loop: 900, cascades: [] };
  for (const seed of SEEDS) {
    const { map, island } = seaOf(seed);
    const { reachInto } = createSurface(spectrum, map, island.toCove, config.water.waves.inJs, config.water.waves.ripplesLeast, config.water.waves.ripplesDepth);
    const t = (settings.swell.from * Math.PI) / 180;
    const [x, z] = island.fromCove(side * Math.sin(t) * 800, Math.cos(t) * 800);
    const out = reachInto(x, z, [0, 0, 0]);
    assert.ok(out[1] > 0.9 && out[2] > 0.9, `seed ${seed}: 800 m out the chop reaches ${out[1]}, the ripples ${out[2]}`);
    let [chop, ripples, count] = [0, 0, 0];
    for (let a = 40; a < 140; a += 8) {
      for (let o = 60; o < 300; o += 8) {
        const s = map.at(a, o);
        if (s.reef >= -20 || s.shore <= 15) continue;
        const reach = reachInto(...island.fromCove(a, o), [0, 0, 0]);
        chop += reach[1];
        ripples += reach[2];
        count++;
      }
    }
    assert.ok(count > 20, `seed ${seed}: only ${count} points of lagoon`);
    assert.ok(chop / count < 0.4 * out[1], `seed ${seed}: chop in the lagoon ${chop / count}, out at sea ${out[1]}`);
    assert.ok(ripples / count < 0.85 * out[2], `seed ${seed}: ripples in the lagoon ${ripples / count}, out at sea ${out[2]}`);
    // All round the island: where the wind blows in over a reef, the crest breaks its chop and it starts over.
    const here = {};
    let [lagoon, rough] = [0, 0];
    for (let j = 0; j < map.samples; j += 2) {
      for (let i = 0; i < map.samples; i += 2) {
        map.at(map.origin[0] + i * map.texel, map.origin[1] + j * map.texel, here);
        if (here.reef > -40 || here.reef < -400 || here.shore < 15 || here.depth < 1) continue;
        lagoon++;
        if (Math.max(here.wind * here.wind, here.swell * here.swell) > 0.5) rough++;
      }
    }
    assert.ok(lagoon > 200 && rough / lagoon < 0.35, `seed ${seed}: ${rough} of ${lagoon} points behind a reef as rough as the sea`);
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
  const map = { shore: [1], depth: [2], swell: [3], wind: [4], toShoreA: [5], toShoreO: [6], breaks: [7], reef: [8], late: [9], wayA: [10], wayO: [11], speed: [12] };
  const [first, second, third] = seaMapLayers(map, (v) => v);
  assert.deepEqual([...first], [1, 2, 3, 4]);
  assert.deepEqual([...second], [5, 6, 7, 8]);
  assert.deepEqual([...third], [9, 10, 11, 12]);
});
