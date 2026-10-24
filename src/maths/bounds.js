// Boxes, spheres, planes and the view frustum, for culling, as three.js's (see
// index.js), in its order of operations.
import { Vector3 } from './vector.js';

const corner = new Vector3();

// An axis-aligned box; empty (min above max) until it takes a point.
export class Box3 {
  constructor() {
    this.min = new Vector3(Infinity, Infinity, Infinity);
    this.max = new Vector3(-Infinity, -Infinity, -Infinity);
  }

  makeEmpty() {
    this.min.x = this.min.y = this.min.z = Infinity;
    this.max.x = this.max.y = this.max.z = -Infinity;
    return this;
  }

  isEmpty() {
    return this.max.x < this.min.x || this.max.y < this.min.y || this.max.z < this.min.z;
  }

  expandByPoint(point) {
    this.min.min(point);
    this.max.max(point);
    return this;
  }

  // Its centre, or the origin for an empty box.
  getCenter(target) {
    return this.isEmpty() ? target.set(0, 0, 0) : target.addVectors(this.min, this.max).multiplyScalar(0.5);
  }
}

// A sphere; a negative radius is empty.
export class Sphere {
  constructor(center = new Vector3(), radius = -1) {
    this.center = center;
    this.radius = radius;
  }

  copy(sphere) {
    this.center.copy(sphere.center);
    this.radius = sphere.radius;
    return this;
  }

  // Moved by a matrix, its radius grown by the matrix's largest scale.
  applyMatrix4(m) {
    this.center.applyMatrix4(m);
    this.radius = this.radius * m.getMaxScaleOnAxis();
    return this;
  }
}

// The points p with normal · p + constant = 0; positive on the normal's side.
export class Plane {
  constructor(normal = new Vector3(1, 0, 0), constant = 0) {
    this.normal = normal;
    this.constant = constant;
  }

  setComponents(x, y, z, w) {
    this.normal.set(x, y, z);
    this.constant = w;
    return this;
  }

  // A zero normal divides by zero.
  normalize() {
    const inverseNormalLength = 1.0 / this.normal.length();
    this.normal.multiplyScalar(inverseNormalLength);
    this.constant *= inverseNormalLength;
    return this;
  }

  distanceToPoint(point) {
    return this.normal.dot(point) + this.constant;
  }
}

// What a camera sees: six planes facing inwards.
export class Frustum {
  constructor() {
    this.planes = Array.from({ length: 6 }, () => new Plane());
  }

  // From a view-projection matrix with reversed depth (Matrix4.makePerspective):
  // right, left, bottom, top, far (depth 0) and near (depth 1).
  setFromProjectionMatrix(m) {
    const planes = this.planes;
    const me = m.elements;
    const me0 = me[0], me1 = me[1], me2 = me[2], me3 = me[3];
    const me4 = me[4], me5 = me[5], me6 = me[6], me7 = me[7];
    const me8 = me[8], me9 = me[9], me10 = me[10], me11 = me[11];
    const me12 = me[12], me13 = me[13], me14 = me[14], me15 = me[15];
    planes[0].setComponents(me3 - me0, me7 - me4, me11 - me8, me15 - me12).normalize();
    planes[1].setComponents(me3 + me0, me7 + me4, me11 + me8, me15 + me12).normalize();
    planes[2].setComponents(me3 + me1, me7 + me5, me11 + me9, me15 + me13).normalize();
    planes[3].setComponents(me3 - me1, me7 - me5, me11 - me9, me15 - me13).normalize();
    planes[4].setComponents(me2, me6, me10, me14).normalize();
    planes[5].setComponents(me3 - me2, me7 - me6, me11 - me10, me15 - me14).normalize();
    return this;
  }

  // Whether any of the sphere may be in view (it may also lie just outside a corner).
  intersectsSphere(sphere) {
    const center = sphere.center;
    const negRadius = -sphere.radius;
    for (const plane of this.planes) if (plane.distanceToPoint(center) < negRadius) return false;
    return true;
  }

  // Whether any of the box may be in view: its corner furthest along each plane's normal is inside it.
  intersectsBox(box) {
    for (const plane of this.planes) {
      corner.x = plane.normal.x > 0 ? box.max.x : box.min.x;
      corner.y = plane.normal.y > 0 ? box.max.y : box.min.y;
      corner.z = plane.normal.z > 0 ? box.max.z : box.min.z;
      if (plane.distanceToPoint(corner) < 0) return false;
    }
    return true;
  }
}
