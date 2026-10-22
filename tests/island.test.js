// Invariants of the island's shape (world/island.js) over seeds 1–20: they
// check properties of the layout, not numbers, so a lucky seed can't hide a bug.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRandom } from '../src/core/random.js';
import { config } from '../src/config.js';
import { sunPath } from '../src/sky/sun.js';
import { createIsland, LAND_ZONES, SEA_ZONES, smoothstep, ZONES } from '../src/world/island.js';

const SEEDS = Array.from({ length: 20 }, (_, i) => i + 1);
const settings = config.world.island;
const make = (seed, overrides = {}) => createIsland(createRandom(seed), { ...settings, ...overrides });

// World points on a grid over the island's bounds, `step` metres apart.
function grid(island, step) {
  const { minX, maxX, minZ, maxZ } = island.bounds;
  const points = [];
  for (let x = minX; x <= maxX; x += step) for (let z = minZ; z <= maxZ; z += step) points.push([x, z]);
  return points;
}

// Gradient of the signed distance to the shore: points inland.
function inland(island, x, z, step = 1) {
  const c = (dx, dz) => island.sample(x + dx, z + dz).coast;
  const g = [(c(step, 0) - c(-step, 0)) / (2 * step), (c(0, step) - c(0, -step)) / (2 * step)];
  const length = Math.hypot(...g) || 1;
  return [g[0] / length, g[1] / length];
}

// The horizontal direction towards the setting sun.
function sunset() {
  const [x, , z] = sunPath.position(sunPath.daylight.end).direction;
  const length = Math.hypot(x, z);
  return [x / length, z / length];
}

test('smoothstep eases from 0 to 1 between its edges, either way round, and steps where they meet', () => {
  assert.equal(smoothstep(2, 4, 1), 0);
  assert.equal(smoothstep(2, 4, 3), 0.5);
  assert.equal(smoothstep(2, 4, 5), 1);
  assert.equal(smoothstep(4, 2, 3.5), 1 - smoothstep(2, 4, 3.5));
  assert.deepEqual([smoothstep(1, 1, 0.9), smoothstep(1, 1, 1), smoothstep(1, 1, 2)], [0, 1, 1]);
});

test('zone names are unique and split into land and sea', () => {
  assert.equal(new Set(ZONES).size, ZONES.length);
  assert.deepEqual([...ZONES].sort(), [...SEA_ZONES, 'rock', ...LAND_ZONES].sort());
});

test('bad settings are refused', () => {
  assert.throws(() => make(1, { size: settings.minSize - 1 }), /minSize/);
  assert.throws(() => make(1, { cove: { ...settings.cove, headlandSide: 0 } }), /headlandSide/);
});

test('heights are finite, and the hills behind the cove peak at 250–300 m (PLAN.md, Decisions)', () => {
  for (const seed of SEEDS) {
    const island = make(seed);
    for (const [x, z] of grid(island, 60)) assert.ok(Number.isFinite(island.height(x, z)), `seed ${seed}: height at ${x}, ${z}`);
    let peak = -Infinity;
    for (let a = -600; a <= 600; a += 10) for (let o = -1000; o <= 0; o += 10) peak = Math.max(peak, island.height(...island.fromCove(a, o)));
    assert.ok(peak >= 250 && peak <= 300, `seed ${seed}: the cove's hills peak at ${peak.toFixed(0)} m`);
  }
});

test("the cove's frame turns world positions and back, with the headland on either side", () => {
  for (const headlandSide of [-1, 1]) {
    const island = make(1, { cove: { ...settings.cove, headlandSide } });
    for (const [x, z] of [[0, 0], [130, -40], [-75, 260], [900, 1200]]) {
      const [bx, bz] = island.fromCove(...island.toCove(x, z));
      assert.ok(Math.hypot(bx - x, bz - z) < 1e-9, `side ${headlandSide}: ${x}, ${z} came back as ${bx}, ${bz}`);
    }
    const [x, z] = island.fromCove(0, 100);
    assert.ok(Math.abs(x - 100 * island.forward[0]) < 1e-9 && Math.abs(z - 100 * island.forward[1]) < 1e-9, 'out to sea is forward');
  }
});

