// Tool fixture (?fixture=shimmer): a card that shimmers on purpose, so
// tools/screenshot.js can prove its shimmer score catches it. The left half has
// unfiltered stripes finer than two pixels; the right half is a smooth ramp
// that must not count. Not part of the island.
import * as THREE from 'three';
import vertexShader from './shimmer.vert';
import fragmentShader from './shimmer.frag';

const DISTANCE = 10; // m in front of the start view; the card overfills the frame

export function create(ctx) {
  const { scene, camera } = ctx;
  const card = new THREE.Mesh(
    new THREE.PlaneGeometry(40, 24),
    new THREE.ShaderMaterial({ name: 'fixture-shimmer', vertexShader, fragmentShader }),
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
