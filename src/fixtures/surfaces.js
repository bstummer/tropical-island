// Fixture (?fixture=surfaces): the ground's surfaces without the island, to
// judge them on their own (PLAN.md Stage 4). From the camera's feet out to
// the haze: strips of sand side by side, from dry through damp and wet to a
// film of water, and a strip of rock, with strips of the green to their left
// as the scrub behind a beach, the open palm belt and the lush jungle have
// it, on dry sand that reaches the horizon; to the right, ramps of dry sand at
// 15, 30 and 45 degrees; further left, walls of rock at 45, 70 and 90 degrees,
// rising from the sea's level (where the sea wets them) at the ground. Any view places it: the ground lies
// config.movement.walk.eye below the camera. With the sky (main.js adds it).
//
// For tools/screenshot.js it also checks that the sand's, the rock's and the
// green's tiles repeat (textures/sand.js, rock.js, green.js): made again shifted by a whole tile they
// must be the same, and shifted by half a tile, a deliberate mistake, they
// must not. The share of texels that changed by more than
// config.capture.surfaces.levels, per tile, goes to window.__SURFACES__ (a
// whole tile's shift can still flip the odd texel on a cell's edge, by
// rounding). Not part of the island.
import * as THREE from 'three';
import vertexShader from './light.vert';
import fragmentShader from './surfaces.frag';
import { createSandTextures, sandUniforms } from '../textures/sand.js';
import { createRockTextures, rockUniforms } from '../textures/rock.js';
import { createGreenTextures, greenUniforms } from '../textures/green.js';

const STRIPS = [0, 0.35, 0.6, 1]; // wetness: dry, damp, wet, a film
const GREENS = [[0.3, 0.1, 0.8], [1.5, 0.3, 0.2], [3, 0.9, 0]]; // band, lush, sandy: the scrub behind a beach, the open palm belt, the lush jungle
const STRIP = { width: 1.4, from: 0.3, to: 300 }; // metres
const RAMPS = { degrees: [15, 30, 45], width: 2.5, length: 5, ahead: 7, aside: 4 };
const WALLS = { degrees: [45, 70, 90], width: 3, height: 5, ahead: 9, aside: -9.5 }; // rock, to the left
const CHECK_SIZE = 128; // texels across the tiles the check makes

