// Fixture (?fixture=light): the shared lighting without the island, for
// judging light and haze. A level grey ground to the horizon, and at eye level
// in a row across the view, the same three spheres at distances from arm's
// length out to 30 km: white, middle grey and leaf green, each set scaled to look
// the same size, so only the light and the air between differ. With the sky
// (main.js adds it). For tools/screenshot.js, which checks the light's colour on
// it, window.__LIGHT__ holds where the nearest white sphere is on screen. Not
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

export function create(ctx) {
  const { scene, camera, frame } = ctx;
  const group = new THREE.Group();
  group.position.set(camera.position.x, 0, camera.position.z);
  scene.add(group);

  const materials = [...ALBEDOS, GROUND].map(
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

  // The nearest white sphere: its centre in pixels from the top left, and its radius.
  group.updateMatrixWorld();
  const [white] = group.children;
  const centre = white.getWorldPosition(new THREE.Vector3()).project(camera);
  const pixelsPerRadian = frame.size.height / 2 / Math.tan(THREE.MathUtils.degToRad(camera.fov / 2));
  window.__LIGHT__ = {
    white: [((centre.x + 1) / 2) * frame.size.width, ((1 - centre.y) / 2) * frame.size.height],
    radius: THREE.MathUtils.degToRad(SIZE) * pixelsPerRadian,
  };

  return {
    update() {},
    dispose() {
      delete window.__LIGHT__;
      scene.remove(group);
      sphere.dispose();
      ground.geometry.dispose();
      for (const m of materials) m.dispose();
    },
  };
}