test('the waterline is where the coast says, and deep sea rings the island', () => {
  const check = (seed, s, x, z) =>
    assert.equal(s.height > 0, s.coast > 0, `seed ${seed}: height ${s.height.toFixed(2)} m with the coast ${s.coast.toFixed(1)} m away at ${x.toFixed(1)}, ${z.toFixed(1)}`);
  for (const seed of SEEDS) {
    const island = make(seed);
    for (const [x, z] of grid(island, 37)) {
      const s = island.sample(x, z);
      if (Math.abs(s.coast) > 0.5) check(seed, s, x, z);
    }
    // Close either side of the shore, coming in from the sea all around.
    const [cx, cz] = island.fromCove(0, settings.coast.lobes.front - settings.size / 2);
    for (let k = 0; k < 120; k++) {
      const [dx, dz] = [Math.cos((k * Math.PI) / 60), Math.sin((k * Math.PI) / 60)];
      const coast = (t) => island.sample(cx + dx * t, cz + dz * t).coast;
      let t = 3000;
      while (t > 0 && coast(t) < 0) t -= 8;
      for (let far = t + 8, i = 0; i < 12; i++) {
        const mid = (t + far) / 2;
        if (coast(mid) < 0) far = mid;
        else t = mid;
      }
      for (const step of [-6, -3, -1, 1, 3, 6]) {
        const [x, z] = [cx + dx * (t - step), cz + dz * (t - step)];
        const s = island.sample(x, z);
        if (Math.abs(s.coast) > 0.5) check(seed, s, x, z);
      }
    }
    const { minX, maxX, minZ, maxZ } = island.bounds;
    for (let t = 0; t <= 1; t += 0.01) {
      for (const [x, z] of [[minX + t * (maxX - minX), minZ], [minX + t * (maxX - minX), maxZ], [minX, minZ + t * (maxZ - minZ)], [maxX, minZ + t * (maxZ - minZ)]]) {
        assert.ok(island.height(x, z) < -50, `seed ${seed}: ${island.height(x, z).toFixed(1)} m at the bounds' edge ${x.toFixed(0)}, ${z.toFixed(0)}`);
      }
    }
  }
});

// Where the waterline crosses `a` along the beach, coming in from the bay.
function waterline(island, a) {
  let o = 150;
  while (island.sample(...island.fromCove(a, o)).coast < 0) o -= 0.25;
  return island.fromCove(a, o);
}

test('the cove faces the setting sun, which goes down over open sea beyond the reef', () => {
  const sun = sunset();
  for (const seed of SEEDS) {
    const island = make(seed);
    const origin = island.sample(0, 0);
    assert.ok(Math.abs(origin.coast) < 3, `seed ${seed}: the beach's middle is ${origin.coast.toFixed(1)} m from the waterline`);
    // The way the bay faces: square to its waterline 60 m either side of the middle.
    const [p, q] = [waterline(island, -60), waterline(island, 60)];
    const along = [q[0] - p[0], q[1] - p[1]];
    const facing = Math.abs(along[1] * sun[0] - along[0] * sun[1]) / Math.hypot(...along);
    const off = (Math.acos(Math.min(1, facing)) * 180) / Math.PI;
    assert.ok(off < 4, `seed ${seed}: the bay faces ${off.toFixed(1)}° away from the setting sun`);
    let crest = false;
    for (let t = 10; t <= 3000; t += 2) {
      const h = island.height(sun[0] * t, sun[1] * t);
      assert.ok(h < 0, `seed ${seed}: land ${t} m out towards the setting sun`);
      if (t >= 200 && t <= 300 && h > -1) crest = true;
    }
    assert.ok(crest, `seed ${seed}: no reef crest 200–300 m out from the beach (PLAN.md, Decisions)`);
  }
});

test('the reef stays under water, and a pass runs through it', () => {
  const { minDepth, reef } = settings.seabed;
  for (const seed of SEEDS) {
    const island = make(seed);
    for (const [x, z] of grid(island, 23)) {
      const s = island.sample(x, z);
      if (s.coast < -25) assert.ok(s.height <= -minDepth + 1e-9, `seed ${seed}: ${s.height.toFixed(2)} m, ${-s.coast.toFixed(0)} m out at ${x.toFixed(0)}, ${z.toFixed(0)}`);
    }
    // Along the crest across the cove.
    const crest = [];
    for (let a = -250; a <= 150; a += 2) crest.push(island.height(...island.fromCove(a, reef.cove.out - (a * a) / (2 * reef.cove.radius))));
    const shallow = crest.filter((h) => h > -1).length / crest.length;
    assert.ok(shallow > 0.7, `seed ${seed}: only ${(100 * shallow).toFixed(0)}% of the crest is near the surface`);
    assert.ok(Math.min(...crest) < -5, `seed ${seed}: no pass through the reef (deepest ${Math.min(...crest).toFixed(1)} m)`);
  }
});

