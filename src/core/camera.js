import * as THREE from 'three';

// Puts the camera at a view from views.js. Captures can turn it by [yaw, pitch]
// degrees in camera space, which is how they probe for shimmer.
export function applyView(camera, view, { turn = [0, 0] } = {}) {
  camera.position.fromArray(view.position);
  camera.rotation.set(THREE.MathUtils.degToRad(view.pitch), THREE.MathUtils.degToRad(view.yaw), 0, 'YXZ');
  camera.rotateY(THREE.MathUtils.degToRad(turn[0])).rotateX(THREE.MathUtils.degToRad(turn[1]));
  camera.updateMatrixWorld();
}
