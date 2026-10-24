// Fixture (?fixture=light): the shared lighting without the island, for
// judging light and haze. A level grey ground to the horizon, and at eye level
// in a row across the view, the same three spheres at distances from arm's
// length out to 30 km: white, middle grey and leaf green, each set scaled to look
// the same size, so only the light and the air between differ. Below the row,
// two more white spheres a few metres ahead, one over a patch of sand and one
// over a patch of sea, take the light from below from the ground under each
// (lighting.wgsl groundAlbedo, here from a map of the fixture's own). With the
// sky (main.js adds it). For tools/screenshot.js, which checks the light's
// colour and the light from below on them, window.__LIGHT__ holds where the
// nearest white sphere of the row and the two spheres below are on screen. Not
// part of the island.
import { DataUtils, Euler, MathUtils, Matrix4, Vector3 } from 'three';
import shader from './light.wgsl';
import { Material } from '../gpu/material.js';
import { plane, sphere as sphereGeometry } from '../gpu/geometry.js';
import { Mesh, Node } from '../gpu/scene.js';
import { Texture } from '../gpu/texture.js';

const DISTANCES = [1, 4, 20, 100, 500, 2500, 12000, 30000]; // m
const SPREAD = 60; // degrees across the view the row covers
const SIZE = 1.1; // degrees: each sphere's angular radius
// Linear albedos: white paint, middle grey, a sunlit leaf; and the ground's.
const ALBEDOS = [[0.8, 0.8, 0.8], [0.18, 0.18, 0.18], [0.06, 0.18, 0.03]];
const GROUND = [0.3, 0.3, 0.3];
// The spheres over sand and sea: metres ahead, below the eye and to the right,
// clear of the row's near spheres on the left; their radius, and the patches'
// size; the fixture's ground map, 1 m a texel, `map` across.
const BOUNCE = { ahead: 4, below: 1, right: [0.4, 2.6], radius: 0.25, patch: 2, map: 64 };

export function create(ctx) {
  const { scene, camera, frame, config, gpu } = ctx;
  const sand = config.world.terrain.albedo.drySand;
  const sea = config.sky.atmosphere.groundAlbedo;
  const group = new Node();
  group.position.set(camera.position.x, 0, camera.position.z);
  scene.add(group);

  const materials = [...ALBEDOS, GROUND, sand, sea].map((albedo) => new Material({ name: 'fixture-light', shader, uniforms: { uAlbedo: { value: new Vector3(...albedo) } } }));
  const sphere = sphereGeometry(1, 48, 24);
  const yaw = new Euler().setFromQuaternion(camera.quaternion, 'YXZ').y;
  DISTANCES.forEach((d, i) => {
    const radius = d * Math.tan(MathUtils.degToRad(SIZE));
    ALBEDOS.forEach((_, k) => {
      const azimuth = yaw + MathUtils.degToRad(SPREAD / 2 - (SPREAD * i) / (DISTANCES.length - 1) + (1 - k) * 2.4 * SIZE);
      const mesh = new Mesh(sphere, materials[k]);
      mesh.scale.setScalar(radius);
      mesh.position.set(-Math.sin(azimuth) * d, camera.position.y, -Math.cos(azimuth) * d);
      group.add(mesh);
    });
  });
  const flat = (width, segments = 1) => plane(width, width, segments, segments).applyMatrix4(new Matrix4().makeRotationX(-Math.PI / 2));
  const geometries = [sphere, flat(120000, 200)];
  const ground = new Mesh(geometries[1], materials[ALBEDOS.length]);
  group.add(ground);

  // The ground's albedo from above, as world/terrain.js keeps the island's: grey
  // everywhere, as far as it reaches, but for the patches of sand and sea.
  const { ahead, below, right: aside, radius, patch, map } = BOUNCE;
  const forward = [-Math.sin(yaw), -Math.cos(yaw)];
  const right = [-forward[1], forward[0]];
  const over = [sand, sea].map((_, k) => [
    camera.position.x + forward[0] * ahead + right[0] * aside[k],
    camera.position.z + forward[1] * ahead + right[1] * aside[k],
  ]);
  const corner = [camera.position.x - map / 2, camera.position.z - map / 2];
  // Half floats: core WebGPU filters no 32-bit float texture, and the lighting's
  // map is filtered (the island's is half floats too). Unfiltered here all the
  // same: each sphere's texel lies in its patch.
  const texels = new Uint16Array(4 * map * map);
  for (let j = 0; j < map; j++) {
    for (let i = 0; i < map; i++) {
      const [x, z] = [corner[0] + i + 0.5, corner[1] + j + 0.5];
      const k = over.findIndex(([px, pz]) => Math.abs(x - px) < patch / 2 && Math.abs(z - pz) < patch / 2);
      texels.set([...(k < 0 ? GROUND : [sand, sea][k]), 1].map((v) => DataUtils.toHalfFloat(v)), 4 * (j * map + i));
    }
  }
  const albedoMap = new Texture(gpu, { name: 'fixture-light albedo', width: map, height: map, format: 'rgba16float', data: true, sampler: { mag: 'nearest', min: 'nearest' } }).upload(texels);
  frame.uniforms.uBounceMap.value = albedoMap;
  frame.uniforms.uBounceLayout.value.set(corner[0], corner[1], 1 / map, 0);
  const spheresBelow = over.map(([x, z], k) => {
    const mesh = new Mesh(sphere, materials[0]);
    mesh.scale.setScalar(radius);
    mesh.position.set(x - group.position.x, camera.position.y - below, z - group.position.z);
    const floorGeometry = flat(patch);
    geometries.push(floorGeometry);
    const floor = new Mesh(floorGeometry, materials[ALBEDOS.length + 1 + k]);
    floor.position.set(mesh.position.x, 0.01, mesh.position.z);
    group.add(mesh, floor);
    return mesh;
  });

  // A sphere's centre in pixels from the top left, and its radius.
  group.updateMatrixWorld();
  const pixelsPerRadian = frame.size.height / 2 / Math.tan(MathUtils.degToRad(camera.fov / 2));
  const onScreen = (mesh) => {
    const centre = new Vector3().setFromMatrixPosition(mesh.matrixWorld);
    const distance = centre.distanceTo(camera.position);
    centre.project(camera);
    return { at: [((centre.x + 1) / 2) * frame.size.width, ((1 - centre.y) / 2) * frame.size.height], radius: (mesh.scale.x / distance) * pixelsPerRadian };
  };
  const nearest = onScreen(group.children[0]);
  window.__LIGHT__ = {
    white: nearest.at,
    radius: nearest.radius,
    overSand: onScreen(spheresBelow[0]),
    overSea: onScreen(spheresBelow[1]),
  };

  return {
    update() {},
    dispose() {
      frame.uniforms.uBounceMap.value = null;
      frame.uniforms.uBounceLayout.value.set(0, 0, 0, 0);
      albedoMap.destroy();
      delete window.__LIGHT__;
      scene.remove(group);
      for (const geometry of geometries) geometry.dispose();
      for (const m of materials) m.dispose();
    },
  };
}