test('sea zones lie where the reef puts them: lagoon inside its crest, ocean outside, reef along it', () => {
  const { zones, seabed } = settings;
  for (const seed of SEEDS) {
    const island = make(seed);
    const seen = new Set();
    for (const [x, z] of grid(island, 29)) {
      const s = island.sample(x, z);
      if (s.coast >= 0) continue;
      const zone = island.zoneOf(s, 0);
      seen.add(zone);
      if (zone === 'lagoon') assert.ok(s.reef < 0, `seed ${seed}: lagoon ${s.reef.toFixed(0)} m beyond the crest at ${x.toFixed(0)}, ${z.toFixed(0)}`);
      if (zone === 'ocean') assert.ok(s.reef >= 0, `seed ${seed}: ocean ${-s.reef.toFixed(0)} m inside the crest at ${x.toFixed(0)}, ${z.toFixed(0)}`);
      if (zone === 'reef') assert.ok(s.reef >= -zones.reefBack && s.reef < zones.reefFore, `seed ${seed}: reef ${s.reef.toFixed(0)} m from the crest`);
    }
    assert.deepEqual([...seen].sort(), [...SEA_ZONES].sort(), `seed ${seed}: sea zones`);
    // Across the cove the crest is reef, but for the pass.
    const { out, radius } = seabed.reef.cove;
    let reef = 0;
    let all = 0;
    for (let a = -250; a <= 150; a += 2) {
      const [x, z] = island.fromCove(a, out - (a * a) / (2 * radius));
      all++;
      if (island.zone(x, z) === 'reef') reef++;
    }
    assert.ok(reef / all > 0.7, `seed ${seed}: only ${((100 * reef) / all).toFixed(0)}% of the cove's crest is reef`);
  }
});

test('the seabed: the lagoon floor lies at its depth, the channel runs deeper than the floor beside it, and the reef drops off', () => {
  const { lagoon, channel, reef } = settings.seabed;
  for (const seed of SEEDS) {
    const island = make(seed);
    const out = {};
    // The bay's lagoon, away from the beach, the channel and the reef.
    const floor = [];
    for (let a = 20; a <= 150; a += 7) {
      for (let o = 60; o <= 170; o += 7) {
        const s = island.evaluate(a, o, out);
        if (-s.coast > 60 && s.reef < -60) floor.push(-s.height);
      }
    }
    floor.sort((p, q) => p - q);
    const median = floor[floor.length >> 1];
    assert.ok(floor.length > 50 && Math.abs(median - lagoon.depth) <= lagoon.swing, `seed ${seed}: the lagoon floor lies ${median?.toFixed(1)} m deep, set to ${lagoon.depth} ± ${lagoon.swing}`);
    // Along the channel: its deepest across ±15 m (its walls wander) against the floor 45 m either side.
    let deeper = 0;
    let n = 0;
    for (let k = 0; k + 1 < channel.path.length; k++) {
      const [[a0, o0], [a1, o1]] = [channel.path[k], channel.path[k + 1]];
      const length = Math.hypot(a1 - a0, o1 - o0);
      const [na, no] = [-(o1 - o0) / length, (a1 - a0) / length];
      for (let t = 0.1; t < 1; t += 0.2) {
        const [a, o] = [a0 + (a1 - a0) * t, o0 + (o1 - o0) * t];
        let bottom = Infinity;
        for (let d = -15; d <= 15; d++) bottom = Math.min(bottom, island.evaluate(a + na * d, o + no * d, out).height);
        const beside = Math.min(island.evaluate(a + na * 45, o + no * 45, out).height, island.evaluate(a - na * 45, o - no * 45, out).height);
        deeper += beside - bottom;
        n++;
      }
    }
    assert.ok(deeper / n > 0.75, `seed ${seed}: the channel runs only ${(deeper / n).toFixed(2)} m deeper than the floor beside it`);
    // Seaward of the crest, all round the island, the water gets deep fast,
    // but where a headland reaches out to the reef, the seabed rises to its shore.
    let checked = 0;
    for (const [x, z] of grid(island, 23)) {
      const s = island.sample(x, z);
      if (s.coast < -60 && s.reef > reef.fore.dropWidth + 10 && s.reef < 2 * reef.fore.dropWidth + 10) {
        checked++;
        assert.ok(s.height < -15, `seed ${seed}: only ${-s.height.toFixed(1)} m deep ${s.reef.toFixed(0)} m beyond the crest at ${x.toFixed(0)}, ${z.toFixed(0)}`);
      }
    }
    assert.ok(checked > 100, `seed ${seed}: only ${checked} points beyond the crest`);
  }
});

