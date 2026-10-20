import * as THREE from 'three';

// Puts the camera at a view from views.js. Captures can nudge it in camera
// space: `offset` moves it in metres (x right, y up, z back) and `turn` rotates
// it by [yaw, pitch] degrees, which is how they probe for shimmer.
export function applyView(camera, view, { offset = [0, 0, 0], turn = [0, 0] } = {}) {
  camera.position.fromArray(view.position);
  camera.rotation.set(THREE.MathUtils.degToRad(view.pitch), THREE.MathUtils.degToRad(view.yaw), 0, 'YXZ');
  camera.translateX(offset[0]).translateY(offset[1]).translateZ(offset[2]);
  camera.rotateY(THREE.MathUtils.degToRad(turn[0])).rotateX(THREE.MathUtils.degToRad(turn[1]));
  camera.updateMatrixWorld();
}
