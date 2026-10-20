// Tool fixture (?fixture=leaky): a system whose dispose() forgets things on
// purpose: its texture and render target stay on the GPU, one mesh stays in the
// scene and so does its fog. tools/screenshot.js must catch all four. Not part
// of the island.
import * as THREE from 'three';
import { withSceneOutput } from '../post/scene-output.js';

export function create(ctx) {
  const { scene, camera, renderer, frame } = ctx;
  const texture = new THREE.DataTexture(new Uint8Array(64 * 64 * 4).fill(200), 64, 64);
  texture.needsUpdate = true;
  const target = new THREE.WebGLRenderTarget(64, 64);
  scene.fog = new THREE.Fog(0x000000, 100, 1000);

  const card = new THREE.Mesh(new THREE.PlaneGeometry(4, 4), withSceneOutput(new THREE.MeshBasicMaterial({ map: texture }), frame));
  const forgotten = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), withSceneOutput(new THREE.MeshBasicMaterial(), frame));
  for (const [mesh, x] of [[card, 0], [forgotten, 3]]) {
    mesh.position.copy(camera.position);
    mesh.quaternion.copy(camera.quaternion);
    mesh.translateX(x).translateZ(-10);
    scene.add(mesh);
  }
  const removePass = frame.beforeScene(() => {
    renderer.setRenderTarget(target);
    renderer.render(scene, camera);
  });

  return {
    update() {},
    dispose() {
      removePass();
      scene.remove(card);
      card.geometry.dispose();
      card.material.dispose();
      // Forgotten: texture.dispose(), target.dispose(), scene.remove(forgotten), scene.fog = null.
    },
  };
}