test('zones run in order from the shore, land zones on land and sea zones at sea', () => {
  for (const seed of SEEDS) {
    const island = make(seed);
    let walked = 0;
    for (const [x, z] of grid(island, 41)) {
      const s = island.sample(x, z);
      const zone = island.zoneOf(s, island.slope(x, z));
      assert.ok(ZONES.includes(zone), `seed ${seed}: unknown zone ${zone}`);
      if (s.height < 0) assert.ok(SEA_ZONES.includes(zone), `seed ${seed}: ${zone} under water`);
      else assert.ok(!SEA_ZONES.includes(zone), `seed ${seed}: ${zone} on land`);
      // From points near the shore, walk inland: the zones never step back towards
      // the sea. The walk ends where the shore stops falling behind, on the spine
      // of a headland or in the middle of the island.
      if (s.coast > 0 && s.coast < 41) {
        walked++;
        let [px, pz] = [x, z];
        let last = -1;
        let behind = -Infinity;
        for (let i = 0; i < 50; i++) {
          const p = island.sample(px, pz);
          if (p.coast < behind + 0.75) break;
          behind = p.coast;
          const index = LAND_ZONES.indexOf(island.zoneOf(p, island.slope(px, pz)));
          if (index >= 0) {
            assert.ok(index >= last, `seed ${seed}: ${LAND_ZONES[index]} after ${LAND_ZONES[last]} walking inland from ${x.toFixed(0)}, ${z.toFixed(0)}`);
            last = index;
          }
          const [gx, gz] = inland(island, px, pz);
          px += 3 * gx;
          pz += 3 * gz;
        }
      }
    }
    assert.ok(walked > 20, `seed ${seed}: only ${walked} walks inland`);
  }
});

test('the cove has a gentle sand beach', () => {
  for (const seed of SEEDS) {
    const island = make(seed);
    for (let a = -80; a <= 80; a += 20) {
      // Find the waterline coming in from the bay, then walk up the beach.
      let o = 120;
      while (island.sample(...island.fromCove(a, o)).coast < 0) o -= 0.25;
      const at = (metres) => {
        const [x, z] = island.fromCove(a, o);
        const [gx, gz] = inland(island, x, z);
        return [x + metres * gx, z + metres * gz];
      };
      assert.equal(island.zone(...at(3)), 'wet-sand', `seed ${seed}: the beach at ${a} m along`);
      assert.equal(island.zone(...at(20)), 'dry-sand', `seed ${seed}: the beach at ${a} m along`);
      const rise = island.height(...at(15)) - island.height(...at(0));
      assert.ok(rise / 15 > 1 / 20 && rise / 15 < 1 / 5, `seed ${seed}: the beach at ${a} m along rises 1 in ${(15 / rise).toFixed(1)}`);
    }
  }
});

test('resizing the island leaves the cove as it is', () => {
  const { radius } = settings.cove;
  for (const seed of SEEDS) {
    const base = make(seed);
    for (const size of [settings.minSize, 3000, 4500]) {
      const resized = make(seed, { size });
      for (let x = -radius; x <= radius; x += 13) {
        for (let z = -radius; z <= radius; z += 13) {
          if (Math.hypot(x, z) > radius) continue;
          assert.equal(resized.height(x, z), base.height(x, z), `seed ${seed}, size ${size}: at ${x}, ${z}`);
        }
      }
      assert.notDeepEqual(resized.bounds, base.bounds, `seed ${seed}: size ${size} left the island's bounds as they were`);
    }
  }
});

test('the seed changes the island, and the headland can sit on either side', () => {
  const one = make(1);
  const two = make(2);
  assert.ok(grid(one, 97).some(([x, z]) => one.height(x, z) !== two.height(x, z)), 'seeds 1 and 2 make the same island');
  const mirrored = make(1, { cove: { ...settings.cove, headlandSide: -settings.cove.headlandSide } });
  for (const [x, z] of grid(one, 89)) {
    const [a, o] = one.toCove(x, z);
    const h = one.height(x, z);
    assert.ok(Math.abs(mirrored.height(...mirrored.fromCove(a, o)) - h) < 1e-6 * (1 + Math.abs(h)), `mirrored at ${x}, ${z}`);
  }
  // Mirrored, the headland is on the other side of someone on the beach facing the sea.
  const right = one.right;
  const side = (island) => Math.sign(island.height(right[0] * 230, right[1] * 230 + 0) - island.height(-right[0] * 230, -right[1] * 230));
  assert.equal(side(mirrored), -side(one));
});
