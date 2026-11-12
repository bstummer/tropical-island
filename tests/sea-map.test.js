// What the sea knows of the island (water/sea-map.js): invariants over seeds
// 1-20, on grids 8 m apart, the coarsest the reef's crest still shows on, and
// on the game's own grids and map for its seed. The GPU's side is the water
// fixture's to check.
import test from 'node:test';
import assert from 'node:assert/strict';
import { config } from '../src/config.js';
import { createRandom } from '../src/core/random.js';
import { createIsland } from '../src/world/island.js';
import { buildHeightmap, layoutLevel } from '../src/world/heightmap.js';
import { fromHalfFloat, toHalfFloatNearest } from '../src/maths/index.js';
import { buildSeaMap, seaMapLevels, waveSpeed } from '../src/water/sea-map.js';
import { createSurface } from '../src/water/surface.js';
import { createSurf } from '../src/water/surf.js';

const side = config.world.island.cove.headlandSide;
const SEEDS = Array.from({ length: 20 }, (_, i) => i + 1);
// The waves in one whole set of the surf: its two beats come round together (water/surf.js).
const gcd = (a, b) => (b ? gcd(b, a % b) : a);
const SET = (config.water.surf.sets[0] * config.water.surf.sets[1]) / gcd(...config.water.surf.sets);

// The way the swell runs in the world, as water/water.js has it: in from where the waves come from.
function swellWay(island) {
  const t = (config.water.waves.swell.from * Math.PI) / 180;
  return island.fromCove(side * Math.sin(t), Math.cos(t)).map((v) => -v);
}
const gameWay = swellWay(createIsland(createRandom(config.defaults.seed))); // for the surf at made-up places

// A seed's sea map, from its grids laid out by `terrain`; `ground`: the height
// as drawn on each of the map's lines; `surf`, as the game makes it.
function seaFor(seed, name, terrain, settings) {
  const island = createIsland(createRandom(seed));
  const heightmap = buildHeightmap(island, terrain);
  const map = buildSeaMap(heightmap, settings, side, terrain.blend);
  const ground = new Float32Array(map.samples * map.samples);
  for (let j = 0, k = 0; j < map.samples; j++) {
    for (let i = 0; i < map.samples; i++, k++) ground[k] = heightmap.heightAtCove(map.origin[0] + i * map.texel, map.origin[1] + j * map.texel);
  }
  return { seed, name, island, heightmap, map, ground, surf: createSurf(config.water.surf, swellWay(island)) };
}

// Each seed on one grid 8 m apart, a second or so to build. The game's own, 2 m
// round the island and its map 4 m, takes ten times that: its seed alone.
const cheap = new Map();
let game = null;
function seaOf(seed) {
  if (!cheap.has(seed)) cheap.set(seed, seaFor(seed, `seed ${seed}`, { ...config.world.terrain, levels: [{ texel: 8 }] }, { ...config.water.map, texel: 8 }));
  return cheap.get(seed);
}
function eachSea(check) {
  for (const seed of SEEDS) check(seaOf(seed));
  game ??= seaFor(config.defaults.seed, `the game's map (seed ${config.defaults.seed})`, config.world.terrain, config.water.map);
  check(game);
}

test('the map covers the coarsest grid, its samples on the lines of the grid, and at() reads a sample as it is', () => eachSea(({ seed, name, map, heightmap }) => {
  const coarsest = heightmap.levels.at(-1);
  assert.deepEqual(map.origin, coarsest.origin);
  assert.ok(Number.isInteger(coarsest.texel / map.texel) && (map.samples - 1) * map.texel >= (coarsest.samples - 1) * coarsest.texel, `${name}: ${map.samples} samples ${map.texel} m apart over ${coarsest.samples} ${coarsest.texel} m apart`);
  const r = createRandom(seed)('test/sea-map');
  for (let n = 0; n < 1000; n++) {
    const i = r.int(1, map.samples - 2);
    const j = r.int(1, map.samples - 2);
    const k = j * map.samples + i;
    const at = map.at(map.origin[0] + i * map.texel, map.origin[1] + j * map.texel);
    for (const key of ['shore', 'depth', 'reef', 'swell', 'wind', 'surf', 'breaks', 'late', 'wayA', 'wayO', 'speed']) assert.ok(Math.abs(at[key] - map[key][k]) < 1e-5, `${name}: ${key} at ${i}, ${j}: ${at[key]}, not ${map[key][k]}`);
  }
}));

