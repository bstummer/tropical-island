// Where the rocks lie (world/rock-placement.js, world/scatter.js): only where
// their kind's ground allows them, sunk into the ground with no gap under
// them, never wholly buried, never through each other, the same for the same
// seed, and no view starts inside one. Each property is worked out here from
// the rocks' triangles and the ground, not with the placer's own code.
import test from 'node:test';
import assert from 'node:assert/strict';
import { Quaternion, Vector3 } from 'three';
import { config } from '../src/config.js';
import { views } from '../src/views.js';
import { createRandom } from '../src/core/random.js';
import { createIsland } from '../src/world/island.js';
import { buildHeightmap } from '../src/world/heightmap.js';
import { makeRockShapes } from '../src/world/rock-shapes.js';
import { placeRocks } from '../src/world/rock-placement.js';
import { createClearance } from '../src/world/scatter.js';

const SEEDS = Array.from({ length: 20 }, (_, i) => i + 1);
const settings = config.world.rocks;
const DEG = Math.PI / 180;

// Round the cove's beach and headland, laid out as the game's grids but
// smaller, quick to build for every seed.
const cove = { samples: 192, blend: 8, levels: [1, 2, 4, 8].map((texel) => ({ texel, centre: [100, 0] })) };
const region = { a: [-150, 300], o: [-150, 200] };

function layout(seed, grids = cove, where = region, rocks = settings) {
  const random = createRandom(seed);
  const island = createIsland(random);
  const heightmap = buildHeightmap(island, grids);
  const shapes = makeRockShapes(random('rocks/shapes'), rocks.shapes);
  const placed = placeRocks(heightmap, island, shapes, rocks, where, (kind) => random(`rocks/${kind}`).int(0, 0x7fffffff), createClearance());
  return { island, heightmap, shapes, placed };
}

const layouts = new Map();
const layoutFor = (seed) => {
  if (!layouts.has(seed)) layouts.set(seed, layout(seed));
  return layouts.get(seed);
};

const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const unit = (a) => a.map((x) => x / Math.hypot(...a));

// A rock as placed: its corners and its triangles in the world, each with its
// outward normal and its plane's offset.
function solid(rock, shape) {
  const q = new Quaternion().fromArray(rock.rotation);
  const v = new Vector3();
  const { positions, index } = shape;
  const corners = [];
  for (let i = 0; i < positions.length; i += 3) {
    v.set(positions[i] * rock.scale[0], positions[i + 1] * rock.scale[1], positions[i + 2] * rock.scale[2]).applyQuaternion(q);
    corners.push([rock.position[0] + v.x, rock.position[1] + v.y, rock.position[2] + v.z]);
  }
  const triangles = [];
  for (let t = 0; t < index.length; t += 3) {
    const p = [corners[index[t]], corners[index[t + 1]], corners[index[t + 2]]];
    const n = unit(cross(sub(p[1], p[0]), sub(p[2], p[0])));
    triangles.push({ p, n, d: dot(n, p[0]) });
  }
  return { corners, triangles, height: shape.height * rock.scale[1] };
}

// Points `step` m apart or closer across a triangle.
function* across([a, b, c], step) {
  const m = Math.max(1, Math.ceil(Math.max(Math.hypot(...sub(b, a)), Math.hypot(...sub(c, a)), Math.hypot(...sub(c, b))) / step));
  for (let i = 0; i <= m; i++) {
    for (let j = 0; i + j <= m; j++) yield [0, 1, 2].map((k) => a[k] + ((b[k] - a[k]) * i) / m + ((c[k] - a[k]) * j) / m);
  }
}

test('rocks lie only where their kind allows', () => {
  const kinds = new Set();
  for (const seed of SEEDS) {
    const { island, heightmap, placed } = layoutFor(seed);
    assert.ok(placed.length > 100, `seed ${seed}: only ${placed.length} rocks`);
    const ground = {};
    for (const rock of placed) {
      kinds.add(rock.kind);
      const [a, o] = island.toCove(rock.position[0], rock.position[2]);
      heightmap.groundAtCove(a, o, ground);
      const h = heightmap.heightAtCove;
      ground.height = h(a, o);
      ground.slope = Math.atan(Math.hypot(h(a + 0.5, o) - h(a - 0.5, o), h(a, o + 0.5) - h(a, o - 0.5))) / DEG;
      ground.coast = island.evaluate(a, o, {}).coast;
      for (const [field, [min, max]] of Object.entries(settings.kinds[rock.kind].where)) {
        assert.ok(ground[field] >= min && ground[field] <= max, `seed ${seed}: a ${rock.kind} rock at ${a.toFixed(1)}, ${o.toFixed(1)} where the ground's ${field} is ${ground[field].toFixed(2)}, not within [${min}, ${max}]`);
      }
    }
  }
  assert.deepEqual([...kinds].sort(), Object.keys(settings.kinds).sort(), 'every kind places rocks on some seed');
});

