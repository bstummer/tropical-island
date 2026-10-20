// Tool fixture (?fixture=silhouette): thin dark bars, two to five pixels wide
// and at every angle, against a sky up to hundreds of times brighter, like palm
// fronds against a sunset. tools/screenshot.js requires that they stay
// anti-aliased (no shimmer) after tonemapping. Bars thinner than about two
// pixels crawl with 4x MSAA whatever the frame does; keeping detail that fine
// out of the picture is the job of each system's level of detail. Not part of the island.
import * as THREE from 'three';
import vertexShader from './silhouette.vert';
import fragmentShader from './silhouette.frag';
import { withSceneOutput } from '../post/scene-output.js';

const SKY_DISTANCE = 30; // m
const BAR_DISTANCE = 10; // m
const COLUMNS = 10;
const BARS = 100; // dense enough that a regression shows over the shimmer limit

export function create(ctx) {
  const { scene, camera, frame } = ctx;
  const group = new THREE.Group();
  group.position.copy(camera.position);
  group.quaternion.copy(camera.quaternion);
  scene.add(group);

  const sky = new THREE.Mesh(
    new THREE.PlaneGeometry(80, 45),
    new THREE.ShaderMaterial({ name: 'fixture-silhouette', vertexShader, fragmentShader, uniforms: { ...frame.uniforms } }),
  );
  sky.position.z = -SKY_DISTANCE;
  group.add(sky);

  // Bar widths in pixels at the bar distance; a pixel there is about 1.6 cm at 1600 x 900.
  const pixel = (2 * BAR_DISTANCE * Math.tan(THREE.MathUtils.degToRad(camera.fov / 2))) / frame.size.height;
  const material = withSceneOutput(new THREE.MeshBasicMaterial({ color: new THREE.Color(0.03, 0.03, 0.025) }), frame);
  for (let i = 0; i < BARS; i++) {
    const width = (2 + (3 * (i % 5)) / 4) * pixel;
    const bar = new THREE.Mesh(new THREE.PlaneGeometry(2, width), material);
    bar.position.set(((i % COLUMNS) - 4.5) * 1.9, (Math.floor(i / COLUMNS) - 4.5) * 1.05, -BAR_DISTANCE);
    bar.rotation.z = (i * 37 * Math.PI) / 180; // angles spread over the half circle
    group.add(bar);
  }

  return {
    update() {},
    dispose() {
      scene.remove(group);
      group.traverse((object) => object.geometry?.dispose());
      sky.material.dispose();
      material.dispose();
    },
  };
}
