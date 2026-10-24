// Tool fixture (?fixture=shimmer): a card that shimmers on purpose, so
// tools/screenshot.js can prove its shimmer score catches it. The left half has
// unfiltered stripes finer than two pixels; the right half is a smooth ramp
// that must not count. Not part of the island.
import shader from './shimmer.wgsl';
import { Material } from '../gpu/material.js';
import { plane } from '../gpu/geometry.js';
import { Mesh } from '../gpu/scene.js';

const DISTANCE = 10; // m in front of the start view; the card overfills the frame

export function create(ctx) {
  const { scene, camera } = ctx;
  const card = new Mesh(plane(40, 24), new Material({ name: 'fixture-shimmer', shader }));
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
