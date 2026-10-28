// The ground's albedo from above (world/albedo.js), which lights shade from
// below: the sea's over water, the surfaces' as the ground has them, never
// outside what the surfaces reflect, read from each sample as world/heightmap.js
// lays its grids out. Expected values come from the surfaces' albedos where
// they can, not from albedo.js's own functions. On the GPU, the terrain
// fixture checks that the light from below reads this map where JS expects.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRandom } from '../src/core/random.js';
import { config } from '../src/config.js';
import { createIsland } from '../src/world/island.js';
import { buildHeightmap, GROUND } from '../src/world/heightmap.js';
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

test('how much of the green is living green follows how lush it is, and its bare ground how sandy the soil', () => {
  const near = (a, b) => a.every((v, c) => Math.abs(v - b[c]) < 1e-12);
  // Open ground all bare, lush ground all living green, no litter.
  const byLush = { ...surfaces, green: { ...green, cover: { open: [0, 0, 0], lush: [1, 1, 1] }, litter: [0, 0, 0] } };
  assert.ok(near(greenAlbedo(1.5, 1, 0, byLush), albedo.leafy), 'lush: the leafy understory');
  assert.ok(near(greenAlbedo(1.5, 0, 1, byLush), albedo.drySand), 'open, behind a beach: bare sand');
  assert.ok(near(greenAlbedo(1.5, 0, 0, byLush), albedo.soil), 'open: bare soil');
  const half = albedo.leafy.map((v, c) => (v + albedo.grass[c]) / 4 + albedo.soil[c] / 2);
  assert.ok(near(greenAlbedo(1.5, 0.5, 0, byLush), half), 'half lush: half its green living, of grass and understory alike');
});

test("the green's shares blend between bands as the zones do: the scrub's to a band of 0.5, the palm belt's at 1.5, the jungle's from 2.33, halfway at 1 and 2", () => {
  const shares = [0.2, 0.5, 0.9]; // scrub, palm belt, jungle
  const bands = { '-1': 0.2, 0.5: 0.2, 1: 0.35, 1.5: 0.5, 1.67: 0.5, 2: 0.7, 2.33: 0.9, 4: 0.9 };
  // Living grass over bare soil by the cover's shares; litter over soil by the litter's.
  const covered = { ...surfaces, green: { ...green, cover: { open: shares, lush: shares }, litter: [0, 0, 0] } };
  const littered = { ...surfaces, green: { ...green, cover: { open: [0, 0, 0], lush: [0, 0, 0] }, litter: shares } };
  const share = (rgb, over) => (rgb[0] - albedo.soil[0]) / (over[0] - albedo.soil[0]);
  for (const [band, want] of Object.entries(bands)) {
    const cover = share(greenAlbedo(Number(band), 0, 0, covered), albedo.grass);
    const litter = share(greenAlbedo(Number(band), 0, 0, littered), albedo.litter);
    assert.ok(Math.abs(cover - want) < 1e-9 && Math.abs(litter - want) < 1e-9, `band ${band}: cover ${cover.toFixed(3)}, litter ${litter.toFixed(3)}, not ${want}`);
  }
});

test("sand's albedo is wet sand's under a film of water, most of the way to it where wet, a third to half way where damp below the waves' reach (the wet sand's zone), a little darker than dry sand's just above it, dry sand's from `dry`, as chunks/sand.wgsl darkens it", () => {
  const { film, dry } = surfaces.wetness;
  const reach = surfaces.wetHeight;
  const near = (a, b) => a.every((v, c) => Math.abs(v - b[c]) < 1e-12);
  // How far towards wet sand's albedo, by its green channel.
  const dark = (h) => (albedo.drySand[1] - albedoOf(1, 0, 0, h, 0, 0, surfaces)[1]) / (albedo.drySand[1] - albedo.wetSand[1]);
  const wet = film + 0.6 * (reach - film);
  assert.ok(dark(wet) > 0.7 && dark(wet) < 0.9, `wet: ${dark(wet)}`);
  assert.ok(dark(reach - 0.01) > 0.3 && dark(reach - 0.01) < 0.6, `just below the reach: ${dark(reach - 0.01)}`);
  assert.ok(dark(reach + 0.02) > 0 && dark(reach + 0.02) < 0.1, `just above the reach: ${dark(reach + 0.02)}`);
  assert.ok(near(albedoOf(1, 0, 0, film, 0, 0, surfaces), albedo.wetSand), 'under a film');
  assert.ok(near(albedoOf(1, 0, 0, dry, 0, 0, surfaces), albedo.drySand), 'dry');
  // In between, never darker higher up.
  let last = albedo.wetSand;
  for (let h = film; h <= dry; h += 0.01) {
    const rgb = albedoOf(1, 0, 0, h, 0, 0, surfaces);
    assert.ok(rgb.every((v, c) => v >= last[c] - 1e-12), `${h.toFixed(2)} m`);
    last = rgb;
  }
});

