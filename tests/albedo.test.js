// The ground's albedo from above (world/albedo.js), which lights shade from
// below: the sea's over water, the surfaces' as the ground has them, never
// outside what the surfaces reflect.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRandom } from '../src/core/random.js';
import { config } from '../src/config.js';
import { createIsland } from '../src/world/island.js';
import { buildHeightmap } from '../src/world/heightmap.js';
import { albedoMap, albedoOf, greenAlbedo, sandWetness } from '../src/world/albedo.js';

const { albedo, green } = config.world.terrain;
const surfaces = { albedo, green, wetness: config.world.terrain.sand.wetness, wetHeight: config.world.island.zones.wetSand, sea: config.sky.atmosphere.groundAlbedo };

test("over water the albedo is the sea's, on sand above the waves the dry sand's, below them the wet sand's", () => {
  assert.deepEqual(albedoOf(1, 0, 0, -0.5, 0, 0, surfaces), surfaces.sea);
  assert.deepEqual(albedoOf(1, 0, 0, surfaces.wetness.dry + 0.1, 0, 0, surfaces), albedo.drySand);
  assert.deepEqual(albedoOf(1, 0, 0, 0.01, 0, 0, surfaces), albedo.wetSand);
  assert.deepEqual(albedoOf(0, 1, 2, 30, 0, 0, surfaces), albedo.rock);
  assert.deepEqual(albedoOf(0, 0, 3, 30, 0.6, 0.2, surfaces), greenAlbedo(3, 0.6, 0.2, surfaces));
});

test('the green is its living green where all of it is green, grass on open ground and the leafy understory on lush; its bare ground where none is, sand, soil or litter as its shares say', () => {
  const near = (a, b) => a.every((v, c) => Math.abs(v - b[c]) < 1e-12);
  const all = (v) => [v, v, v];
  const covered = { ...surfaces, green: { ...green, cover: { open: all(1), lush: all(1) }, litter: [0, 0.5, 1] } };
  const bare = { ...surfaces, green: { ...green, cover: { open: all(0), lush: all(0) }, litter: [0, 0, 1] } };
  assert.ok(near(greenAlbedo(1.5, 0, 0.5, covered), albedo.grass), 'open ground, all green');
  assert.ok(near(greenAlbedo(1.5, 1, 0.5, covered), albedo.leafy), 'lush ground, all green');
  assert.ok(near(greenAlbedo(0, 0.5, 1, bare), albedo.drySand), 'behind a beach, all bare');
  assert.ok(near(greenAlbedo(1.5, 0.5, 0, bare), albedo.soil), 'the palm belt, all bare');
  assert.ok(near(greenAlbedo(3, 0.5, 0.5, bare), albedo.litter), 'the jungle, all bare');
});

test('any mix of the ground reflects no more and no less than its surfaces do', () => {
  const all = [...Object.values(albedo), surfaces.sea];
  const r = createRandom(1)('test/albedo');
  for (let n = 0; n < 10_000; n++) {
    const sand = r.range(0, 1);
    const rgb = albedoOf(sand, r.range(0, 1 - sand), r.range(-1, 4), r.range(-5, 50), r.range(0, 1), r.range(0, 1), surfaces);
    rgb.forEach((v, c) => {
      const values = all.map((a) => a[c]);
      assert.ok(v >= Math.min(...values) - 1e-12 && v <= Math.max(...values) + 1e-12, `channel ${c}: ${v}`);
    });
  }
});

test("the map over a grid: the sea's albedo under water, sand on the cove's beach, green behind it", () => {
  const layout = { samples: 96, blend: 4, levels: [8, 16, 32, 64].map((texel) => ({ texel, centre: [0, -300] })) };
  const island = createIsland(createRandom(1));
  const heightmap = buildHeightmap(island, layout);
  const level = heightmap.levels[0];
  const map = albedoMap(level, surfaces);
  const at = (a, o) => {
    const i = Math.round((a - level.origin[0]) / level.texel);
    const j = Math.round((o - level.origin[1]) / level.texel);
    const n = j * layout.samples + i;
    return { rgb: Array.from(map.slice(4 * n, 4 * n + 3)), height: level.heights[n] };
  };
  for (let n = 0; n < layout.samples * layout.samples; n++) {
    if (level.heights[n] < 0) assert.deepEqual(Array.from(map.slice(4 * n, 4 * n + 3)), surfaces.sea.map(Math.fround));
    assert.equal(map[4 * n + 3], 1);
  }
  // The beach's middle, 16 m up from the water, is dry sand; 120 m behind it green.
  const beach = at(0, -16);
  assert.ok(beach.height > surfaces.wetHeight + 0.2, `the beach is ${beach.height} m up`);
  beach.rgb.forEach((v, c) => assert.ok(Math.abs(v - albedo.drySand[c]) < 0.02, `beach channel ${c}: ${v}`));
  const behind = at(0, -120);
  assert.ok(behind.rgb[1] > behind.rgb[0] && behind.rgb[1] > behind.rgb[2], `120 m behind the beach: ${behind.rgb}`);
});

test("sand is wettest at the water, half wet at the wet sand zone's edge, dry above, and never wetter higher up", () => {
  const { wetness } = surfaces;
  assert.equal(sandWetness(0, wetness, surfaces.wetHeight), 1);
  assert.equal(sandWetness(wetness.film, wetness, surfaces.wetHeight), 1);
  assert.equal(sandWetness(wetness.dry, wetness, surfaces.wetHeight), 0);
  // chunks/sand.glsl darkens sand by smoothstep(0.2, 0.5, wetness): half dark where the wet sand's zone ends.
  assert.ok(Math.abs(sandWetness(surfaces.wetHeight, wetness, surfaces.wetHeight) - 0.35) < 1e-12);
  let last = Infinity;
  for (let h = 0; h <= 2; h += 0.01) {
    const w = sandWetness(h, wetness, surfaces.wetHeight);
    assert.ok(w <= last + 1e-12 && w >= 0 && w <= 1, `${w} at ${h.toFixed(2)} m`);
    last = w;
  }
});
