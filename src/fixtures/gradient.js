// Tool fixture (?fixture=gradient): slow gradients that fill the view, a grey
// one above and a sky-blue one below, each changing by about one 8-bit level
// every 100 pixels. Without dither they show as bands at once, so
// tools/screenshot.js requires that they come out without any. Not part of the island.
import { degToRad } from '../maths/index.js';
import shader from './gradient.wgsl';
import { Material } from '../gpu/material.js';
import { plane } from '../gpu/geometry.js';
import { Mesh } from '../gpu/scene.js';

const DISTANCE = 10; // m

export function create(ctx) {
  const { scene, camera, frame } = ctx;
  const height = 2 * DISTANCE * Math.tan(degToRad(camera.fov / 2));
  const card = new Mesh(plane(height * (frame.size.width / frame.size.height), height), new Material({ name: 'fixture-gradient', shader }));
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