test("the map reads each sample as the grid lays it out: sand, rock, lush and sandy in bytes of 255, the band in info's third value, the height", () => {
  // The green shows each input plainly: bare in the scrub and the palm belt,
  // all living green in the jungle, lush or not, and no litter.
  const plain = { ...surfaces, green: { ...green, cover: { open: [0, 0, 1], lush: [0, 0, 1] }, litter: [0, 0, 0] } };
  const mix = (...parts) => [0, 1, 2].map((c) => parts.reduce((sum, [share, rgb]) => sum + share * rgb[c], 0));
  // Per sample: its ground's bytes (sand, rock, lush, sandy), band and height, and its albedo.
  const cases = [
    [[255, 0, 0, 0], 0, 10, albedo.drySand],
    [[255, 0, 0, 0], 0, 0.1, albedo.wetSand],
    [[0, 255, 0, 0], 3, 10, albedo.rock],
    [[0, 0, 255, 0], 3, 10, albedo.leafy], // the jungle: living green, lush
    [[0, 0, 0, 255], 3, 10, albedo.grass], // open
    [[0, 0, 255, 0], 0, 10, albedo.soil], // the scrub: bare soil
    [[0, 0, 0, 255], 0, 10, albedo.drySand], // behind a beach: bare sand
    [[255, 0, 255, 255], 3, -2, surfaces.sea],
    [[51, 102, 255, 0], 3, 10, mix([0.2, albedo.drySand], [0.4, albedo.rock], [0.4, albedo.leafy])],
  ];
  const n = cases.length;
  const grid = { heights: new Float32Array(n), info: new Float32Array(4 * n), ground: new Uint8Array(GROUND * n) };
  cases.forEach(([bytes, band, height], i) => {
    grid.heights[i] = height;
    grid.info.set([7, -9, band, 200], 4 * i); // slopes and a reef's offset that would show if read as the band
    grid.ground.set(bytes, GROUND * i);
  });
  const map = albedoMap(grid, plain);
  assert.equal(map.length, 4 * n);
  cases.forEach(([bytes, band, height, want], i) => {
    const got = Array.from(map.slice(4 * i, 4 * i + 4));
    assert.ok(got.every((v, c) => Math.abs(v - (c < 3 ? want[c] : 1)) < 1e-6), `sample ${i} (${bytes}, band ${band}, ${height} m): ${got.map((v) => v.toFixed(4))}, not ${want.map((v) => v.toFixed(4))}`);
  });
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

test("sand is wettest at the water, wet and then damp up to the waves' reach (the wet sand's zone), where it steps down by `step`, dry above, and never wetter higher up", () => {
  const { wetness } = surfaces;
  assert.equal(sandWetness(0, wetness, surfaces.wetHeight), 1);
  assert.equal(sandWetness(wetness.film, wetness, surfaces.wetHeight), 1);
  assert.equal(sandWetness(wetness.dry, wetness, surfaces.wetHeight), 0);
  const below = sandWetness(surfaces.wetHeight - 0.01, wetness, surfaces.wetHeight);
  const above = sandWetness(surfaces.wetHeight + 0.01, wetness, surfaces.wetHeight);
  assert.ok(Math.abs(below - above - wetness.step) < 0.02, `${below} below the reach, ${above} above it`);
  assert.ok(above > 0.1 && above <= 0.15, `${above} above the reach`);
  let last = Infinity;
  for (let h = 0; h <= 2; h += 0.01) {
    const w = sandWetness(h, wetness, surfaces.wetHeight);
    assert.ok(w <= last + 1e-12 && w >= 0 && w <= 1, `${w} at ${h.toFixed(2)} m`);
    last = w;
  }
});
