// Tool fixture (?fixture=leaky): a system whose dispose() forgets things on
// purpose: its texture and render target stay on the GPU, and one mesh stays
// in the scene. tools/screenshot.js must catch all three. Not part of the island.
import { basicMaterial } from './basic.js';
import { plane } from '../gpu/geometry.js';
import { Mesh } from '../gpu/scene.js';
import { createTarget, Texture } from '../gpu/texture.js';

export function create(ctx) {
  const { scene, camera, renderer, gpu, frame } = ctx;
  const texture = new Texture(gpu, { name: 'fixture-leaky', width: 64, height: 64, data: true, sampler: { mag: 'nearest', min: 'nearest' } });
  texture.upload(new Uint8Array(64 * 64 * 4).fill(200));
  const target = createTarget(gpu, { name: 'fixture-leaky', width: 64, height: 64, format: 'rgba8unorm', depth: true });

  const card = new Mesh(plane(4, 4), basicMaterial({ map: texture }));
  const forgotten = new Mesh(plane(1, 1), basicMaterial());
  for (const [mesh, x] of [[card, 0], [forgotten, 3]]) {
    mesh.position.copy(camera.position);
    mesh.quaternion.copy(camera.quaternion);
    mesh.translateX(x).translateZ(-10);
    scene.add(mesh);
  }
  const removePass = frame.beforeScene(() => renderer.render(scene, camera, target, { clearColor: [0, 0, 0, 0], clearDepth: 0 }));

  return {
    update() {},
    dispose() {
      removePass();
      scene.remove(card);
      card.geometry.dispose();
      card.material.dispose();
      // Forgotten: texture.destroy(), target.dispose(), scene.remove(forgotten).
    },
  };
}