export function create(ctx) {
  const { scene, camera, frame, config, renderer } = ctx;
  const { terrain } = config.world;
  const sandSettings = terrain.sand;
  const textures = createSandTextures(renderer, ctx.rng('fixtures/surfaces'), sandSettings, ctx.quality.sandTexture);
  const rockTextures = createRockTextures(renderer, ctx.rng('fixtures/surfaces/rock'), terrain.rock, ctx.quality.rockTexture);
  const greenTextures = createGreenTextures(renderer, ctx.rng('fixtures/surfaces/green'), terrain.green, ctx.quality.greenTexture);
  window.__SURFACES__ = tileCheck(ctx, terrain);

  const yaw = new THREE.Euler().setFromQuaternion(camera.quaternion, 'YXZ').y;
  const forward = new THREE.Vector2(-Math.sin(yaw), -Math.cos(yaw));
  const right = new THREE.Vector2(-forward.y, forward.x);
  const shared = {
    ...frame.uniforms,
    ...sandUniforms(textures, sandSettings, config.world.island.zones.wetSand, config.sky.sun.sunsetYaw),
    ...rockUniforms(rockTextures, terrain.rock),
    ...greenUniforms(greenTextures, terrain.albedo, terrain.green),
    uDrySand: { value: new THREE.Vector3(...terrain.albedo.drySand) },
    uWetSand: { value: new THREE.Vector3(...terrain.albedo.wetSand) },
    uRock: { value: new THREE.Vector3(...terrain.albedo.rock) },
    uGround: { value: camera.position.y - config.movement.walk.eye }, // world y of the fixture's ground
  };
  const materials = [];
  // Sand at this wetness and height above the sea; `rising` sand rises a metre
  // in ten to the right, so the wet strips cross the heights of a few swash marks.
  // Rock is as high above the sea as above the fixture's ground, plus aboveSea.
  // The green: at this band, how lush and how sandy ([band, lush, sandy]).
  const material = (wetness, aboveSea, rising = false, rock = false, green = null) => {
    const m = new THREE.ShaderMaterial({
      name: 'fixture-surfaces',
      vertexShader,
      fragmentShader,
      uniforms: {
        ...shared,
        uWetness: { value: wetness },
        uAboveSea: { value: aboveSea },
        uAcross: { value: rising ? right.clone() : new THREE.Vector2() },
        uGreen: { value: new THREE.Vector3(...(green ?? [0, 0, 0])) },
      },
      defines: rock ? { SURFACE_ROCK: 1, ROCK_DETAIL: 1 } : green ? { SURFACE_GREEN: 1, GREEN_DETAIL: 1 } : {},
    });
    materials.push(m);
    return m;
  };

  const group = new THREE.Group();
  group.position.set(camera.position.x, camera.position.y - config.movement.walk.eye, camera.position.z);
  group.rotation.y = yaw;
  scene.add(group);
  const geometries = [];
  const plane = (width, length, segments) => {
    const g = new THREE.PlaneGeometry(width, length, 1, segments).rotateX(-Math.PI / 2);
    geometries.push(g);
    return g;
  };
  // Group space: -z ahead, +x to the right. The ground everywhere, a little below the strips.
  const ground = new THREE.Mesh(plane(20000, 20000, 200), material(0, 5));
  ground.position.y = -0.002;
  group.add(ground);
  // The strips side by side across the view, left to right.
  const start = -(STRIPS.length * STRIP.width) / 2;
  STRIPS.forEach((wetness, k) => {
    const x = start + (k + 0.5) * STRIP.width;
    // The swash marks sit at heights the wet band spans; the wet strips start where they do.
    const wet = wetness > 0.3;
    const aboveSea = wet ? 0.15 - 0.1 * (camera.position.x * right.x + camera.position.z * right.y + x) : 5;
    const strip = new THREE.Mesh(plane(STRIP.width, STRIP.to - STRIP.from, 300), material(wetness, aboveSea, wet));
    strip.position.set(x, 0, -(STRIP.from + STRIP.to) / 2);
    group.add(strip);
  });
  const rockStrip = new THREE.Mesh(plane(STRIP.width, STRIP.to - STRIP.from, 300), material(0, 5, false, true));
  rockStrip.position.set(start + (STRIPS.length + 0.5) * STRIP.width, 0, -(STRIP.from + STRIP.to) / 2);
  group.add(rockStrip);
  GREENS.forEach((green, k) => {
    const strip = new THREE.Mesh(plane(STRIP.width, STRIP.to - STRIP.from, 300), material(0, 5, false, false, green));
    strip.position.set(start - (k + 0.5) * STRIP.width, 0, -(STRIP.from + STRIP.to) / 2);
    group.add(strip);
  });
  // Rock walls to the left, leaning away from the camera, from the sea's level up.
  WALLS.degrees.forEach((degrees, k) => {
    const wall = new THREE.Mesh(plane(WALLS.width, WALLS.height, 40), material(0, 0, false, true));
    const angle = THREE.MathUtils.degToRad(degrees);
    wall.rotation.x = angle;
    wall.position.set(WALLS.aside - k * (WALLS.width + 0.5), (Math.sin(angle) * WALLS.height) / 2, -WALLS.ahead - (Math.cos(angle) * WALLS.height) / 2);
    group.add(wall);
  });
  // Ramps to the right, rising away from the camera.
  RAMPS.degrees.forEach((degrees, k) => {
    const ramp = new THREE.Mesh(plane(RAMPS.width, RAMPS.length, 20), material(0, 5));
    const angle = THREE.MathUtils.degToRad(degrees);
    ramp.rotation.x = angle;
    ramp.position.set(RAMPS.aside + k * (RAMPS.width + 0.5), (Math.sin(angle) * RAMPS.length) / 2, -RAMPS.ahead - (Math.cos(angle) * RAMPS.length) / 2);
    group.add(ramp);
  });

  return {
    update() {},
    dispose() {
      delete window.__SURFACES__;
      scene.remove(group);
      for (const g of geometries) g.dispose();
      for (const m of materials) m.dispose();
      textures.dispose();
      rockTextures.dispose();
      greenTextures.dispose();
    },
  };
}

// The sand's, the rock's and the green's tiles made again shifted by a whole
// tile across and down, and by half a tile: the share of texels that changed,
// per tile.
function tileCheck(ctx, settings) {
  const make = (shift) => {
    const t = createSandTextures(ctx.renderer, ctx.rng('fixtures/surfaces/tiles'), settings.sand, CHECK_SIZE, shift);
    const r = createRockTextures(ctx.renderer, ctx.rng('fixtures/surfaces/tiles/rock'), settings.rock, CHECK_SIZE, shift);
    const g = createGreenTextures(ctx.renderer, ctx.rng('fixtures/surfaces/tiles/green'), settings.green, CHECK_SIZE, shift);
    const pixels = { grain: t.pixels('grain'), ripples: t.pixels('ripples'), rock: r.pixels(), grass: g.pixels('grass'), litter: g.pixels('litter') };
    t.dispose();
    r.dispose();
    g.dispose();
    return pixels;
  };
  const base = make([0, 0]);
  const shifted = [make([1, 0]), make([0, 1])];
  const half = make([0.5, 0.5]);
  const { levels, tiles } = ctx.config.capture.surfaces;
  const changed = (a, b) => {
    let n = 0;
    for (let i = 0; i < a.length; i += 4) if (Math.abs(a[i] - b[i]) > levels || Math.abs(a[i + 1] - b[i + 1]) > levels || Math.abs(a[i + 2] - b[i + 2]) > levels || Math.abs(a[i + 3] - b[i + 3]) > levels) n++;
    return n / (a.length / 4);
  };
  const result = {};
  for (const name of tiles) {
    result[name] = { whole: Math.max(...shifted.map((s) => changed(base[name], s[name]))), half: changed(base[name], half[name]) };
  }
  return result;
}
