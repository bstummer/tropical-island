// How the sea looks by how deep it is (water/optics.js). Properties, not
// numbers; on the GPU, the water fixture holds water-optics.wgsl to this twin.
import test from 'node:test';
import assert from 'node:assert/strict';
import { config } from '../src/config.js';
import { cosineBelow, seabedSeen, seaAlbedo, surfaceMirror, waterLeaving } from '../src/water/optics.js';

const { water } = config;
const sun = [0.5, 0.48, 0.42];
const sky = [0.06, 0.09, 0.14];
const sand = [0.2, 0.2, 0.18]; // a seabed's radiance in air

test('under the surface a ray stands steeper than above it, never flatter than the critical angle', () => {
  const critical = Math.sqrt(1 - 1 / water.ior ** 2);
  assert.ok(Math.abs(cosineBelow(0, water.ior) - critical) < 1e-12);
  assert.ok(Math.abs(cosineBelow(1, water.ior) - 1) < 1e-12);
  for (const c of [0.01, 0.1, 0.3, 0.6, 0.9]) assert.ok(cosineBelow(c, water.ior) > c);
});

test('the surface mirrors 2% head-on and all of it at a grazing angle, more the flatter', () => {
  assert.ok(Math.abs(surfaceMirror(1) - 0.02) < 1e-12);
  assert.equal(surfaceMirror(0), 1);
  for (let c = 0; c < 1; c += 0.05) assert.ok(surfaceMirror(c) >= surfaceMirror(c + 0.05));
});

test('the seabed shows in full down to where it starts to fade, and not at all past it', () => {
  const [from, to] = water.seabedFade;
  assert.equal(seabedSeen(from - 1, water.seabedFade), 1);
  assert.equal(seabedSeen(to, water.seabedFade), 0);
  assert.equal(seabedSeen(to + 100, water.seabedFade), 0);
  for (let d = from; d < to; d += 1) assert.ok(seabedSeen(d, water.seabedFade) >= seabedSeen(d + 1, water.seabedFade));
});

test('at the surface the water shows the seabed through it and has no light of its own; over deep water all it has is its own', () => {
  const shallow = waterLeaving(sand, 0, 0.5, 0.8, sun, sky, water);
  const expected = sand.map((s, c) => (s * (sun[c] * (1 - surfaceMirror(0.8)) + sky[c] * 0.934)) / (sun[c] + sky[c]));
  shallow.forEach((v, c) => assert.ok(Math.abs(v - expected[c]) < 1e-9, `channel ${c}: ${v}, not ${expected[c]}`));
  // Whatever lies under it, past the fade it is the same water.
  const a = waterLeaving(sand, water.seabedFade[1] + 1, 0.5, 0.8, sun, sky, water);
  const b = waterLeaving([0, 0, 0], water.seabedFade[1] + 1, 0.5, 0.8, sun, sky, water);
  a.forEach((v, c) => assert.equal(v, b[c]));
  // And it is blue.
  assert.ok(a[2] > a[1] && a[1] > a[0], `deep water reads ${a}`);
});

test('red goes first and blue lasts: going deeper over sand the water turns from sand to turquoise to deep blue, never brighter in any channel', () => {
  let last = waterLeaving(sand, 0, 0.5, 0.8, sun, sky, water);
  for (let depth = 0.5; depth < water.seabedFade[1] + 5; depth += 0.5) {
    const now = waterLeaving(sand, depth, 0.5, 0.8, sun, sky, water);
    now.forEach((v, c) => assert.ok(v <= last[c] + 1e-12, `channel ${c} brightens at ${depth} m: ${v} over ${last[c]}`));
    last = now;
  }
  const atThree = waterLeaving(sand, 3, 0.5, 0.8, sun, sky, water);
  assert.ok(atThree[1] > 3 * atThree[0] && atThree[2] > 3 * atThree[0], `3 m over sand reads ${atThree}: not turquoise`);
});

test('the light through the water scales with the light on it, and is continuous across the fade', () => {
  const half = waterLeaving(sand, 8, 0.5, 0.8, sun.map((v) => v / 2), sky.map((v) => v / 2), water);
  const whole = waterLeaving(sand, 8, 0.5, 0.8, sun, sky, water);
  // The seabed's radiance already holds the light on it, so only the water's own scales.
  const own = waterLeaving([0, 0, 0], 8, 0.5, 0.8, sun, sky, water);
  whole.forEach((v, c) => assert.ok(Math.abs(v - own[c] / 2 - half[c]) < 1e-12));
  // Centimetre by centimetre, from the film at the surface down past the fade.
  for (let depth = 0; depth < water.seabedFade[1] + 5; depth += 0.01) {
    const a = waterLeaving(sand, depth, 0.5, 0.8, sun, sky, water);
    const b = waterLeaving(sand, depth + 0.01, 0.5, 0.8, sun, sky, water);
    a.forEach((v, c) => assert.ok(Math.abs(v - b[c]) < 0.01, `jumps at ${depth} m: ${v} to ${b[c]}`));
  }
});

test("the sea's albedo: the far sea's over deep water, and over a seabed as much more as shows of it", () => {
  const sea = config.sky.atmosphere.groundAlbedo;
  const over = water.seabedSand;
  assert.deepEqual(seaAlbedo(water.seabedFade[1] + 1, over, sea, water), sea);
  let last = seaAlbedo(0, over, sea, water);
  last.forEach((v, c) => assert.ok(Math.abs(v - (sea[c] + water.through * over[c])) < 1e-12));
  for (let depth = 1; depth < water.seabedFade[1]; depth++) {
    const now = seaAlbedo(depth, over, sea, water);
    now.forEach((v, c) => assert.ok(v <= last[c] && v >= sea[c], `channel ${c} at ${depth} m: ${v}`));
    last = now;
  }
  // A rock's seabed sends up less than sand's.
  const rock = seaAlbedo(2, config.world.terrain.albedo.rock, sea, water);
  rock.forEach((v, c) => assert.ok(v < seaAlbedo(2, over, sea, water)[c]));
});
