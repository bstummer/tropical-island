// Tool fixture (?fixture=stale-time): a card coloured by the time of day, read
// once at boot instead of on every update. A time set at runtime then renders
// differently from the same time set at boot, which tools/screenshot.js must
// catch. Not part of the island.
import { Color, MathUtils } from 'three';
import { basicMaterial } from './basic.js';
import { plane } from '../gpu/geometry.js';
import { Mesh } from '../gpu/scene.js';

const DISTANCE = 10; // m

export function create(ctx) {
  const { scene, camera, frame } = ctx;
  const warmth = (ctx.timeOfDay - 6) / 12; // read once: the bug this fixture exists for
  const material = basicMaterial({ color: new Color(0.2 + 0.6 * warmth, 0.4, 0.8 - 0.6 * warmth) });
  const height = 2 * DISTANCE * Math.tan(MathUtils.degToRad(camera.fov / 2));
  const card = new Mesh(plane(height * (frame.size.width / frame.size.height), height), material);
  card.position.copy(camera.position);
  card.quaternion.copy(camera.quaternion);
  card.translateZ(-DISTANCE);
  scene.add(card);

  return {
    update() {},
    dispose() {
      scene.remove(card);
      card.geometry.dispose();
      material.dispose();
    },
  };
}
