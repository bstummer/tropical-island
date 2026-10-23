// Fixture (?fixture=light): the shared lighting without the island, for
// judging light and haze. A level grey ground to the horizon, and at eye level
// in a row across the view, the same three spheres at distances from arm's
// length out to 30 km: white, middle grey and leaf green, each set scaled to look
// the same size, so only the light and the air between differ. Below the row,
// two more white spheres a few metres ahead, one over a patch of sand and one
// over a patch of sea, take the light from below from the ground under each
// (lighting.glsl groundAlbedo, here from a map of the fixture's own). With the
// sky (main.js adds it). For tools/screenshot.js, which checks the light's
// colour and the light from below on them, window.__LIGHT__ holds where the
// nearest white sphere of the row and the two spheres below are on screen. Not
// part of the island.
import * as THREE from 'three';
import vertexShader from './light.vert';
import fragmentShader from './light.frag';

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
  const { scene, camera, frame, config } = ctx;
  const sand = config.world.terrain.albedo.drySand;
  const sea = config.sky.atmosphere.groundAlbedo;
  const group = new THREE.Group();
  group.position.set(camera.position.x, 0, camera.position.z);
  scene.add(group);

  const materials = [...ALBEDOS, GROUND, sand, sea].map(
    (albedo) => new THREE.ShaderMaterial({ name: 'fixture-light', vertexShader, fragmentShader, uniforms: { ...frame.uniforms, uAlbedo: { value: new THREE.Vector3(...albedo) } } }),
  );
  const sphere = new THREE.SphereGeometry(1, 48, 24);
  const yaw = new THREE.Euler().setFromQuaternion(camera.quaternion, 'YXZ').y;
  DISTANCES.forEach((d, i) => {
    const radius = d * Math.tan(THREE.MathUtils.degToRad(SIZE));
    ALBEDOS.forEach((_, k) => {
      const azimuth = yaw + THREE.MathUtils.degToRad(SPREAD / 2 - (SPREAD * i) / (DISTANCES.length - 1) + (1 - k) * 2.4 * SIZE);
      const mesh = new THREE.Mesh(sphere, materials[k]);
      mesh.scale.setScalar(radius);
      mesh.position.set(-Math.sin(azimuth) * d, camera.position.y, -Math.cos(azimuth) * d);
      group.add(mesh);
    });
  });
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(120000, 120000, 200, 200).rotateX(-Math.PI / 2), materials[ALBEDOS.length]);
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
  const texels = new Float32Array(4 * map * map);
  for (let j = 0; j < map; j++) {
    for (let i = 0; i < map; i++) {
      const [x, z] = [corner[0] + i + 0.5, corner[1] + j + 0.5];
      const k = over.findIndex(([px, pz]) => Math.abs(x - px) < patch / 2 && Math.abs(z - pz) < patch / 2);
      texels.set([...(k < 0 ? GROUND : [sand, sea][k]), 1], 4 * (j * map + i));
    }
  }
  const albedoMap = new THREE.DataTexture(texels, map, map, THREE.RGBAFormat, THREE.FloatType); // unfiltered: each sphere's texel lies in its patch
  albedoMap.needsUpdate = true;
  frame.uniforms.uBounceMap.value = albedoMap;
  frame.uniforms.uBounceLayout.value.set(corner[0], corner[1], 1 / map, 0);
  const spheresBelow = over.map(([x, z], k) => {
    const mesh = new THREE.Mesh(sphere, materials[0]);
    mesh.scale.setScalar(radius);
    mesh.position.set(x - group.position.x, camera.position.y - below, z - group.position.z);
    const floor = new THREE.Mesh(new THREE.PlaneGeometry(patch, patch).rotateX(-Math.PI / 2), materials[ALBEDOS.length + 1 + k]);
    floor.position.set(mesh.position.x, 0.01, mesh.position.z);
    group.add(mesh, floor);
    return mesh;
  });

  // A sphere's centre in pixels from the top left, and its radius.
  group.updateMatrixWorld();
  const pixelsPerRadian = frame.size.height / 2 / Math.tan(THREE.MathUtils.degToRad(camera.fov / 2));
  const onScreen = (mesh) => {
    const centre = mesh.getWorldPosition(new THREE.Vector3());
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
      albedoMap.dispose();
      delete window.__LIGHT__;
      scene.remove(group);
      sphere.dispose();
      group.traverse((object) => object !== group && object.geometry !== sphere && object.geometry?.dispose());
      for (const m of materials) m.dispose();
    },
  };
}