test('the shore: zero on the drawn waterline, + at sea, - on land, growing by a metre a metre; the way inland leads to the nearest waterline from either side, and runs on across it', () => eachSea(({ name, map, ground }) => {
  const n = map.samples;
  let sloped = 0;
  let judged = 0;
  const walks = { 'at sea': { walked: 0, arrived: 0 }, 'on land': { walked: 0, arrived: 0 } };
  let [crossings, whole] = [0, 0];
  for (let j = 1; j < n - 1; j++) {
    for (let i = 1; i < n - 1; i++) {
      const k = j * n + i;
      const d = map.shore[k];
      const h = ground[k];
      assert.equal(d > 0, h < 0, `${name} at ${i}, ${j}: height ${h}, shore ${d}`);
      if (h < 0 !== ground[k + 1] < 0) {
        assert.ok(Math.abs(d) <= map.texel, `${name} at ${i}, ${j}: the waterline lies next to it, ${d} m by the map`);
        // Read between the two, as the GPU filters it: a whole way, not two halves cancelling.
        const between = map.at(map.origin[0] + (i + 0.5) * map.texel, map.origin[1] + j * map.texel);
        crossings++;
        if (Math.hypot(between.inlandA, between.inlandO) > 0.9) whole++;
      }
      const grad = Math.hypot(map.shore[k + 1] - map.shore[k - 1], map.shore[k + n] - map.shore[k - n]) / (2 * map.texel);
      judged++;
      if (grad > 0.8 && grad < 1.15) sloped++;
      if ((i + j) % 7 === 0 && Math.abs(d) > 20 && Math.abs(d) < 400) {
        const walk = walks[d > 0 ? 'at sea' : 'on land'];
        walk.walked++;
        const a = map.origin[0] + i * map.texel;
        const o = map.origin[1] + j * map.texel;
        const there = map.at(a + map.inlandA[k] * d, o + map.inlandO[k] * d).shore;
        if (Math.abs(there) < 1.5 * map.texel) walk.arrived++;
      }
    }
  }
  // Ridges of the field, midway between shores, are few.
  assert.ok(sloped / judged > 0.93, `${name}: the distance grows by a metre a metre at only ${((100 * sloped) / judged).toFixed(1)}% of samples`);
  for (const [where, { walked, arrived }] of Object.entries(walks)) {
    assert.ok(walked > 100 && arrived / walked > 0.95, `${name}: following the way to the shore reaches it from only ${((100 * arrived) / walked).toFixed(1)}% of ${walked} points ${where}`);
  }
  assert.ok(crossings > 100 && whole / crossings > 0.95, `${name}: the way inland read on the waterline is whole at only ${((100 * whole) / crossings).toFixed(1)}% of ${crossings} crossings`);
}));

