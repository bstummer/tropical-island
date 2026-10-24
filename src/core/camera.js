import { DEG2RAD, Matrix4, Vector3, degToRad } from '../maths/index.js';
import { Node } from '../gpu/scene.js';

// The camera: a perspective projection with reversed depth (CLAUDE.md §8),
// computed as three.js's PerspectiveCamera computes it, so the matrices are
// the ones the pictures were made with, to the last bit.
export class Camera extends Node {
  constructor(fov, aspect, near, far) {
    super();
    Object.assign(this, { fov, aspect, near, far, zoom: 1 });
    this.matrixWorldInverse = new Matrix4();
    this.projectionMatrix = new Matrix4();
    this.projectionMatrixInverse = new Matrix4();
    this.updateProjectionMatrix();
  }

  updateProjectionMatrix() {
    const top = (this.near * Math.tan(DEG2RAD * 0.5 * this.fov)) / this.zoom;
    const height = 2 * top;
    const width = this.aspect * height;
    const left = -0.5 * width;
    this.projectionMatrix.makePerspective(left, left + width, top, top - height, this.near, this.far);
    this.projectionMatrixInverse.copy(this.projectionMatrix).invert();
  }

  updateMatrixWorld() {
    super.updateMatrixWorld();
    this.matrixWorldInverse.copy(this.matrixWorld).invert();
  }

  // Turns it to look at a point, as three.js's Camera.lookAt.
  lookAt(target) {
    this.quaternion.setFromRotationMatrix(lookAt.lookAt(this.position, target, UP));
    return this;
  }
}

const lookAt = new Matrix4();
const UP = new Vector3(0, 1, 0);

// Puts the camera at a view from views.js. Captures can turn it by [yaw, pitch]
// degrees in camera space, which is how they probe for shimmer.
export function applyView(camera, view, { turn = [0, 0] } = {}) {
  camera.position.fromArray(view.position);
  camera.rotation.set(degToRad(view.pitch), degToRad(view.yaw), 0, 'YXZ');
  camera.rotateY(degToRad(turn[0])).rotateX(degToRad(turn[1]));
  camera.updateMatrixWorld();
}
