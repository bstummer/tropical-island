// Rotations as angles about the axes in turn, as three.js's Euler (see
// index.js), in its order of operations: XYZ, every node's default, and YXZ,
// the camera's (yaw, then pitch). A change calls the function given to
// onChange(), through which a node keeps its quaternion in step (gpu/scene.js).
import { Matrix4 } from './matrix.js';
import { clamp } from './scalar.js';

const ORDERS = ['XYZ', 'YXZ'];
const rotation = new Matrix4();
const nothing = () => {};

export class Euler {
  constructor(x = 0, y = 0, z = 0, order = 'XYZ') {
    this._x = x;
    this._y = y;
    this._z = z;
    this._order = known(order);
    this._changed = nothing;
  }

  get x() {
    return this._x;
  }

  set x(value) {
    this._x = value;
    this._changed();
  }

  get y() {
    return this._y;
  }

  set y(value) {
    this._y = value;
    this._changed();
  }

  get z() {
    return this._z;
  }

  set z(value) {
    this._z = value;
    this._changed();
  }

  get order() {
    return this._order;
  }

  set order(value) {
    this._order = known(value);
    this._changed();
  }

  onChange(fn) {
    this._changed = fn;
    return this;
  }

  set(x, y, z, order = this._order) {
    this._order = known(order);
    this._x = x;
    this._y = y;
    this._z = z;
    this._changed();
    return this;
  }

  copy(euler) {
    this._x = euler._x;
    this._y = euler._y;
    this._z = euler._z;
    this._order = euler._order;
    this._changed();
    return this;
  }

  // From a matrix whose upper 3×3 is a pure rotation. Near ±90° about the
  // middle axis, the first and last axes line up: the last angle is then 0.
  // `update` other than true leaves out the change call.
  setFromRotationMatrix(m, order = this._order, update = true) {
    const te = m.elements;
    const m11 = te[0], m12 = te[4], m13 = te[8];
    const m21 = te[1], m22 = te[5], m23 = te[9];
    const m31 = te[2], m32 = te[6], m33 = te[10];
    if (known(order) === 'XYZ') {
      this._y = Math.asin(clamp(m13, -1, 1));
      if (Math.abs(m13) < 0.9999999) {
        this._x = Math.atan2(-m23, m33);
        this._z = Math.atan2(-m12, m11);
      } else {
        this._x = Math.atan2(m32, m22);
        this._z = 0;
      }
    } else {
      this._x = Math.asin(-clamp(m23, -1, 1));
      if (Math.abs(m23) < 0.9999999) {
        this._y = Math.atan2(m13, m33);
        this._z = Math.atan2(m21, m22);
      } else {
        this._y = Math.atan2(-m31, m11);
        this._z = 0;
      }
    }
    this._order = order;
    if (update === true) this._changed();
    return this;
  }

  setFromQuaternion(q, order, update) {
    rotation.makeRotationFromQuaternion(q);
    return this.setFromRotationMatrix(rotation, order, update);
  }
}

function known(order) {
  if (!ORDERS.includes(order)) throw new Error(`Euler: no order ${order} (${ORDERS.join(' and ')} only)`);
  return order;
}