test('the swell: full over the open sea on the side it comes from, none over land, small in the lagoon behind the reef, and never more than the water allows', () => eachSea(({ name, map, ground }) => {
  const { from, breaks } = config.water.map.swell;
  const n = map.samples;
  // Straight in from the open sea, along the middle of its fan, to the cove.
  const t = (from * Math.PI) / 180;
  const [da, dO] = [side * Math.sin(t), Math.cos(t)];
  const out = map.at(da * 800, dO * 800);
  assert.ok(out.reef > 0 && out.swell > 0.97, `${name}: 800 m out on the swell's side it reaches ${out.swell}`);
  for (let k = 0; k < n * n; k++) {
    const h = ground[k];
    if (h >= 0) assert.equal(map.swell[k], 0, `${name}: swell ${map.swell[k]} over land at ${k % n}, ${Math.floor(k / n)}`);
    assert.ok(map.swell[k] <= Math.min(Math.max(-h, 0) / breaks, 1) + 1e-5, `${name}: swell ${map.swell[k]} over ${-h} m at ${k % n}, ${Math.floor(k / n)}`);
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
  assert.ok(count > 20 && inside / count < 0.5, `${name}: in the lagoon the swell reaches ${(inside / count).toFixed(2)} on average over ${count} points`);
}));

test('a pass lets through more swell than the reef beside it, and the surf breaks on the reef and not in the pass', () => {
  const { pass } = config.world.island.seabed;
  const [a0, o0] = pass.from;
  const [a1, o1] = pass.to;
  eachSea(({ name, map }) => {
    // Along the pass, the deepest it gets: where it runs through the crest.
    let through = null;
    for (let t = 0; t <= 1; t += 0.02) {
      const at = [a0 + (a1 - a0) * t, o0 + (o1 - o0) * t];
      const s = map.at(...at);
      if (!through || Math.abs(s.reef) < Math.abs(through.s.reef)) through = { at, s };
    }
    assert.ok(through.s.surf < 0.05, `${name}: surf ${through.s.surf} in the pass`);
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
    assert.ok(behindPass && behindReef, `${name}: the crest not found`);
    assert.ok(behindPass.swell > behindReef.swell + 0.05, `${name}: behind the pass ${behindPass.swell.toFixed(2)}, behind the reef ${behindReef.swell.toFixed(2)}`);
    // On the crest straight out from the beach, it breaks.
    let most = 0;
    for (let o = 200; o < 330; o += 2) most = Math.max(most, map.at(through.at[0] + 120, o).surf);
    assert.ok(most > 0.1, `${name}: surf at most ${most} on the crest beside the pass`);
  });
});

test('the surf whitens only near the shallows it breaks on, none in the pass, and none out at sea', () => {
  const { pass } = config.world.island.seabed;
  const [a0, o0] = pass.from;
  const [a1, o1] = pass.to;
  const { ahead, fades, period } = config.water.surf;
  eachSea(({ name, map, island, surf }) => {
    let foamed = 0;
    const here = {};
    for (let j = 0; j < map.samples; j += 3) {
      for (let i = 0; i < map.samples; i += 3) {
        const [a, o] = [map.origin[0] + i * map.texel, map.origin[1] + j * map.texel];
        map.at(a, o, here);
        if (here.swell <= 0) continue;
        const [x, z] = island.fromCove(a, o);
        for (const t of [3, 40, 3 + period / 2]) {
          const { foam, height } = surf(here, x, z, t);
          if (foam > 0.01) {
            foamed++;
            assert.ok(here.reef < ahead + 1e-3, `${name}: foam ${foam} ${here.reef} m seaward of the crest`);
          }
          if (Math.abs(height) > 1e-3) assert.ok(here.reef < fades[1] + 1e-3, `${name}: a wave ${height} m high ${here.reef} m seaward of the crest`);
        }
      }
    }
    assert.ok(foamed > 20, `${name}: only ${foamed} points foam`);
    // In the pass, where it runs through the crest, it hardly breaks at all.
    let through = null;
    for (let t = 0; t <= 1; t += 0.02) {
      const s = map.at(a0 + (a1 - a0) * t, o0 + (o1 - o0) * t);
      if (!through || Math.abs(s.reef) < Math.abs(through.reef)) through = s;
    }
    assert.ok(through.breaks < 0.2, `${name}: the surf breaks ${through.breaks} in the pass`);
    // On the crest beside it, it does.
    let most = 0;
    for (let o = 200; o < 330; o += 2) most = Math.max(most, map.at(a1 + 240, o).breaks);
    assert.ok(most > 0.5, `${name}: it breaks at most ${most} on the crest beside the pass`);
    // Away from the shallows it doesn't: the deep sea outside.
    assert.ok(map.at(a1 + 240, 500).breaks < 0.01, `${name}: it breaks ${map.at(a1 + 240, 500).breaks} out at sea`);
  });
});

test('a wave comes in from the open sea: seen hundreds of metres out, rising as it slows, tallest near the crest, gone over the flat', () => {
  const { period, fades } = config.water.surf;
  const { pass } = config.world.island.seabed;
  const a = pass.to[0] + 240;
  eachSea(({ name, map, island, surf }) => {
    // The tallest it stands at a point over a set of waves.
    const tallest = (s) => {
      let most = 0;
      for (let t = 0; t < SET * period; t += period / 16) most = Math.max(most, surf(s, s.x, s.z, t).height);
      return most;
    };
    const line = [];
    for (let o = 700; o > 0; o -= 8) {
      const s = map.at(a, o);
      [s.x, s.z] = island.fromCove(a, o);
      if (s.swell > 0 && s.reef > -60) line.push(s);
    }
    const out = line.find((s) => s.reef < fades[0] && s.reef > 200);
    const crest = line.reduce((best, s) => (Math.abs(s.reef) < Math.abs(best.reef) ? s : best));
    const near = Math.max(...line.filter((s) => Math.abs(s.reef) < 40).map(tallest));
    assert.ok(out, `${name}: no water 200 m and more seaward of the crest`);
    assert.ok(tallest(out) > 0.1, `${name}: ${out.reef} m out it stands ${tallest(out)} m`);
    assert.ok(near > 1.3 * tallest(out), `${name}: ${tallest(out)} m out at sea, ${near} m near the crest`);
    assert.ok(crest.speed < 0.5 * map.at(a, 700).speed, `${name}: on the crest it runs at ${crest.speed} m/s`);
    const flat = line.at(-1);
    assert.ok(tallest(flat) < 0.5 * near, `${name}: ${tallest(flat)} m high ${-flat.reef} m inside the crest, ${near} m near it`);
  });
});

test('how a wave breaks goes by its size: the big ones of a set seaward of the crest, the small on it alone, in less white', () => {
  const settings = config.water.surf;
  const surf = createSurf(settings, gameWay);
  const seaward = { swell: 0.64, depth: 4, breaks: 1, reef: 4, late: 0, speed: 6 };
  const onCrest = { swell: 0.2, depth: 0.8, breaks: 1, reef: -2, late: 0, speed: 3 };
  // What each of a set's waves brings just as it passes, over what lies there in a lull.
  const whiteOf = (here) => {
    const foam = Array.from({ length: SET }, (_, n) => surf(here, 0, 0, (n + 0.002) * settings.period).foam);
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
  const surf = createSurf(settings, gameWay);
  // Slow enough for both to be full peaks, deep enough for neither to be held: the rest stands the same.
  const tallest = (speed) => {
    const here = { swell: 1, depth: 100, breaks: 0, reef: 0, late: 0, speed };
    let most = 0;
    for (let t = 0; t < SET * settings.period; t += settings.period / 64) most = Math.max(most, surf(here, 0, 0, t).height);
    return most;
  };
  const ratio = tallest(2) / tallest(4);
  assert.ok(Math.abs(ratio - 2 ** settings.shoals) < 0.05, `twice as slow, ${ratio} times as tall`);
  // Over water that won't carry it, it is held to that, however slow.
  const shallow = { swell: 1, depth: 0.5, breaks: 0, reef: 0, late: 0, speed: 2 };
  for (let t = 0; t < SET * settings.period; t += settings.period / 64) assert.ok(surf(shallow, 0, 0, t).height <= settings.limit * 0.5 + 1e-6);
});

test('a wave of the surf runs in: its foam\'s front lies further inside the crest as time goes on, and the whole of it comes back a set later', () => {
  const settings = config.water.surf;
  const surf = createSurf(settings, gameWay);
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
  const [now, set] = [surf(here(-4), 0, 0, t), surf(here(-4), 0, 0, t + SET * settings.period)];
  assert.ok(Math.abs(now.foam - set.foam) < 1e-6 && Math.abs(now.height - set.height) < 1e-6, `a set later: ${JSON.stringify([now, set])}`);
  // Far inside the crest there is no foam; seaward of it, it thins out to none
  // `ahead` m out, with no edge where it stops.
  assert.ok(surf(here(-80), 0, 0, t).foam < 0.01);
  for (const when of [t, t + 3, t + 7]) {
    let last = surf(here(1), 0, 0, when).foam;
    let most = last;
    for (let reef = 1; reef < settings.ahead + 2; reef += 0.02) {
      const { foam } = surf(here(reef), 0, 0, when);
      assert.ok(Math.abs(foam - last) < 0.02, `foam jumps from ${last} to ${foam} ${reef.toFixed(2)} m seaward of the crest`);
      [last, most] = [foam, Math.max(most, foam)];
    }
    const edge = surf(here(settings.ahead - 0.1), 0, 0, when).foam;
    assert.ok(most > 0.1 && edge < 0.01, `seaward of the crest at most ${most} foam, ${edge} 0.1 m short of ${settings.ahead} m out`);
  }
});

test('foam fades out where the swell runs out, and the wave with it, with no edge where they stop', () => {
  const settings = config.water.surf;
  const surf = createSurf(settings, gameWay);
  const place = (swell) => ({ swell, depth: 0.5, breaks: 1, reef: -2, late: 0, speed: 3 });
  const at = (swell, t) => surf(place(swell), 0, 0, t).foam;
  for (let n = 0; n < 40; n++) {
    const t = (n + 0.002) * settings.period;
    assert.ok(at(0.002, t) < 0.02, `${at(0.002, t)} foam with hardly any swell`);
    for (let swell = 0; swell < 0.1; swell += 0.002) assert.ok(Math.abs(at(swell + 0.002, t) - at(swell, t)) < 0.08, `foam jumps from swell ${swell}`);
  }
  // The tallest a wave stands over a set, up or down, shrinks to nothing with the swell.
  const tallest = (swell) => {
    let most = 0;
    for (let t = 0; t < SET * settings.period; t += settings.period / 16) most = Math.max(most, Math.abs(surf(place(swell), 0, 0, t).height));
    return most;
  };
  const heights = [1e-2, 1e-4, 1e-6].map(tallest);
  assert.ok(heights[0] > heights[1] && heights[1] > heights[2] && heights[2] < 0.005, `as the swell runs out a wave stands ${heights.join(', ')} m`);
});

test('a wave stays within what the water lets it, and its slope is how its height rises along the way it runs', () => {
  const settings = config.water.surf;
  const surf = createSurf(settings, gameWay);
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
  const sets = loop / (SET * config.water.surf.period);
  assert.ok(Number.isInteger(sets), `${sets} sets of the surf in the waves' loop`);
  // Along a crest a wave goes on into the next set as it was: whole turns over each beat.
  for (const [, turns] of config.water.surf.along) assert.ok(Number.isInteger(turns), `${turns} turns along a crest over a beat`);
  for (const drift of config.water.glints.drift) for (const tiles of drift) assert.ok(Number.isInteger(tiles), `glints drift ${tiles} tiles in the loop`);
});

test('the sea map\'s swell comes from where the waves\' does: the surf times its waves by the one and runs them by the other', () => {
  assert.equal(config.water.map.swell.from, config.water.waves.swell.from);
});

test('how fast a wave runs: as over deep water where it is deep, by the root of the depth where it is shallow', () => {
  const { period } = config.water.map.swell;
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
  const inDeep = waveSpeed(Infinity, config.water.map.swell.period);
  const t = (config.water.map.swell.from * Math.PI) / 180;
  const way = [-side * Math.sin(t), -Math.cos(t)];
  const arrives = (a, o, s) => s.late + (a * way[0] + o * way[1]) / inDeep;
  eachSea(({ seed, name, map }) => {
    const r = createRandom(seed)('test/sea-map/arrivals');
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
    assert.ok(judged > 500 && later / judged > 0.97, `${name}: later along its way at ${later} of ${judged} points`);
    const far = map.at(side * Math.sin(t) * 1200, Math.cos(t) * 1200);
    assert.ok(far.wayA * way[0] + far.wayO * way[1] > 0.95, `${name}: 1200 m out on its side it runs ${far.wayA}, ${far.wayO}`);
  });
});

test('the lagoon lies calmer than the open sea: the reef stops the open sea\'s chop as it stops the swell', () => {
  const waves = config.water.waves;
  const spectrum = { loop: waves.loop, cascades: [] };
  eachSea(({ name, map, island, surf }) => {
    const { reachInto } = createSurface(spectrum, map, island.toCove, waves.inJs, waves.ripplesLeast, waves.ripplesDepth, surf, waves.chopWander);
    const t = (config.water.map.swell.from * Math.PI) / 180;
    const [x, z] = island.fromCove(side * Math.sin(t) * 800, Math.cos(t) * 800);
    const out = reachInto(x, z, [0, 0, 0]);
    assert.ok(out[1] > 0.9 && out[2] > 0.9, `${name}: 800 m out the chop reaches ${out[1]}, the ripples ${out[2]}`);
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
    assert.ok(count > 20, `${name}: only ${count} points of lagoon`);
    assert.ok(chop / count < 0.4 * out[1], `${name}: chop in the lagoon ${chop / count}, out at sea ${out[1]}`);
    assert.ok(ripples / count < 0.85 * out[2], `${name}: ripples in the lagoon ${ripples / count}, out at sea ${out[2]}`);
    // All round the island: where the wind blows in over a reef, the crest breaks its chop and it starts over.
    const here = {};
    let [lagoon, rough] = [0, 0];
    for (let j = 0; j < map.samples; j += 2) {
      for (let i = 0; i < map.samples; i += 2) {
        map.at(map.origin[0] + i * map.texel, map.origin[1] + j * map.texel, here);
        if (here.reef > -40 || here.reef < -400 || here.shore < 15 || here.depth < 1) continue;
        lagoon++;
        if (here.chop > 0.5) rough++;
      }
    }
    assert.ok(lagoon > 200 && rough / lagoon < 0.35, `${name}: ${rough} of ${lagoon} points behind a reef as rough as the sea`);
  });
});

test('surf only where the water is shallow, and only where swell arrives', () => {
  const { breaks } = config.water.map.swell;
  eachSea(({ name, map, heightmap }) => {
    for (let k = 0; k < map.surf.length; k++) {
      if (map.surf[k] <= 0.01) continue;
      // The shallowest round it, half a sample each way: a crest between the lines breaks the swell on both.
      const [i, j] = [k % map.samples, Math.floor(k / map.samples)];
      let top = -Infinity;
      for (const da of [-0.5, 0, 0.5]) for (const dO of [-0.5, 0, 0.5]) top = Math.max(top, heightmap.heightAtCove(map.origin[0] + (i + da) * map.texel, map.origin[1] + (j + dO) * map.texel));
      assert.ok(top > -breaks - 1e-3, `${name}: surf ${map.surf[k]} over ${-top} m at ${i}, ${j}`);
    }
  });
});

test('the wind: nothing on land, calm close under the lee of the island, grown by a kilometre of open water', () => eachSea(({ name, map, ground }) => {
  for (let k = 0; k < map.wind.length; k++) if (ground[k] >= 0) assert.equal(map.wind[k], 0, `${name}: chop ${map.wind[k]} on land at ${k % map.samples}, ${Math.floor(k / map.samples)}`);
  const near = map.at(0, 30);
  const far = map.at(0, 1200);
  assert.ok(near.wind < 0.3, `${name}: 30 m off the beach, with the wind off the land, chop ${near.wind}`);
  assert.ok(far.wind > 0.8, `${name}: 1200 m out, chop only ${far.wind}`);
}));

test('past the map\'s square the open sea takes over, from its edge on and wholly by open.over m out: all the swell and the wind, no surf, the reef\'s crest far off', () => {
  const { over, reef } = config.water.map.open;
  const open = { swell: 1, wind: 1, chop: 1, surf: 0, breaks: 0, reef };
  eachSea(({ name, map }) => {
    const last = map.samples - 1;
    // Straight out from samples along each edge, and from each corner.
    const starts = [];
    for (const along of [0.1, 0.3, 0.5, 0.7, 0.9]) {
      const m = Math.round(along * last);
      starts.push([0, m, [-1, 0]], [last, m, [1, 0]], [m, 0, [0, -1]], [m, last, [0, 1]]);
    }
    for (const [i, j] of [[0, 0], [last, 0], [0, last], [last, last]]) starts.push([i, j, [Math.sign(i - 0.5) * Math.SQRT1_2, Math.sign(j - 0.5) * Math.SQRT1_2]]);
    for (const [i, j, [da, dO]] of starts) {
      const [a, o] = [map.origin[0] + i * map.texel, map.origin[1] + j * map.texel];
      const k = j * map.samples + i;
      let before = map.at(a, o);
      for (const key of Object.keys(open)) {
        assert.ok(Math.abs(before[key] - map[key][k]) < 1e-5, `${name}: ${key} ${before[key]} on the edge at ${i}, ${j}, the sample there ${map[key][k]}`);
      }
      for (const past of [1, 500, 1000, over, 1.5 * over]) {
        const now = map.at(a + da * past, o + dO * past);
        for (const [key, value] of Object.entries(open)) {
          const [was, is, edge] = [before[key] - value, now[key] - value, map[key][k] - value];
          const at = `${name}: ${key} ${past} m past the edge at ${i}, ${j}`;
          // Ever nearer the open sea's, never past it; a metre out still as on the edge, with no step where the square ends.
          assert.ok(Math.abs(is) <= Math.abs(was) + 1e-6 && is * edge >= 0, `${at}: ${now[key]}, ${before[key]} nearer it`);
          if (past === 1) assert.ok(Math.abs(is - edge) <= 1e-3 * Math.abs(edge) + 1e-6, `${at}: ${now[key]}, ${map[key][k]} on it`);
          if (past >= over) assert.ok(Math.abs(is) <= 1e-4 * Math.max(Math.abs(value), 1), `${at}: ${now[key]}, not the open sea's ${value}`);
        }
        before = now;
      }
    }
  });
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
  assert.ok(map.wind[k] <= 0.3 / config.water.map.wind.depth + 1e-5, `the wind's chop reaches ${map.wind[k]} beside a crest 0.3 m deep`);
  // The chop crosses it as far as the water holds it, and dies away behind.
  const behind = 32 * map.samples + (ridge + 1) / 2;
  assert.ok(map.chop[behind] <= 0.3 / config.water.map.chop.breaks + 1e-5, `the chop reaches ${map.chop[behind]} behind a crest 0.3 m deep`);
});

// What the reef's crest takes from the chop fades out behind it over the flat, as
// broken waves run on and die away, rather than stopping along a line on the water
// that nothing on it explains; and what the wind raises in a lagoon grows from what
// crossed. Between neighbours on the same side of a crest, within `near` m of it but
// for the line it breaks on, where the surf's foam lies, and away from the shore.
test("the chop fades across a reef's crest: no step on the water where it ends, and some of it runs on over the flat", () => {
  const near = 40;
  const steepest = 0.1; // of the chop's reach per metre
  eachSea(({ name, map }) => {
    const { samples, texel, depth, shore, reef, chop } = map;
    const counts = (n) => depth[n] > 0 && shore[n] >= 20 && Math.abs(reef[n]) <= near && Math.abs(reef[n]) >= 4;
    let [worst, at] = [0, ''];
    let [inside, ran] = [0, 0];
    for (let j = 1; j < samples - 1; j++) {
      for (let i = 1; i < samples - 1; i++) {
        const n = j * samples + i;
        if (!counts(n)) continue;
        for (const m of [n + 1, n + samples]) {
          if (!counts(m) || reef[n] * reef[m] < 0) continue;
          const step = Math.abs(chop[n] - chop[m]) / texel;
          if (step > worst) [worst, at] = [step, `${i}, ${j}: ${chop[n].toFixed(2)} beside ${chop[m].toFixed(2)}, ${reef[n].toFixed(0)} m from the crest`];
        }
        // Just inside a crest the open sea's swell breaks on, how much of its chop runs on.
        if (reef[n] < -4 && reef[n] > -12 && map.surf[n] + map.breaks[n] > 0.5) {
          inside++;
          ran += chop[n];
        }
      }
    }
    assert.ok(worst <= steepest, `${name}: the chop changes by ${worst.toFixed(3)} a metre at ${at}`);
    assert.ok(inside > 20 && ran / inside > 0.12, `${name}: just inside the crest the chop is ${(ran / inside).toFixed(3)} on average, over ${inside} samples`);
  });
});

test('the map\'s mip levels: each texel the mean of the four under it, but how deep the water is the mean over the water alone, and over land alone the land\'s', () => {
  const { map } = seaOf(1);
  // As the GPU gets them, back to numbers: each within a half float's step of what it should be.
  const levels = seaMapLevels(map, toHalfFloatNearest, 3).map((layers) => layers.map((texels) => Float32Array.from(texels, fromHalfFloat)));
  assert.equal(levels.length, 3);
  const near = (a, b) => Math.abs(a - b) <= 2e-3 * Math.max(Math.abs(a), Math.abs(b), 1);
  const size = (level) => map.samples >> level;
  let [shore, deep, all] = [0, 0, 0];
  for (let level = 1; level < 3; level++) {
    const [above, here] = [levels[level - 1][0], levels[level][0]];
    const [n0, n1] = [size(level - 1), size(level)];
    for (let j = 0; j < n1; j++) {
      for (let i = 0; i < n1; i++) {
        const four = [0, 1, n0, n0 + 1].map((d) => 2 * j * n0 + 2 * i + d);
        const depths = four.map((k) => above[4 * k + 1]);
        const at = 4 * (j * n1 + i);
        const mean = (c) => four.reduce((sum, k) => sum + above[4 * k + c], 0) / 4;
        assert.ok(near(here[at], mean(0)) && near(here[at + 2], mean(2)), `level ${level} at ${i}, ${j}: not the mean`);
        if (depths.every((d) => d <= 0)) {
          all++;
          assert.ok(near(here[at + 1], mean(1)), `level ${level} at ${i}, ${j}: over land ${here[at + 1]}, not ${mean(1)}`);
        } else if (depths.some((d) => d <= 0) && level === 1) {
          // On a shore, no shallower than the water there alone: land doesn't pull it down.
          shore++;
          const water = depths.filter((d) => d > 0);
          assert.ok(near(here[at + 1], water.reduce((a, b) => a + b, 0) / water.length), `on a shore at ${i}, ${j}: ${here[at + 1]} from ${depths}`);
        } else if (depths.every((d) => d > 0)) {
          deep++;
        }
      }
    }
  }
  assert.ok(shore > 50 && deep > 1000 && all > 1000, `${shore} shore texels, ${deep} under water, ${all} over land`);
  // The finest is the map itself.
  for (let k = 0; k < map.samples * map.samples; k += 997) assert.ok(near(levels[0][0][4 * k + 1], map.depth[k]), `depth ${levels[0][0][4 * k + 1]}, not ${map.depth[k]}`);
});

// A made-up map `size` square: every value of(i, j, name), or 1 without `of`.
const NAMES = ['shore', 'depth', 'swell', 'chop', 'inlandA', 'inlandO', 'breaks', 'reef', 'late', 'wayA', 'wayO', 'speed'];
function madeUp(size, of) {
  const values = (name) => (of ? Float32Array.from({ length: size * size }, (_, n) => of(n % size, Math.floor(n / size), name)) : new Float32Array(size * size).fill(1));
  return Object.fromEntries(NAMES.map((name) => [name, values(name)]));
}

test('a map whose side halves to an odd one still has every mip level a texture its size has, each texel the mean of what it spans', () => {
  for (const size of [12, 10]) {
    // Land in the first three columns, then water a metre deeper each column on; the rest a slope.
    const map = madeUp(size, (i, j, name) => (name === 'depth' ? (i < 3 ? -1 - j : i - 2) : i + 2 * j));
    const mean = map.swell.reduce((sum, v) => sum + v, 0) / map.swell.length;
    const count = Math.floor(Math.log2(size)) + 1;
    const levels = seaMapLevels(map, toHalfFloatNearest, count).map((layers) => layers.map((texels) => Float32Array.from(texels, fromHalfFloat)));
    assert.equal(levels.length, count, `${size} samples`);
    levels.forEach(([first], level) => {
      const side = Math.max(size >> level, 1);
      const name = `${size} samples, level ${level}`;
      assert.equal(first.length, 4 * side * side, `${name}: ${first.length / 4} texels, not ${side} square`);
      // Each texel the mean of what it spans, so the whole level's mean is the map's.
      let sum = 0;
      for (let n = 0; n < side * side; n++) sum += first[4 * n + 2];
      assert.ok(Math.abs(sum / (side * side) - mean) < 0.02, `${name}: a mean of ${sum / (side * side)}, not ${mean}`);
      // How deep: the mean over the water it spans, if it spans any; else the land's.
      for (let n = 0; n < side * side; n++) {
        const d = first[4 * n + 1];
        const water = (((n % side) + 1) * size) / side > 3;
        assert.ok(water ? d >= 0.99 && d <= size - 3 + 0.01 : d < 0, `${name} at ${n}: ${d} m deep`);
      }
    });
  }
});

test('every seed\'s sea map has every mip level a texture its size has', () => {
  // The map's side as water/water.js gets it: the coarsest grid's, on the map's samples.
  const { terrain } = config.world;
  const last = terrain.levels.length - 1;
  const sides = new Set(SEEDS.map((seed) => (layoutLevel(createIsland(createRandom(seed)), terrain, last).samples * terrain.levels[last].texel) / config.water.map.texel));
  for (const side of sides) {
    const count = Math.floor(Math.log2(side)) + 1;
    const levels = seaMapLevels(madeUp(side), (v) => v, count);
    assert.deepEqual(levels.map(([first]) => first.length / 4), Array.from({ length: count }, (_, level) => (side >> level) ** 2), `${side} samples`);
  }
});

test('the layers the GPU reads hold each value where water/sea-map.wgsl looks for it', () => {
  const map = { shore: [1], depth: [2], swell: [3], chop: [4], inlandA: [5], inlandO: [6], breaks: [7], reef: [8], late: [9], wayA: [10], wayO: [11], speed: [12] };
  const [first, second, third] = seaMapLevels(map, (v) => v, 1)[0];
  assert.deepEqual([...first], [1, 2, 3, 4]);
  assert.deepEqual([...second], [5, 6, 7, 8]);
  assert.deepEqual([...third], [9, 10, 11, 12]);
});
