// What the frame draws: a tree of nodes with transforms, as three.js's scene
// graph, whose meshes each draw a geometry with a material in one of the
// frame's passes (post/frame.js): 'opaque', 'afterOpaque' or 'translucent'.
// Draw order follows three.js's: by renderOrder, then material, then distance;
// transparent ones back to front (drawOrder).
import { Euler, Matrix4, Quaternion, Vector3 } from 'three';

let nextId = 0;
const scratch = new Vector3();
const turn = new Quaternion();
const [X, Y, Z] = [new Vector3(1, 0, 0), new Vector3(0, 1, 0), new Vector3(0, 0, 1)];

export class Node {
  constructor() {
    this.id = nextId++;
    this.name = '';
    this.parent = null;
    this.children = [];
    this.position = new Vector3();
    // Kept in step with each other, as three.js's Object3D keeps them.
    this.rotation = new Euler();
    this.quaternion = new Quaternion();
    this.rotation._onChange(() => this.quaternion.setFromEuler(this.rotation, false));
    this.quaternion._onChange(() => this.rotation.setFromQuaternion(this.quaternion, undefined, false));
    this.scale = new Vector3(1, 1, 1);
    this.visible = true;
    this.matrixWorld = new Matrix4();
  }

  add(...nodes) {
    for (const node of nodes) {
      node.parent?.remove(node);
      node.parent = this;
      this.children.push(node);
    }
    return this;
  }

  remove(...nodes) {
    for (const node of nodes) {
      const i = this.children.indexOf(node);
      if (i >= 0) {
        this.children.splice(i, 1);
        node.parent = null;
      }
    }
    return this;
  }

  traverse(fn) {
    fn(this);
    for (const child of this.children) child.traverse(fn);
  }

  // Turns about the node's own axes, as three.js's rotateX/Y/Z.
  rotateOnAxis(axis, angle) {
    this.quaternion.multiply(turn.setFromAxisAngle(axis, angle));
    return this;
  }

  rotateX(angle) {
    return this.rotateOnAxis(X, angle);
  }

  rotateY(angle) {
    return this.rotateOnAxis(Y, angle);
  }

  rotateZ(angle) {
    return this.rotateOnAxis(Z, angle);
  }

  // Moves along the node's own axes, as three.js's translateX/Y/Z (to the last bit).
  translateOnAxis(axis, distance) {
    this.position.add(scratch.copy(axis).applyQuaternion(this.quaternion).multiplyScalar(distance));
    return this;
  }

  translateX(distance) {
    return this.translateOnAxis(X, distance);
  }

  translateY(distance) {
    return this.translateOnAxis(Y, distance);
  }

  translateZ(distance) {
    return this.translateOnAxis(Z, distance);
  }

  updateMatrixWorld() {
    this.matrixWorld.compose(this.position, this.quaternion, this.scale);
    if (this.parent) this.matrixWorld.premultiply(this.parent.matrixWorld);
    for (const child of this.children) child.updateMatrixWorld();
  }
}

export class Mesh extends Node {
  constructor(geometry, material) {
    super();
    this.geometry = geometry;
    this.material = material;
    this.pass = 'opaque';
    this.renderOrder = 0;
    this.frustumCulled = true; // false: drawn wherever its bounding sphere is (instanced meshes cull themselves)
  }
}

// The order three.js draws a pass in (WebGLRenderLists): opaque meshes by
// renderOrder, material, then near to far; transparent ones by renderOrder,
// then far to near. entries: [{ mesh, z }], z the clip-space depth of the
// mesh's bounding sphere's centre, which shrinks with distance under reversed
// depth (so three negates it then).
export function drawOrder(entries, reversedDepth) {
  const far = (e) => (reversedDepth ? -e.z : e.z);
  const [opaque, transparent] = [entries.filter((e) => !e.mesh.material.transparent), entries.filter((e) => e.mesh.material.transparent)];
  opaque.sort((a, b) => a.mesh.renderOrder - b.mesh.renderOrder || a.mesh.material.id - b.mesh.material.id || far(a) - far(b) || a.mesh.id - b.mesh.id);
  transparent.sort((a, b) => a.mesh.renderOrder - b.mesh.renderOrder || far(b) - far(a) || a.mesh.id - b.mesh.id);
  return [...opaque, ...transparent];
}

export class Scene extends Node {
  // The meshes in `pass` (all with undefined) that are visible, with every
  // ancestor visible; with `hidden`, the hidden ones too.
  meshes(pass, out = [], hidden = false) {
    const walk = (node) => {
      if (!node.visible && !hidden) return;
      if (node instanceof Mesh && (pass === undefined || node.pass === pass)) out.push(node);
      for (const child of node.children) walk(child);
    };
    walk(this);
    return out;
  }
}
