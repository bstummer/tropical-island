// Where the rocks lie (world/rock-placement.js, world/scatter.js): only where
// their kind's ground allows them, sunk into the ground all round so none
// floats, never wholly buried, the same for the same seed, and no view starts
// inside one.
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
import { allows, groundSample } from '../src/world/scatter.js';

const SEEDS = Array.from({ length: 20 }, (_, i) => i + 1);
const settings = config.world.rocks;

// Round the cove's beach and headland, laid out as the game's grids but
// smaller, quick to build for every seed.
const cove = { samples: 192, blend: 8, levels: [1, 2, 4, 8].map((texel) => ({ texel, centre: [100, 0] })) };
const region = { a: [-150, 300], o: [-150, 200] };

function layout(seed, grids = cove, where = region, rocks = settings) {
  const random = createRandom(seed);
  const island = createIsland(random);
  const heightmap = buildHeightmap(island, grids);
  const shapes = makeRockShapes(random('rocks/shapes'), rocks.shapes);
  const placed = placeRocks(heightmap, island, shapes, rocks, where, (kind) => random(`rocks/${kind}`).int(0, 0x7fffffff));
  return { island, heightmap, shapes, placed };
}

// Points of a rock's prototype (xyz in a flat array) in the world.
function inWorld(rock, points) {
  const q = new Quaternion().fromArray(rock.rotation);
  const v = new Vector3();
  const out = [];
  for (let i = 0; i < points.length; i += 3) {
    v.set(points[i] * rock.scale[0], points[i + 1] * rock.scale[1], points[i + 2] * rock.scale[2]).applyQuaternion(q);
    out.push([rock.position[0] + v.x, rock.position[1] + v.y, rock.position[2] + v.z]);
  }
  return out;
}

const layouts = new Map();
const layoutFor = (seed) => {
  if (!layouts.has(seed)) layouts.set(seed, layout(seed));
  return layouts.get(seed);
};

test('rocks lie only where their kind allows, sunk into the ground all round, never wholly buried', () => {
  const kinds = new Set();
  for (const seed of SEEDS) {
    const { island, heightmap, shapes, placed } = layoutFor(seed);
    assert.ok(placed.length > 100, `seed ${seed}: only ${placed.length} rocks`);
    const ground = {};
    for (const rock of placed) {
      kinds.add(rock.kind);
      const [x, , z] = rock.position;
      const [a, o] = island.toCove(x, z);
      const rule = settings.kinds[rock.kind];
      assert.ok(allows(rule.where, groundSample(heightmap, a, o, ground)), `seed ${seed}: a ${rock.kind} rock at ${a.toFixed(1)}, ${o.toFixed(1)} where its ground doesn't allow one`);
      const shape = shapes[rock.shape];
      const points = inWorld(rock, shape.positions);
      // Its base lies under the ground all round, so it sits in the ground,
      // never on it with a gap below (a face that overhangs a slope is no gap).
      for (const [px, py, pz] of inWorld(rock, shape.lower)) {
        const h = heightmap.heightAt(px, pz);
        assert.ok(py <= h + 1e-6, `seed ${seed}: a ${rock.kind} rock's base is ${(py - h).toFixed(3)} m over the ground at ${px.toFixed(1)}, ${pz.toFixed(1)}`);
      }
      // And some of it shows.
      const span = rock.scale[1] * shape.height;
      assert.ok(points.some(([px, py, pz]) => py > heightmap.heightAt(px, pz) + 0.1 * span), `seed ${seed}: a ${rock.kind} rock lies all but buried`);
      // Its sphere holds it, and its spread across the ground.
      for (const p of points) {
        assert.ok(Math.hypot(p[0] - rock.centre[0], p[1] - rock.centre[1], p[2] - rock.centre[2]) <= rock.radius + 1e-6);
        assert.ok(Math.hypot(p[0] - x, p[2] - z) <= rock.spread + 1e-6);
      }
    }
  }
  assert.deepEqual([...kinds].sort(), Object.keys(settings.kinds).sort(), 'every kind places rocks on some seed');
});

test('the same seed lays the rocks out the same, and a kind stays put when another changes', () => {
  const a = layout(3).placed;
  assert.deepEqual(layout(3).placed, a);
  // The first kind: the others come after it.
  const first = Object.keys(settings.kinds)[0];
  const fewer = { ...settings, kinds: { ...settings.kinds, [first]: { ...settings.kinds[first], chance: settings.kinds[first].chance / 2 } } };
  const b = layout(3, cove, region, fewer).placed;
  const without = (rocks) => rocks.filter((r) => r.kind !== first);
  assert.deepEqual(without(b), without(a));
  assert.ok(b.length < a.length);
});

test('no view starts inside a rock', () => {
  const seed = config.defaults.seed;
  const random = createRandom(seed);
  const island = createIsland(random);
  const heightmap = buildHeightmap(island, config.world.terrain);
  const shapes = makeRockShapes(random('rocks/shapes'), settings.shapes);
  const { reach } = settings;
  const placed = placeRocks(heightmap, island, shapes, settings, { a: [-reach, reach], o: [-reach, reach], radius: reach }, (kind) => random(`rocks/${kind}`).int(0, 0x7fffffff));
  for (const view of views) {
    for (const rock of placed) {
      const d = Math.hypot(view.position[0] - rock.centre[0], view.position[1] - rock.centre[1], view.position[2] - rock.centre[2]);
      assert.ok(d > rock.radius + config.camera.near, `view "${view.name}" starts inside a ${rock.kind} rock ${d.toFixed(2)} m from its centre`);
    }
  }
});