// Off a rocky shore the seabed falls below where rocks lie within a few
// metres, but the reef's crest rises as near the water hundreds of metres
// out, and coral heads in the lagoon: no rock lies out there.
test('rocks keep to the shore: none out on the reef or in the lagoon', () => {
  for (const seed of SEEDS) {
    const { island, placed } = layoutFor(seed);
    const out = {};
    for (const rock of placed) {
      const [a, o] = island.toCove(rock.position[0], rock.position[2]);
      const { coast, reef } = island.evaluate(a, o, out);
      assert.ok(coast > -10, `seed ${seed}: a ${rock.kind} rock ${(-coast).toFixed(0)} m out to sea at ${a.toFixed(0)}, ${o.toFixed(0)}, ${reef.toFixed(0)} m from the reef's crest`);
    }
  }
});

// Its underside, every facet that leans out over the ground at its place
// further than config.world.rocks.overhang past square to it, lies under the
// ground all over: no gap under it to see into. And at least its kind's sink
// share of its height under, within 2 cm: rough ground bends between where
// placement tries it. Sampled every 5 cm, with a degree's leeway on which
// facets count.
test('rocks sit in the ground: their underside lies sunk under it all over', () => {
  const into = -Math.sin((settings.overhang + 1) * DEG);
  for (const seed of SEEDS) {
    const { heightmap, shapes, placed } = layoutFor(seed);
    const h = heightmap.heightAt;
    let gaps = 0;
    let shallow = 0;
    let worst = '';
    for (const rock of placed) {
      const { triangles, height } = solid(rock, shapes[rock.shape]);
      const [x, , z] = rock.position;
      const normal = unit([h(x - 0.5, z) - h(x + 0.5, z), 1, h(x, z - 0.5) - h(x, z + 0.5)]);
      const sink = settings.kinds[rock.kind].sink * height;
      let least = Infinity;
      for (const { p, n } of triangles) {
        if (dot(n, normal) >= into) continue;
        for (const [px, py, pz] of across(p, 0.05)) least = Math.min(least, h(px, pz) - py);
      }
      if (least <= 0) {
        gaps++;
        worst = `a ${rock.kind} rock at ${x.toFixed(1)}, ${z.toFixed(1)} stands ${(-least).toFixed(3)} m over the ground at its underside`;
      } else if (least < sink - 0.02) {
        shallow++;
        worst ||= `a ${rock.kind} rock at ${x.toFixed(1)}, ${z.toFixed(1)} has its underside only ${least.toFixed(3)} m under, its sink ${sink.toFixed(3)} m`;
      }
    }
    assert.ok(gaps + shallow === 0, `seed ${seed}: ${gaps} of ${placed.length} rocks with a gap under them, ${shallow} sunk too little; ${worst}`);
  }
});

test('rocks are never wholly buried, and their numbers hold what they are', () => {
  for (const seed of SEEDS) {
    const { heightmap, shapes, placed } = layoutFor(seed);
    const h = heightmap.heightAt;
    for (const rock of placed) {
      const { corners, height } = solid(rock, shapes[rock.shape]);
      const [x, y, z] = rock.position;
      const shows = Math.max(...corners.map(([px, py, pz]) => py - h(px, pz)));
      assert.ok(shows >= settings.show * height - 1e-6, `seed ${seed}: a ${rock.kind} rock stands only ${shows.toFixed(3)} m out of the ground`);
      assert.ok(Math.abs(rock.shows - shows) < 1e-6, `seed ${seed}: a rock says it shows ${rock.shows}, but shows ${shows}`);
      assert.ok(Math.abs(rock.top - Math.max(...corners.map((p) => p[1] - y))) < 1e-6);
      assert.ok(Math.abs(rock.height - height) < 1e-9);
      // Its sphere holds it, and its spread across the ground.
      for (const p of corners) {
        assert.ok(Math.hypot(p[0] - rock.centre[0], p[1] - rock.centre[1], p[2] - rock.centre[2]) <= rock.radius + 1e-6);
        assert.ok(Math.hypot(p[0] - x, p[2] - z) <= rock.spread + 1e-6);
      }
    }
  }
});

