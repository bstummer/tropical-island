// Tool fixture (?fixture=gradient): slow gradients that fill the view, a grey
// one above and a sky-blue one below, each changing by about one 8-bit level
// every 100 pixels. Without dither they show as bands at once, so
// tools/screenshot.js requires that they come out without any. Not part of the island.
import * as THREE from 'three';
import vertexShader from './gradient.vert';
import fragmentShader from './gradient.frag';

const DISTANCE = 10; // m

export function create(ctx) {
  const { scene, camera, frame } = ctx;
  const height = 2 * DISTANCE * Math.tan(THREE.MathUtils.degToRad(camera.fov / 2));
  const card = new THREE.Mesh(
    new THREE.PlaneGeometry(height * (frame.size.width / frame.size.height), height),
    new THREE.ShaderMaterial({ name: 'fixture-gradient', vertexShader, fragmentShader, uniforms: { ...frame.uniforms } }),
  );
  card.position.copy(camera.position);
  card.quaternion.copy(camera.quaternion);
  card.translateZ(-DISTANCE);
  scene.add(card);

  return {
    update() {},
    dispose() {
      scene.remove(card);
      card.geometry.dispose();
      card.material.dispose();
    },
  };
}
