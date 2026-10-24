// Rotations as unit quaternions, as three.js's (see index.js), in its order of
// operations. A change calls the function given to onChange(), through which a
// node keeps its angles in step (gpu/scene.js).

const nothing = () => {};

export class Quaternion {
  constructor(x = 0, y = 0, z = 0, w = 1) {
    this._x = x;
    this._y = y;
    this._z = z;
    this._w = w;
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

  get w() {
    return this._w;
  }

  set w(value) {
    this._w = value;
    this._changed();
  }

  onChange(fn) {
    this._changed = fn;
    return this;
  }

  set(x, y, z, w) {
    this._x = x;
    this._y = y;
    this._z = z;
    this._w = w;
    this._changed();
    return this;
  }

  copy(q) {
    this._x = q.x;
    this._y = q.y;
    this._z = q.z;
    this._w = q.w;
    this._changed();
    return this;
  }

  fromArray(array, offset = 0) {
    this._x = array[offset];
    this._y = array[offset + 1];
    this._z = array[offset + 2];
    this._w = array[offset + 3];
    this._changed();
    return this;
  }

  // From Euler angles (euler.js), in their order (XYZ or YXZ); `update` other
  // than true leaves out the change call (for whoever keeps the angles in step).
  setFromEuler(euler, update = true) {
    const x = euler.x, y = euler.y, z = euler.z;
    const c1 = Math.cos(x / 2), c2 = Math.cos(y / 2), c3 = Math.cos(z / 2);
    const s1 = Math.sin(x / 2), s2 = Math.sin(y / 2), s3 = Math.sin(z / 2);
    if (euler.order === 'XYZ') {
      this._x = s1 * c2 * c3 + c1 * s2 * s3;
      this._y = c1 * s2 * c3 - s1 * c2 * s3;
      this._z = c1 * c2 * s3 + s1 * s2 * c3;
      this._w = c1 * c2 * c3 - s1 * s2 * s3;
    } else if (euler.order === 'YXZ') {
      this._x = s1 * c2 * c3 + c1 * s2 * s3;
      this._y = c1 * s2 * c3 - s1 * c2 * s3;
      this._z = c1 * c2 * s3 - s1 * s2 * c3;
      this._w = c1 * c2 * c3 + s1 * s2 * s3;
    } else {
      throw new Error(`Quaternion.setFromEuler: no order ${euler.order} (XYZ and YXZ only)`);
    }
    if (update === true) this._changed();
    return this;
  }

  // A turn by `angle` about a unit axis.
  setFromAxisAngle(axis, angle) {
    const halfAngle = angle / 2, s = Math.sin(halfAngle);
    this._x = axis.x * s;
    this._y = axis.y * s;
    this._z = axis.z * s;
    this._w = Math.cos(halfAngle);
    this._changed();
    return this;
  }

  // From a matrix whose upper 3×3 is a pure rotation (unscaled).
  setFromRotationMatrix(m) {
    const te = m.elements;
    const m11 = te[0], m12 = te[4], m13 = te[8];
    const m21 = te[1], m22 = te[5], m23 = te[9];
    const m31 = te[2], m32 = te[6], m33 = te[10];
    const trace = m11 + m22 + m33;
    if (trace > 0) {
      const s = 0.5 / Math.sqrt(trace + 1.0);
      this._w = 0.25 / s;
      this._x = (m32 - m23) * s;
      this._y = (m13 - m31) * s;
      this._z = (m21 - m12) * s;
    } else if (m11 > m22 && m11 > m33) {
      const s = 2.0 * Math.sqrt(1.0 + m11 - m22 - m33);
      this._w = (m32 - m23) / s;
      this._x = 0.25 * s;
      this._y = (m12 + m21) / s;
      this._z = (m13 + m31) / s;
    } else if (m22 > m33) {
      const s = 2.0 * Math.sqrt(1.0 + m22 - m11 - m33);
      this._w = (m13 - m31) / s;
      this._x = (m12 + m21) / s;
      this._y = 0.25 * s;
      this._z = (m23 + m32) / s;
    } else {
      const s = 2.0 * Math.sqrt(1.0 + m33 - m11 - m22);
      this._w = (m21 - m12) / s;
      this._x = (m13 + m31) / s;
      this._y = (m23 + m32) / s;
      this._z = 0.25 * s;
    }
    this._changed();
    return this;
  }

  // The shortest turn from one unit vector to another; between opposite ones,
  // half a turn about an axis across `from`.
  setFromUnitVectors(from, to) {
    let r = from.dot(to) + 1;
    if (r < 1e-8) {
      r = 0;
      if (Math.abs(from.x) > Math.abs(from.z)) {
        this._x = -from.y;
        this._y = from.x;
        this._z = 0;
        this._w = r;
      } else {
        this._x = 0;
        this._y = -from.z;
        this._z = from.y;
        this._w = r;
      }
    } else {
      this._x = from.y * to.z - from.z * to.y;
      this._y = from.z * to.x - from.x * to.z;
      this._z = from.x * to.y - from.y * to.x;
      this._w = r;
    }
    return this.normalize();
  }

  // This turn, then q's turn in its frame: this × q.
  multiply(q) {
    return this.multiplyQuaternions(this, q);
  }

  multiplyQuaternions(a, b) {
    const qax = a._x, qay = a._y, qaz = a._z, qaw = a._w;
    const qbx = b._x, qby = b._y, qbz = b._z, qbw = b._w;
    this._x = qax * qbw + qaw * qbx + qay * qbz - qaz * qby;
    this._y = qay * qbw + qaw * qby + qaz * qbx - qax * qbz;
    this._z = qaz * qbw + qaw * qbz + qax * qby - qay * qbx;
    this._w = qaw * qbw - qax * qbx - qay * qby - qaz * qbz;
    this._changed();
    return this;
  }

  length() {
    return Math.sqrt(this._x * this._x + this._y * this._y + this._z * this._z + this._w * this._w);
  }

  // A zero quaternion becomes no turn.
  normalize() {
    let l = this.length();
    if (l === 0) {
      this._x = 0;
      this._y = 0;
      this._z = 0;
      this._w = 1;
    } else {
      l = 1 / l;
      this._x = this._x * l;
      this._y = this._y * l;
      this._z = this._z * l;
      this._w = this._w * l;
    }
    this._changed();
    return this;
  }
}