// Separating axes between two convex solids: their faces' normals, then their
// edges' crosses. The least overlap along any of them is how deep they
// interpenetrate; 0 or less, they keep apart.
function convex({ corners, triangles }) {
  const normals = [];
  for (const { n } of triangles) if (!normals.some((m) => dot(m, n) > 1 - 1e-9)) normals.push(n);
  const edges = [];
  for (const { p } of triangles) {
    for (let k = 0; k < 3; k++) {
      const e = unit(sub(p[(k + 1) % 3], p[k]));
      if (!edges.some((f) => Math.abs(dot(e, f)) > 1 - 1e-9)) edges.push(e);
    }
  }
  return { corners, normals, edges };
}

function interpenetration(A, B) {
  const overlap = (axis) => {
    const a = A.corners.map((c) => dot(c, axis));
    const b = B.corners.map((c) => dot(c, axis));
    return Math.min(Math.max(...a) - Math.min(...b), Math.max(...b) - Math.min(...a));
  };
  let least = Infinity;
  for (const n of [...A.normals, ...B.normals]) {
    least = Math.min(least, overlap(n));
    if (least <= 0) return least;
  }
  for (const e of A.edges) {
    for (const f of B.edges) {
      const c = cross(e, f);
      if (Math.hypot(...c) < 1e-6) continue;
      least = Math.min(least, overlap(unit(c)));
      if (least <= 0) return least;
    }
  }
  return least;
}

test('no two rocks interpenetrate', () => {
  for (const seed of SEEDS) {
    const { shapes, placed } = layoutFor(seed);
    const solids = placed.map((rock) => convex(solid(rock, shapes[rock.shape])));
    for (let i = 0; i < placed.length; i++) {
      for (let j = i + 1; j < placed.length; j++) {
        const [p, q] = [placed[i], placed[j]];
        if (Math.hypot(...sub(p.centre, q.centre)) > p.radius + q.radius) continue;
        const depth = interpenetration(solids[i], solids[j]);
        assert.ok(depth < 0.01, `seed ${seed}: a ${p.kind} rock and a ${q.kind} rock interpenetrate ${depth.toFixed(3)} m at ${p.position.map((c) => c.toFixed(1)).join(', ')}`);
      }
    }
  }
});

test('the same seed lays the rocks out the same; a kind stays put when a later one changes, and is never moved by an earlier one', () => {
  const a = layout(3).placed;
  assert.deepEqual(layout(3).placed, a);
  const names = Object.keys(settings.kinds);
  const fewer = (kind) => ({ ...settings, kinds: { ...settings.kinds, [kind]: { ...settings.kinds[kind], chance: settings.kinds[kind].chance / 2 } } });
  const key = (rock) => `${rock.kind} ${rock.position.join()}`;
  // The last kind changes: every other kind's rocks stay as they were.
  const last = names.at(-1);
  const b = layout(3, cove, region, fewer(last)).placed;
  const without = (rocks, kind) => rocks.filter((r) => r.kind !== kind);
  assert.deepEqual(without(b, last), without(a, last));
  assert.ok(b.length < a.length);
  // The first changes: the later kinds' rocks that both lay out are the same,
  // and fewer rocks of the first let more of the others in than it keeps out.
  const first = names[0];
  const c = layout(3, cove, region, fewer(first)).placed;
  const before = new Map(without(a, first).map((r) => [key(r), r]));
  const after = without(c, first);
  for (const rock of after) if (before.has(key(rock))) assert.deepEqual(rock, before.get(key(rock)));
  assert.ok(after.filter((r) => before.has(key(r))).length > 0.9 * before.size, 'the first kind changed most of the others');
  assert.ok(after.length >= before.size);
});

test('no view starts inside a rock', () => {
  const seed = config.defaults.seed;
  const random = createRandom(seed);
  const island = createIsland(random);
  const heightmap = buildHeightmap(island, config.world.terrain);
  const shapes = makeRockShapes(random('rocks/shapes'), settings.shapes);
  const { reach } = settings;
  const placed = placeRocks(heightmap, island, shapes, settings, { a: [-reach, reach], o: [-reach, reach], radius: reach }, (kind) => random(`rocks/${kind}`).int(0, 0x7fffffff), createClearance());
  for (const view of views) {
    for (const rock of placed) {
      const d = Math.hypot(view.position[0] - rock.centre[0], view.position[1] - rock.centre[1], view.position[2] - rock.centre[2]);
      assert.ok(d > rock.radius + config.camera.near, `view "${view.name}" starts inside a ${rock.kind} rock ${d.toFixed(2)} m from its centre`);
    }
  }
});
