// The ground under the terrain's nodes (world/terrain-nodes.js nodeBounds): its
// heights hold every height the grids draw over a node, and its surfaces every
// surface they draw there, from the grids the shader reads, so a node is culled
// only where nothing of it shows and drawn with a shader that has all its
// surfaces: sand, rock, the green, and the sheen of sand the sea wets. The
// grid each node draws is checked with the mesh's height (tests/lod.test.js).
import test from 'node:test';
import assert from 'node:assert/strict';
import { config } from '../src/config.js';
import { createRandom } from '../src/core/random.js';
import { sandWetness } from '../src/world/albedo.js';
import { createIsland } from '../src/world/island.js';
import { buildHeightmap, createHeightmap, GROUND } from '../src/world/heightmap.js';
import { GREEN, nodeBounds, ROCK, SAND, WET } from '../src/world/terrain-nodes.js';

const settings = config.world.terrain;
const { leaf } = settings;
const { wetness } = settings.sand;
const wetHeight = config.world.island.zones.wetSand;
const REACH = 0.35; // m: how much further up than elsewhere the waves reach, at most (chunks/wet.wgsl WET_REACH)
const SEEDS = Array.from({ length: 20 }, (_, i) => i + 1);

// Grids made by hand, read as world/heightmap.js reads them: each level
// { texel, origin, samples, fill(a, o) -> [height, sand, rock] (0 to 255) }.
function handmade(levels, blend) {
  const filled = levels.map(({ texel, origin, samples, fill }) => {
    const n = samples * samples;
    const level = { texel, origin, samples, heights: new Float32Array(n), info: new Float32Array(4 * n), ground: new Uint8Array(GROUND * n) };
    for (let j = 0; j < samples; j++) {
      for (let i = 0; i < samples; i++) {
        const [h, sand, rock] = fill(origin[0] + i * texel, origin[1] + j * texel);
        level.heights[j * samples + i] = h;
        level.ground.set([sand, rock], GROUND * (j * samples + i));
      }
    }
    return level;
  });
  return createHeightmap(null, { blend }, filled);
}

// The surfaces the ground as drawn has at a, o: SAND, ROCK and GREEN (a share worth its detail).
function surfacesAt(heightmap, a, o, out = {}) {
  const { sand, rock } = heightmap.groundAtCove(a, o, out);
  return (sand > 0 ? SAND : 0) | (rock > 0 ? ROCK : 0) | (sand + rock < 0.85 ? GREEN : 0);
}

test("sand carries the wet sheen from a metre under the sea to past where it dries, by the waves' reach", () => {
  const blend = 4;
  const bitsOf = (fill) => nodeBounds(handmade([{ texel: 8, origin: [-64, -64], samples: 17, fill }], blend), wetness.dry, blend)(-8, -8, leaf)[2];
  for (const h of [-0.9, -0.3, 0, wetHeight, wetness.dry, wetness.dry + REACH, wetness.dry + 0.4]) assert.equal(bitsOf(() => [h, 255, 0]), SAND | WET, `sand ${h} m above the sea`);
  // Deeper, the sea hides it; higher, it is dry wherever the waves reach.
  for (const h of [-1.2, -5, wetness.dry + 0.6, wetness.dry + 3]) assert.equal(bitsOf(() => [h, 255, 0]), SAND, `sand ${h} m above the sea`);
  // Some sand is sand: wet by the sea, with its sheen.
  assert.equal(bitsOf(() => [0.2, 40, 215]), SAND | WET | ROCK);
  // Rock and the green the sea wets have no sheen of sand.
  assert.equal(bitsOf(() => [0.2, 0, 255]), ROCK);
  assert.equal(bitsOf(() => [0.2, 0, 0]), GREEN);
});

test('a node takes its surfaces from the grids drawn over it: a finer one that covers it hides the coarser', () => {
  // Rock on a fine grid round the middle, dry sand on a coarse one round that.
  const blend = 4;
  const heightmap = handmade(
    [
      { texel: 2, origin: [-64, -64], samples: 64, fill: () => [5, 0, 255] },
      { texel: 8, origin: [-128, -128], samples: 33, fill: () => [5, 255, 0] },
    ],
    blend,
  );
  const bounds = nodeBounds(heightmap, wetness.dry, blend);
  const r = createRandom(1)('terrain-nodes/levels');
  for (const [a0, o0, bits, where] of [
    [0, 0, ROCK, 'well inside the fine grid'],
    [-8, 48, ROCK | SAND, "in the fine grid's blend band"],
    [64, 0, SAND, 'beyond the fine grid'],
    [-200, 300, SAND, 'beyond the coarse grid'],
  ]) {
    assert.equal(bounds(a0, o0, leaf)[2], bits, where);
    // As the ground is drawn there.
    let drawn = 0;
    for (let n = 0; n < 200; n++) drawn |= surfacesAt(heightmap, a0 + r.next() * leaf, o0 + r.next() * leaf);
    assert.equal(drawn, bits, `${where}: drawn`);
  }
});

// Round the cove, the game's grids but smaller (as tests/heightmap.test.js's):
// 2 m apart over the beach, the bay and the headland, where sand meets rock.
const cove = { samples: 256, blend: 8, levels: settings.levels.map(({ texel }) => ({ texel, centre: [55, 0] })) };

test('every height the grids draw over a node lies within its bounds, and every surface they draw is among its surfaces', () => {
  const ground = {};
  let wet = 0;
  for (const seed of SEEDS) {
    const heightmap = buildHeightmap(createIsland(createRandom(seed)), cove);
    const bounds = nodeBounds(heightmap, wetness.dry, cove.blend);
    const r = createRandom(seed)('terrain-nodes/cove');
    const { origin, texel, samples } = heightmap.levels.at(-1);
    const end = origin.map((x) => x + (samples - 1) * texel);
    // The leaves over the coarse grid, and a row beyond it.
    for (let o0 = origin[1] - leaf; o0 < end[1] + leaf; o0 += leaf) {
      for (let a0 = origin[0] - leaf; a0 < end[0] + leaf; a0 += leaf) {
        const [min, max, surfaces] = bounds(a0, o0, leaf);
        const at = `seed ${seed}, the leaf at ${a0}, ${o0}`;
        for (let n = 0; n < 8; n++) {
          const [a, o] = [a0 + r.next() * leaf, o0 + r.next() * leaf];
          // The mesh draws a grid's heights, or a mix of two, flat between its vertices.
          for (let k = 0; k < heightmap.levels.length; k++) {
            const h = heightmap.heightAtCove(a, o, k);
            if (!(h >= min && h <= max)) assert.fail(`${at}: ${h} m on grid ${k} at ${a}, ${o}, outside ${min} to ${max}`);
          }
          const drawn = surfacesAt(heightmap, a, o, ground);
          if (drawn & ~surfaces) assert.fail(`${at}: surfaces ${drawn} drawn at ${a}, ${o}, the leaf has ${surfaces}`);
          // Wet sand, a quarter of the ground and more, above the sea: a sliver of
          // sand between rock samples may lie lower than any sand sample.
          const h = heightmap.heightAtCove(a, o);
          if (ground.sand >= 0.25 && h >= 0 && sandWetness(h - REACH, wetness, wetHeight) > 0) {
            if (!(surfaces & WET)) assert.fail(`${at}: wet sand ${h} m above the sea at ${a}, ${o}, the leaf has no WET`);
            wet++;
          }
        }
      }
    }
  }
  assert.ok(wet > 1000, `only ${wet} points of wet sand tried`);
});
