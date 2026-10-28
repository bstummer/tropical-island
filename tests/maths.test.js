// The maths of src/maths/, which the game took from three.js, whose results
// the pictures were made with (PLAN.md Stage 4c). Each case set gives three.js
// r186's answers to the last bit: tests/fixtures/maths/three-answers.json
// holds a hash of them per set. The cases come from a seeded generator of the
// test's own, plus the inputs that take every branch: zero vectors, opposite
// directions, gimbal lock, singular matrices, exact ties, half floats out of
// range and below the smallest normal. With three.js at hand (npm i --no-save
// three@0.186.1), THREE_MATHS=compare runs every case on both and names the
// first number that differs, and THREE_MATHS=record records three.js's answers
// again.
//
// The answers hold on any engine whose Math.sin, cos, tan, asin and atan2 give
// what V8's have since 2016: the inputs are made without Math.pow or **, whose
// results V8 changed in Node 24, and the one result made with Math.pow (the
// sRGB curve) is held to three.js's formula by a test of its own instead.
//
// The tests after them hold the maths to what it should do, without three.js.
import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import * as maths from '../src/maths/index.js';

const ANSWERS = new URL('./fixtures/maths/three-answers.json', import.meta.url);
const N = 200; // random cases per set
const ORDERS = ['XYZ', 'YXZ'];

// Numbers in [0, 1) for a name, from integer arithmetic alone (sfc32), so the
// recorded answers depend on nothing but the maths.
function stream(name) {
  let h = 1779033703;
  for (const c of name) h = Math.imul(h ^ c.charCodeAt(0), 3432918353) ^ (h >>> 13);
  let [a, b, c, d] = [h ^ 0x9e3779b9, h ^ 0x243f6a88, h ^ 0xb7e15162, h];
  const next = () => {
    let t = (a + b) | 0;
    a = b ^ (b >>> 9);
    b = (c + (c << 3)) | 0;
    c = (c << 21) | (c >>> 11);
    d = (d + 1) | 0;
    t = (t + d) | 0;
    c = (c + t) | 0;
    return (t >>> 0) / 4294967296;
  };
  for (let k = 0; k < 15; k++) next();
  return { next, range: (min, max) => min + (max - min) * next(), int: (min, max) => min + Math.floor(next() * (max - min + 1)), chance: (p) => next() < p };
}

// The maths as the cases call it, on either side.
const ours = {
  ...maths,
  perspective: (m, ...args) => m.makePerspective(...args),
  frustumFrom: (frustum, m) => frustum.setFromProjectionMatrix(m),
  onChange: (o, fn) => o.onChange(fn),
};
function threeMaths(T) {
  const { Vector2, Vector3, Vector4, Matrix3, Matrix4, Quaternion, Euler, Box3, Sphere, Frustum, Color, MathUtils, DataUtils } = T;
  return {
    ...{ Vector2, Vector3, Vector4, Matrix3, Matrix4, Quaternion, Euler, Box3, Sphere, Frustum, Color },
    ...{ DEG2RAD: MathUtils.DEG2RAD, degToRad: MathUtils.degToRad, radToDeg: MathUtils.radToDeg, clamp: MathUtils.clamp },
    ...{ toHalfFloat: DataUtils.toHalfFloat, fromHalfFloat: DataUtils.fromHalfFloat },
    perspective: (m, l, r, t, b, n, f) => m.makePerspective(l, r, t, b, n, f, undefined, true), // as core/camera.js called it
    frustumFrom: (frustum, m) => frustum.setFromProjectionMatrix(m, T.WebGPUCoordinateSystem, true),
    onChange: (o, fn) => o._onChange(fn),
  };
}

// Inputs as plain numbers, the same on either side.
function inputs(r) {
  const num = (s = 10) => r.range(-s, s);
  const unit = () => {
    for (;;) {
      const [x, y, z] = [num(1), num(1), num(1)];
      const l = Math.sqrt(x * x + y * y + z * z);
      if (l > 0.1) return [x / l, y / l, z / l];
    }
  };
  const angle = () => r.range(-Math.PI, Math.PI);
  const rotation = () => {
    const [x, y, z] = unit();
    const half = angle() / 2;
    return [x * Math.sin(half), y * Math.sin(half), z * Math.sin(half), Math.cos(half)];
  };
  const elements = (n) => Array.from({ length: n }, () => num());
  return { r, num, unit, angle, rotation, elements };
}

// A matrix placed, turned and scaled, as a node's; unscaled, a pure move and turn.
function placed(M, { num, rotation }, scaled = true) {
  const scale = scaled ? [num(3), num(3), num(3)] : [1, 1, 1];
  return new M.Matrix4().compose(new M.Vector3(num(50), num(50), num(50)), new M.Quaternion(...rotation()), new M.Vector3(...scale));
}

// Whether a half float's bits are a NaN's: every exponent bit set, and a mantissa bit.
const isHalfNaN = (h) => (h & 0x7c00) === 0x7c00 && (h & 0x3ff) !== 0;

// A camera's projection, as core/camera.js makes it, now and then off-centre.
function projection(M, { r }) {
  const [fov, aspect, near] = [r.range(20, 120), r.range(0.5, 3), r.range(0.01, 2)];
  const far = near * [10, 1e3, 1e5, 1e7][r.int(0, 3)] * r.range(1, 10);
  const top = near * Math.tan((Math.PI / 180) * 0.5 * fov);
  const [height, width] = [2 * top, aspect * 2 * top];
  const left = -0.5 * width + (r.chance(0.3) ? r.range(-0.2, 0.2) * width : 0);
  return M.perspective(new M.Matrix4(), left, left + width, top, top - height, near, far);
}

const CASES = {
  scalars(M, i, put) {
    put(M.DEG2RAD);
    for (let k = 0; k < N; k++) {
      const x = i.num(400);
      put(M.degToRad(x), M.radToDeg(x), M.clamp(x, -100, 150), M.clamp(x, 0, 0));
    }
    for (const x of [0, -0, 90, -90, 180, 360, Infinity, -Infinity, NaN]) put(M.degToRad(x), M.radToDeg(x), M.clamp(x, -1, 1), M.clamp(x, 1, -1));
  },

  // A NaN's payload is the engine's and the CPU's to keep or drop on the way
  // through a 32-bit float, so of a NaN's half float only its being one counts.
  'half floats from numbers'(M, { r }, put) {
    const word = new DataView(new ArrayBuffer(4));
    const float = (bits) => (word.setUint32(0, bits >>> 0), word.getFloat32(0));
    const half = (x) => (Number.isNaN(x) ? isHalfNaN(M.toHalfFloat(x)) : M.toHalfFloat(x));
    // Every sign and exponent, with mantissas at the edges of what a half float keeps.
    const mantissas = [0, 1, 0xfff, 0x1000, 0x1fff, 0x2000, 0x3fffff, 0x400000, 0x7fffff];
    for (let e = 0; e < 512; e++) for (const m of [...mantissas, r.int(0, 0x7fffff), r.int(0, 0x7fffff)]) put(half(float((e << 23) | m)));
    // Numbers that round on the way to 32 bits, too.
    for (let k = 0; k < N; k++) put(M.toHalfFloat(r.range(-70000, 70000)), M.toHalfFloat(r.range(-1, 1)), M.toHalfFloat(r.range(-1e-4, 1e-4)), M.toHalfFloat(r.range(-1e-7, 1e-7)));
    // 2^-24, 2^-25, 2^-14 and just under it, as literals (no Math.pow).
    for (const x of [0, -0, 65504, -65504, 65505, 65519.99, 65520, 1e9, Infinity, -Infinity, NaN, 5.9604644775390625e-8, 2.98023223876953125e-8, 6.103515625e-5, 6.103515625e-5 - 9.313225746154785e-10, 1 / 3]) {
      put(half(x));
    }
    put(console.warn.mock.callCount()); // a warning for each number out of range
  },

  // (A NaN's bits once written to a Float32Array are the engine's to choose, so only values count.)
  'half floats to numbers'(M, i, put) {
    for (let h = 0; h < 65536; h++) put(M.fromHalfFloat(h));
  },

  'Vector3 arithmetic'(M, i, put) {
    const { num, r } = i;
    const v3 = () => new M.Vector3(num(), num(), num());
    for (let k = 0; k < N; k++) {
      const [a, b, s] = [v3(), v3(), num()];
      put(a.clone().add(b), a.clone().sub(b), a.clone().addScaledVector(b, s), new M.Vector3().addVectors(a, b), new M.Vector3().subVectors(a, b));
      put(a.clone().multiplyScalar(s), a.clone().min(b), a.clone().max(b), a.dot(b), a.clone().cross(b), new M.Vector3().crossVectors(a, b));
      put(a.lengthSq(), a.length(), a.clone().normalize(), a.clone().lerp(b, r.next()), a.distanceTo(b), a.distanceToSquared(b));
      put(new M.Vector3().copy(a), new M.Vector3(1, 2, 3).set(s, 2 * s), new M.Vector3(1, 2, 3).set(s, s, s), new M.Vector3().setScalar(s));
      const array = i.elements(5);
      put(new M.Vector3().fromArray(array), new M.Vector3().fromArray(array, 2), ...a.toArray(), ...a.toArray([7, 7, 7, 7, 7], 1));
    }
    put(new M.Vector3(), new M.Vector3().normalize(), new M.Vector3(0, -0, 0).normalize(), new M.Vector3(1e-200, 0, 0).normalize(), new M.Vector3(1e200, 1e200, 0).normalize());
  },

  'Vector3 through matrices'(M, i, put) {
    const { num } = i;
    for (let k = 0; k < N; k++) {
      const m4 = new M.Matrix4().set(...i.elements(16));
      const m3 = new M.Matrix3().set(...i.elements(9));
      const v = () => new M.Vector3(num(100), num(100), num(100));
      put(v().applyMatrix4(m4), v().applyMatrix4(placed(M, i)), v().applyMatrix3(m3), v().applyNormalMatrix(m3), new M.Vector3().setFromMatrixPosition(m4));
      const camera = { matrixWorldInverse: placed(M, i, false).invert(), projectionMatrix: projection(M, i) };
      put(v().project(camera));
    }
    put(new M.Vector3(1, 2, 3).applyNormalMatrix(new M.Matrix3().set(0, 0, 0, 0, 0, 0, 0, 0, 0)));
  },

  'Vector3 turned'(M, i, put) {
    for (let k = 0; k < N; k++) {
      const v = () => new M.Vector3(i.num(), i.num(), i.num());
      put(v().applyQuaternion(new M.Quaternion(...i.rotation())), v().applyAxisAngle(new M.Vector3(...i.unit()), i.angle()));
      for (const order of ORDERS) put(v().applyEuler(new M.Euler(i.angle(), i.angle(), i.angle(), order)));
    }
  },

  'Vector2 and Vector4'(M, i, put) {
    const { num } = i;
    for (let k = 0; k < N; k++) {
      const array = i.elements(5);
      const a = new M.Vector2(num(), num());
      put(a.clone(), new M.Vector2().fromArray(array), new M.Vector2().fromArray(array, 3), new M.Vector2());
      const b = new M.Vector4(num(), num(), num(), num());
      put(b.clone(), new M.Vector4().set(num(), num(), num(), num()), new M.Vector4().copy(b), new M.Vector4(1, 2, 3, 4).copy(new M.Vector3(num(), num(), num())), new M.Vector4());
      put(b.clone().applyMatrix4(new M.Matrix4().set(...i.elements(16))), new M.Vector4().copy(new M.Vector3(num(), num(), num())).applyMatrix4(projection(M, i)));
    }
  },

  'Quaternion made'(M, i, put) {
    for (let k = 0; k < N; k++) {
      for (const order of ORDERS) {
        const euler = new M.Euler(i.angle(), i.angle(), i.angle(), order);
        put(new M.Quaternion().setFromEuler(euler), new M.Quaternion().setFromEuler(euler, false));
      }
      put(new M.Quaternion().setFromAxisAngle(new M.Vector3(...i.unit()), i.angle()));
      put(new M.Quaternion().setFromRotationMatrix(placed(M, i, false)));
      const [from, to] = [new M.Vector3(...i.unit()), new M.Vector3(...i.unit())];
      put(new M.Quaternion().setFromUnitVectors(from, to), new M.Quaternion().setFromUnitVectors(from, from), new M.Quaternion().setFromUnitVectors(from, from.clone().multiplyScalar(-1)));
    }
    // Every branch of setFromRotationMatrix: large turns about axes near x, y and z, and half turns.
    const turned = (axis, angle) => new M.Matrix4().makeRotationFromQuaternion(new M.Quaternion().setFromAxisAngle(new M.Vector3(...axis), angle));
    for (const k of [0, 1, 2]) {
      for (let n = 0; n < N / 4; n++) {
        const axis = i.unit().map((a, j) => (j === k ? 3 : 0) + a);
        const l = Math.sqrt(axis[0] * axis[0] + axis[1] * axis[1] + axis[2] * axis[2]);
        put(new M.Quaternion().setFromRotationMatrix(turned(axis.map((a) => a / l), i.r.range(2.2, Math.PI))));
      }
    }
    for (const axis of [[1, 0, 0], [0, 1, 0], [0, 0, 1], i.unit()]) {
      for (const angle of [Math.PI, Math.PI - 1e-3, -Math.PI + 1e-6, 0, 1e-9]) put(new M.Quaternion().setFromRotationMatrix(turned(axis, angle)));
    }
    // Ties between the diagonal's entries, with no positive trace.
    for (const [a, b, c] of [[-0.2, -0.2, -0.9], [-0.2, -0.9, -0.2], [-0.9, -0.2, -0.2], [-0.5, -0.5, -0.5], [0, 0, 0]]) {
      const [p, q, r, s, t, u] = i.elements(6).map((x) => x / 20);
      put(new M.Quaternion().setFromRotationMatrix(new M.Matrix4().set(a, p, q, 0, r, b, s, 0, t, u, c, 0, 0, 0, 0, 1)));
    }
    // Opposite directions, about an axis across either way.
    for (const [x, y, z] of [[1, 0, 0], [0, 0, 1], [0.6, 0.8, 0], [0, 0.8, 0.6], [0.6, 0, 0.8], [-0.8, 0, 0.6], [0, 1, 0], [0, -1, 0]]) {
      put(new M.Quaternion().setFromUnitVectors(new M.Vector3(x, y, z), new M.Vector3(-x, -y, -z)));
    }
    // Nearly opposite: either side of where it counts them as opposite (θ² / 2 < 1e-8).
    for (const angle of [1e-5, 1e-4, 1.4e-4, 1.5e-4, 5e-4, 1e-3, 2e-3]) {
      put(new M.Quaternion().setFromUnitVectors(new M.Vector3(1, 0, 0), new M.Vector3(-Math.cos(angle), Math.sin(angle), 0)));
    }
  },

  'Quaternion arithmetic'(M, i, put) {
    const { num } = i;
    for (let k = 0; k < N; k++) {
      const [a, b] = [new M.Quaternion(...i.rotation()), new M.Quaternion(...i.rotation())];
      put(new M.Quaternion().copy(a).multiply(b), new M.Quaternion().multiplyQuaternions(a, b), a.length());
      put(new M.Quaternion(num(), num(), num(), num()).normalize(), new M.Quaternion().set(...i.rotation()), new M.Quaternion().fromArray([0, ...i.rotation()], 1));
      const q = new M.Quaternion();
      [q.x, q.y, q.z, q.w] = [num(), num(), num(), num()];
      put(q);
    }
    put(new M.Quaternion(), new M.Quaternion(0, 0, 0, 0).normalize(), new M.Quaternion(0, 0, 0, 0).length());
  },

  // When a quaternion or angles call the function given to onChange, and what
  // they hold by then (a node keeps the other in step from it, gpu/scene.js).
  'change calls'(M, i, put) {
    let [calls, seen, q, e] = [0, [], null, null];
    const counted = (o) => M.onChange(o, () => (calls++, (seen = [q?.x, q?.y, q?.z, q?.w, e?.x, e?.y, e?.z].map((v) => v ?? 0))));
    q = counted(new M.Quaternion());
    const euler = new M.Euler(i.angle(), i.angle(), i.angle(), 'YXZ');
    const turn = placed(M, i, false);
    const steps = [
      () => q.set(...i.rotation()),
      () => q.copy(new M.Quaternion(...i.rotation())),
      () => q.fromArray(i.rotation()),
      () => q.setFromEuler(euler),
      () => q.setFromEuler(euler, false),
      () => q.setFromEuler(euler, 1), // true only calls it
      () => q.setFromAxisAngle(new M.Vector3(...i.unit()), 1),
      () => q.setFromRotationMatrix(turn),
      () => q.setFromUnitVectors(new M.Vector3(...i.unit()), new M.Vector3(...i.unit())),
      () => q.multiply(new M.Quaternion(...i.rotation())),
      () => q.multiplyQuaternions(new M.Quaternion(...i.rotation()), q),
      () => q.normalize(),
      () => q.length(),
      () => (q.x = 0.5),
      () => (q.y = 0.5),
      () => (q.z = 0.5),
      () => (q.w = 0.5),
    ];
    e = counted(new M.Euler());
    steps.push(
      () => e.set(1, 2, 3),
      () => e.set(1, 2, 3, 'YXZ'),
      () => e.copy(euler),
      () => e.setFromRotationMatrix(turn),
      () => e.setFromRotationMatrix(turn, 'XYZ', false),
      () => e.setFromRotationMatrix(turn, 'YXZ', 'yes'),
      () => e.setFromQuaternion(q),
      () => e.setFromQuaternion(q, undefined, false),
      () => e.setFromQuaternion(q, 'YXZ'),
      () => e.setFromQuaternion(q, 'XYZ', 0),
      () => (e.x = 1),
      () => (e.y = 1),
      () => (e.z = 1),
      () => (e.order = 'XYZ'),
    );
    for (const step of steps) {
      step();
      put(calls, ...seen, q, e);
    }
  },

  Euler(M, i, put) {
    const order = (e) => ORDERS.indexOf(e.order);
    for (let k = 0; k < N; k++) {
      const turn = placed(M, i, false);
      const q = new M.Quaternion(...i.rotation());
      for (const o of ORDERS) {
        const [a, b, c, d] = [new M.Euler().setFromRotationMatrix(turn, o), new M.Euler(0, 0, 0, o).setFromQuaternion(q), new M.Euler().setFromQuaternion(q, o), new M.Euler(1, 2, 3, o).copy(new M.Euler(i.angle(), i.angle(), i.angle(), 'YXZ'))];
        put(a, order(a), b, order(b), c, order(c), d, order(d));
      }
      const e = new M.Euler();
      e.set(i.angle(), i.angle(), i.angle());
      put(e, order(e));
      e.set(i.angle(), i.angle(), i.angle(), 'YXZ');
      put(e, order(e));
      e.set(i.angle(), i.angle(), i.angle()); // keeps YXZ
      put(e, order(e));
    }
    // Gimbal lock: ±90° about the middle axis, and the matrix entry it comes from around the threshold.
    for (const o of ORDERS) {
      for (const s of [1, -1]) {
        const angles = o === 'XYZ' ? [i.angle(), (s * Math.PI) / 2, i.angle()] : [(s * Math.PI) / 2, i.angle(), i.angle()];
        put(new M.Euler().setFromQuaternion(new M.Quaternion().setFromEuler(new M.Euler(...angles, o)), o));
        for (const v of [0.9999999, 0.99999989, 1, 1.0000001]) {
          const m = new M.Matrix4().set(...i.elements(16));
          m.elements[o === 'XYZ' ? 8 : 9] = s * v;
          put(new M.Euler().setFromRotationMatrix(m, o));
        }
      }
    }
  },

  Matrix4(M, i, put) {
    for (let k = 0; k < N; k++) {
      const [a, b] = [new M.Matrix4().set(...i.elements(16)), placed(M, i)];
      put(new M.Matrix4().copy(a), new M.Matrix4().multiplyMatrices(a, b), new M.Matrix4().copy(b).premultiply(a), new M.Matrix4().copy(a).invert(), new M.Matrix4().copy(b).invert());
      put(a.getMaxScaleOnAxis(), b.getMaxScaleOnAxis(), new M.Matrix4().makeRotationX(i.angle()), new M.Matrix4().makeRotationFromQuaternion(new M.Quaternion(...i.rotation())));
      put(new M.Matrix4().compose(new M.Vector3(i.num(), i.num(), i.num()), new M.Quaternion(...i.rotation()), new M.Vector3(i.num(), i.num(), i.num())));
    }
    // Singular: a row of zeros, all zeros, two rows alike.
    const row = i.elements(4);
    put(new M.Matrix4().set(...i.elements(4), 0, 0, 0, 0, ...i.elements(8)).invert(), new M.Matrix4().set(...Array(16).fill(0)).invert());
    put(new M.Matrix4().set(...row, ...i.elements(4), ...row, ...i.elements(4)).invert());
  },

  'Matrix4 for cameras'(M, i, put) {
    const v = () => new M.Vector3(i.num(100), i.num(100), i.num(100));
    for (let k = 0; k < N; k++) {
      put(projection(M, i));
      const [left, bottom, near] = [i.num(), i.num(), i.r.range(0.001, 5)];
      put(M.perspective(new M.Matrix4(), left, left + i.r.range(0.1, 5), bottom + i.r.range(0.1, 5), bottom, near, near + i.r.range(1, 1e6)));
      put(new M.Matrix4().lookAt(v(), v(), new M.Vector3(...i.unit())));
    }
    // lookAt's branches: the eye at the target; up along the view, along z and not.
    put(new M.Matrix4().lookAt(new M.Vector3(1, 2, 3), new M.Vector3(1, 2, 3), new M.Vector3(0, 1, 0)));
    put(new M.Matrix4().lookAt(new M.Vector3(1, 2, 3), new M.Vector3(1, 2, 3), new M.Vector3(0, 0, 1)));
    put(new M.Matrix4().lookAt(new M.Vector3(0, 0, 5), new M.Vector3(0, 0, 0), new M.Vector3(0, 0, 1)));
    put(new M.Matrix4().lookAt(new M.Vector3(0, 0, 5), new M.Vector3(0, 0, 0), new M.Vector3(0, 0, -1)));
    put(new M.Matrix4().lookAt(new M.Vector3(0, 5, 0), new M.Vector3(0, 0, 0), new M.Vector3(0, 1, 0)));
  },

  Matrix3(M, i, put) {
    for (let k = 0; k < N; k++) {
      const values = i.elements(9);
      const [general, node] = [new M.Matrix4().set(...i.elements(16)), placed(M, i)];
      put(new M.Matrix3(), new M.Matrix3().set(...values), new M.Matrix3().set(...values).invert(), new M.Matrix3().set(...values).transpose());
      put(new M.Matrix3().setFromMatrix4(general), new M.Matrix3().getNormalMatrix(general), new M.Matrix3().getNormalMatrix(node));
    }
    put(new M.Matrix3().set(1, 2, 3, 0, 0, 0, 4, 5, 6).invert(), new M.Matrix3().set(0, 0, 0, 0, 0, 0, 0, 0, 0).invert());
  },

  'Box3 and Sphere'(M, i, put) {
    const v = () => new M.Vector3(i.num(), i.num(), i.num());
    for (let k = 0; k < N; k++) {
      const box = new M.Box3();
      put(box.min, box.max, box.isEmpty(), box.getCenter(new M.Vector3(9, 9, 9)));
      const points = i.r.int(1, 5);
      for (let p = 0; p < points; p++) box.expandByPoint(v());
      put(box.min, box.max, box.isEmpty(), box.getCenter(new M.Vector3()));
      box.makeEmpty();
      put(box.min, box.max, box.isEmpty());
      const sphere = new M.Sphere(v(), i.r.range(0, 5));
      const moved = new M.Sphere().copy(sphere).applyMatrix4(placed(M, i));
      put(moved.center, moved.radius, new M.Sphere().center, new M.Sphere().radius);
    }
  },

  Frustum(M, i, put) {
    const look = (frustum, k) => {
      for (const plane of frustum.planes) put(plane.normal, plane.constant);
      for (let s = 0; s < k; s++) {
        put(frustum.intersectsSphere(new M.Sphere(new M.Vector3(i.num(100), i.num(100), i.num(100)), i.r.range(0, 30))));
        const box = new M.Box3();
        for (let p = 0; p < 2; p++) box.expandByPoint(new M.Vector3(i.num(100), i.num(100), i.num(100)));
        put(frustum.intersectsBox(box));
      }
    };
    for (let k = 0; k < N; k++) {
      const viewProjection = new M.Matrix4().multiplyMatrices(projection(M, i), placed(M, i, false).invert());
      const frustum = M.frustumFrom(new M.Frustum(), viewProjection);
      look(frustum, 20);
      // Spheres reaching just to each plane, from a point in view: inside by a hair, and outside.
      const inside = new M.Vector3(0, 0, 0.5).applyMatrix4(new M.Matrix4().copy(viewProjection).invert());
      for (const plane of frustum.planes) {
        const onPlane = inside.clone().addScaledVector(plane.normal, -plane.distanceToPoint(inside));
        const radius = i.r.range(0.01, 10);
        for (const reach of [1 - 4e-8, 1 + 4e-8]) put(frustum.intersectsSphere(new M.Sphere(onPlane.clone().addScaledVector(plane.normal, -radius * reach), radius)));
      }
    }
    // Looking straight along -z, so planes' normals have zero components.
    look(M.frustumFrom(new M.Frustum(), projection(M, i)), 200);
    put(M.frustumFrom(new M.Frustum(), projection(M, i)).intersectsBox(new M.Box3()));
    // The identity's frustum: x and y from -1 to 1, depth from 0 to 1, planes exactly
    // representable, so spheres and boxes can touch them exactly (ties), and boxes
    // reaching to infinity along an axis a plane's normal has no part of.
    const cube = M.frustumFrom(new M.Frustum(), new M.Matrix4());
    for (const [x, y, z, radius] of [[2, 0, 0.5, 1], [0, -1.5, 0.5, 0.5], [0, 0, -0.25, 0.25], [0, 0, 1.5, 0.5], [2, 0, 0.5, 0.999], [0, 0, 1, 0]]) {
      put(cube.intersectsSphere(new M.Sphere(new M.Vector3(x, y, z), radius)));
    }
    for (const [min, max] of [[[1, 0, 0], [2, 1, 1]], [[1.5, 0, 0], [2, 1, 1]], [[0, 0, -1], [1, 1, 0]], [[0, 0, 1], [1, 1, 2]], [[2, 0, 0.5], [3, Infinity, 0.6]], [[-Infinity, 2, 0], [0, 3, 1]]]) {
      put(cube.intersectsBox(new M.Box3().expandByPoint(new M.Vector3(...min)).expandByPoint(new M.Vector3(...max))));
    }
  },

  // NaN, infinities and -0 wherever they can go: three.js's answers, whatever they are.
  'non-finite inputs'(M, i, put) {
    const odd = [NaN, Infinity, -Infinity, -0, 0, 1e308, -1e-320];
    for (const x of odd) {
      const v = () => new M.Vector3(x, i.num(), -x);
      const m4 = new M.Matrix4().set(...i.elements(15), x);
      const m4b = new M.Matrix4().set(x, ...i.elements(15));
      put(v().normalize(), v().applyMatrix4(m4), v().applyQuaternion(new M.Quaternion(x, 0, 0, 1)), v().lerp(new M.Vector3(1, 2, 3), x), v().min(new M.Vector3()), v().max(new M.Vector3()));
      put(v().distanceTo(new M.Vector3()), v().applyNormalMatrix(new M.Matrix3().set(...i.elements(8), x)), new M.Vector4(x, 1, 2, 3).applyMatrix4(m4b));
      put(new M.Matrix4().copy(m4).invert(), new M.Matrix4().copy(m4b).invert(), new M.Matrix4().multiplyMatrices(m4, m4b), m4b.getMaxScaleOnAxis(), new M.Matrix3().set(x, ...i.elements(8)).invert());
      put(new M.Quaternion().setFromRotationMatrix(m4b), new M.Quaternion(x, 1, 2, 3).normalize(), new M.Quaternion().setFromUnitVectors(v(), new M.Vector3(0, 1, 0)), new M.Quaternion().setFromAxisAngle(new M.Vector3(0, 1, 0), x));
      for (const o of ORDERS) put(new M.Euler().setFromRotationMatrix(m4b, o), new M.Euler().setFromRotationMatrix(new M.Matrix4().set(1, 0, x, 0, 0, 1, x, 0, x, x, 1, 0, 0, 0, 0, 1), o));
      put(new M.Quaternion().setFromEuler(new M.Euler(x, 1, -x, 'YXZ')), new M.Matrix4().makeRotationX(x), new M.Matrix4().compose(v(), new M.Quaternion(x, 0, 0, 1), v()));
      put(new M.Matrix4().lookAt(v(), new M.Vector3(), new M.Vector3(0, 1, 0)), M.perspective(new M.Matrix4(), -1, 1, 1, -1, 0.1, x));
      const box = new M.Box3().expandByPoint(v()).expandByPoint(new M.Vector3(1, 2, 3));
      put(box.min, box.max, box.isEmpty(), box.getCenter(new M.Vector3()));
      const frustum = M.frustumFrom(new M.Frustum(), m4b);
      for (const plane of frustum.planes) put(plane.normal, plane.constant);
      put(frustum.intersectsSphere(new M.Sphere(v(), 1)), frustum.intersectsSphere(new M.Sphere(new M.Vector3(), x)), frustum.intersectsBox(box));
      put(new M.Sphere(v(), 2).applyMatrix4(m4b).radius, new M.Color(x, -x, 0.5));
    }
    // A box empty along one axis only.
    const flat = new M.Box3().expandByPoint(new M.Vector3(1, 2, 3)).expandByPoint(new M.Vector3(4, 5, 6));
    flat.min.y = 9;
    put(flat.isEmpty(), flat.getCenter(new M.Vector3(7, 7, 7)));
  },

  // Channels of 10/255 and less, on the sRGB curve's straight part: above it, the
  // curve takes Math.pow, the engine's (its own test, after these).
  Color(M, i, put) {
    for (let k = 0; k < N; k++) {
      const hex = (i.r.int(0, 10) << 16) | (i.r.int(0, 10) << 8) | i.r.int(0, 10);
      const style = `#${hex.toString(16).padStart(6, '0')}`;
      put(new M.Color(hex), new M.Color(style), new M.Color(style.toUpperCase()), new M.Color(i.r.next(), i.r.next(), i.r.next()));
      const c = new M.Color(i.r.next(), i.r.next(), i.r.next());
      put(new M.Color(c), new M.Color().copy(c), new M.Color(0).setHex(hex + i.r.next()), new M.Color(hex + 0x1000000 * i.r.int(1, 100)));
      put(new M.Color().setRGB(i.num(), i.num(), i.num()));
    }
    put(new M.Color(), new M.Color(0), new M.Color('#000000'), new M.Color(0x0a0a0a), new M.Color(0x0a0a0a + 0.9));
  },
};

// The numbers a case set gives, in order.
function answers(M, name) {
  console.warn.mock?.resetCalls();
  const out = [];
  const put = (...values) => {
    for (const v of values) {
      if (typeof v === 'number' || typeof v === 'boolean') out.push(Number(v));
      else if (v?.elements) out.push(...v.elements);
      else if (v?.isColor) out.push(v.r, v.g, v.b);
      else if (v && 'x' in v) out.push(...['x', 'y', 'z', 'w'].filter((k) => k in v).map((k) => v[k]));
      else throw new Error(`maths test: can't put ${v}`);
    }
  };
  CASES[name](M, inputs(stream(name)), put);
  return out;
}

// How many numbers, and a hash of their bits (one NaN for all NaNs).
function digest(numbers) {
  const bits = Float64Array.from(numbers, (x) => (Number.isNaN(x) ? NaN : x));
  return `${numbers.length}:${createHash('sha256').update(new Uint8Array(bits.buffer)).digest('hex').slice(0, 16)}`;
}

const mode = process.env.THREE_MATHS; // 'compare' or 'record', with three.js installed
const T = mode ? await import('three') : null;
const three = T && threeMaths(T);
const recorded = mode === 'record' ? { three: `r${T.REVISION}`, engine: `V8 ${process.versions.v8}`, answers: {} } : mode ? null : JSON.parse(readFileSync(ANSWERS, 'utf8'));
if (mode === 'record') after(() => writeFileSync(ANSWERS, `${JSON.stringify(recorded, null, 2)}\n`));

for (const name of Object.keys(CASES)) {
  test(`${name}: three.js's answers, to the last bit`, (t) => {
    t.mock.method(console, 'warn', () => {});
    const got = answers(ours, name);
    if (three) {
      const want = answers(three, name);
      const k = want.findIndex((w, n) => !Object.is(w, got[n]));
      assert.equal(k, -1, `number ${k} is ${got[k]}, three.js's ${want[k]}`);
      assert.equal(got.length, want.length);
      if (mode === 'record') recorded.answers[name] = digest(want);
    } else {
      assert.equal(digest(got), recorded.answers[name], `not three.js's answers (${recorded.three}, recorded on ${recorded.engine}, running on V8 ${process.versions.v8}); THREE_MATHS=compare with three.js installed says where`);
    }
  });
}

test('the recorded answers are for these case sets', { skip: Boolean(mode) }, () => {
  assert.deepEqual(Object.keys(recorded.answers).sort(), Object.keys(CASES).sort());
});

// ---------------------------------------------------------------- what the maths should do

const { Vector3, Quaternion, Euler, Matrix3, Matrix4, Box3, Sphere, Frustum, Color } = maths;
const near = (a, b, tolerance, message) => assert.ok(Math.abs(a - b) <= tolerance, `${message}: ${a} vs ${b}`);
const random = () => inputs(stream('properties'));

test('an inverse undoes its matrix', () => {
  const i = random();
  for (let k = 0; k < 200; k++) {
    const m = placed(maths, i);
    const product = new Matrix4().multiplyMatrices(m, new Matrix4().copy(m).invert()).elements;
    product.forEach((e, n) => near(e, n % 5 === 0 ? 1 : 0, 1e-6, `4×4 element ${n}`));
    const m3 = new Matrix3().setFromMatrix4(m);
    const inverse = new Matrix3().setFromMatrix4(m).invert();
    const p = new Vector3(i.num(), i.num(), i.num());
    const back = p.clone().applyMatrix3(m3).applyMatrix3(inverse);
    for (const axis of ['x', 'y', 'z']) near(back[axis], p[axis], 1e-6, `3×3 on ${axis}`);
  }
});

test('a normal matrix keeps normals square to their surface', () => {
  const i = random();
  for (let k = 0; k < 200; k++) {
    const m = placed(maths, i);
    const normal = new Vector3(...i.unit());
    const along = new Vector3(...i.unit()).cross(normal); // in the surface
    const moved = along.clone().applyMatrix3(new Matrix3().setFromMatrix4(m));
    const turned = normal.clone().applyNormalMatrix(new Matrix3().getNormalMatrix(m));
    near(turned.length(), 1, 1e-12, 'unit length');
    near(turned.dot(moved) / (moved.length() || 1), 0, 1e-9, 'square to the surface');
  }
});

test('angles turned into a rotation and back come out the same', () => {
  const i = random();
  for (const order of ORDERS) {
    for (let k = 0; k < 200; k++) {
      const middle = i.r.range(-1.5, 1.5); // short of ±90°, where the first and last axes line up
      const angles = order === 'XYZ' ? [i.angle(), middle, i.angle()] : [middle, i.angle(), i.angle()];
      const back = new Euler().setFromQuaternion(new Quaternion().setFromEuler(new Euler(...angles, order)), order);
      ['x', 'y', 'z'].forEach((axis, n) => near(back[axis], angles[n], 1e-9, `${order} ${axis}`));
    }
  }
});

test('a quaternion turns a point as its matrix does, and from one direction to another', () => {
  const i = random();
  for (let k = 0; k < 200; k++) {
    const q = new Quaternion(...i.rotation());
    const p = new Vector3(i.num(), i.num(), i.num());
    const [a, b] = [p.clone().applyQuaternion(q), p.clone().applyMatrix4(new Matrix4().makeRotationFromQuaternion(q))];
    for (const axis of ['x', 'y', 'z']) near(a[axis], b[axis], 1e-12, `turned ${axis}`);
    const from = new Vector3(...i.unit());
    for (const to of [new Vector3(...i.unit()), from.clone().multiplyScalar(-1)]) {
      const turned = from.clone().applyQuaternion(new Quaternion().setFromUnitVectors(from, to));
      for (const axis of ['x', 'y', 'z']) near(turned[axis], to[axis], 1e-12, `from one direction to another, ${axis}`);
    }
  }
});

test('Euler angles turn the camera as yaw, then pitch', () => {
  const [yaw, pitch] = [0.7, -0.3];
  const forward = new Vector3(0, 0, -1).applyEuler(new Euler(pitch, yaw, 0, 'YXZ'));
  near(Math.atan2(-forward.x, -forward.z), yaw, 1e-12, 'yaw');
  near(Math.asin(forward.y), pitch, 1e-12, 'pitch');
});

test('lookAt turns -z towards the target', () => {
  const i = random();
  for (let k = 0; k < 200; k++) {
    const [eye, target] = [new Vector3(i.num(), i.num(), i.num()), new Vector3(i.num(), i.num(), i.num())];
    const m = new Matrix4().lookAt(eye, target, new Vector3(0, 1, 0)).elements;
    const towards = target.clone().sub(eye).normalize();
    near(-m[8] * towards.x - m[9] * towards.y - m[10] * towards.z, 1, 1e-9, '-z on the target');
    near(m[1], 0, 1e-12, 'x stays level');
    assert.ok(m[5] >= 0, 'the image stays upright');
  }
});

test('the projection has reversed depth, and the frustum culls what is outside it', () => {
  const camera = new Matrix4().makePerspective(-1, 1, 1, -1, 1, 1000); // 45° each way from the axis
  const depth = (z) => new Vector3(0, 0, z).applyMatrix4(camera).z;
  near(depth(-1), 1, 1e-12, 'near');
  near(depth(-1000), 0, 1e-12, 'far');
  assert.ok(depth(-10) > depth(-100), 'nearer is deeper');
  const frustum = new Frustum().setFromProjectionMatrix(camera);
  const sphere = (x, y, z, radius = 1) => frustum.intersectsSphere(new Sphere(new Vector3(x, y, z), radius));
  assert.ok(sphere(0, 0, -10), 'ahead');
  for (const [x, y, z] of [[-20, 0, -10], [20, 0, -10], [0, -20, -10], [0, 20, -10], [0, 0, 5], [0, 0, -1100]]) assert.ok(!sphere(x, y, z), `outside at ${[x, y, z]}`);
  assert.ok(sphere(-11, 0, -10, 2), 'reaching in from the left');
  const box = (min, max) => frustum.intersectsBox(Object.assign(new Box3(), { min: new Vector3(...min), max: new Vector3(...max) }));
  assert.ok(box([-1, -1, -11], [1, 1, -9]), 'a box ahead');
  assert.ok(!box([15, -1, -11], [17, 1, -9]), 'a box to the right');
  assert.ok(box([-100, -1, -11], [100, 1, -9]), 'a box across the view');
});

// three.js reads every input before it writes the target, so a target that is
// also an input (q.multiply(r), m.premultiply(n), v.cross(w), as the game calls
// them) comes out as a fresh one would; the recorded cases, made mostly with
// fresh targets, would miss a port that writes before it has read.
test('a target that is also an input comes out as a fresh one', () => {
  const i = random();
  const state = (o) => (o.elements ? [...o.elements] : ['x', 'y', 'z', 'w'].filter((k) => k in o).map((k) => o[k]));
  const kinds = [
    // A new one, a copy, the calls of the form t.f(a, b), and of the form t.f(a).
    [() => new Vector3(i.num(), i.num(), i.num()), (v) => v.clone(), [(t, a, b) => t.crossVectors(a, b), (t, a, b) => t.addVectors(a, b), (t, a, b) => t.subVectors(a, b)], [(t, a) => t.cross(a)]],
    [() => new Quaternion(i.num(), i.num(), i.num(), i.num()), (q) => new Quaternion().copy(q), [(t, a, b) => t.multiplyQuaternions(a, b)], [(t, a) => t.multiply(a)]],
    [() => new Matrix4().set(...i.elements(16)), (m) => new Matrix4().copy(m), [(t, a, b) => t.multiplyMatrices(a, b)], [(t, a) => t.premultiply(a)]],
  ];
  for (let k = 0; k < 50; k++) {
    for (const [make, copy, calls, selfCalls] of kinds) {
      const [a, b, fresh] = [make(), make(), make()];
      for (const call of calls) {
        const want = (x, y) => state(call(copy(fresh), x, y));
        let t = copy(a);
        assert.deepEqual(state(call(t, t, b)), want(a, b), `${call}, t = a`);
        t = copy(b);
        assert.deepEqual(state(call(t, a, t)), want(a, b), `${call}, t = b`);
        t = copy(a);
        assert.deepEqual(state(call(t, t, t)), want(a, a), `${call}, t = a = b`);
      }
      for (const call of selfCalls) {
        const t = copy(a);
        assert.deepEqual(state(call(t, t)), state(call(copy(a), copy(a))), `${call}, t = a`);
      }
    }
    // A box's centre written into one of its own corners.
    const points = [new Vector3(i.num(), i.num(), i.num()), new Vector3(i.num(), i.num(), i.num())];
    const box = () => points.reduce((b, p) => b.expandByPoint(p), new Box3());
    for (const corner of ['min', 'max']) {
      const b = box();
      assert.deepEqual(state(b.getCenter(b[corner])), state(box().getCenter(new Vector3())), `the centre into ${corner}`);
    }
  }
});

test('boxes and spheres', () => {
  const box = new Box3();
  assert.ok(box.isEmpty());
  assert.deepEqual(box.getCenter(new Vector3(1, 1, 1)).toArray(), [0, 0, 0]);
  box.expandByPoint(new Vector3(1, -2, 3)).expandByPoint(new Vector3(-1, 4, 5));
  assert.deepEqual([...box.min.toArray(), ...box.max.toArray()], [-1, -2, 3, 1, 4, 5]);
  assert.deepEqual(box.getCenter(new Vector3()).toArray(), [0, 1, 4]);
  const scale = new Matrix4().compose(new Vector3(1, 2, 3), new Quaternion(), new Vector3(2, 3, 0.5));
  const sphere = new Sphere(new Vector3(1, 0, 0), 2).applyMatrix4(scale);
  assert.deepEqual([...sphere.center.toArray(), sphere.radius], [3, 2, 3, 6]);
});

test('half floats keep exactly what they can hold and cut the rest towards zero', (t) => {
  const warn = t.mock.method(console, 'warn', () => {});
  for (let h = 0; h < 65536; h++) {
    const x = maths.fromHalfFloat(h);
    if (Number.isFinite(x)) assert.equal(maths.toHalfFloat(x), h, `half float ${h.toString(16)}`);
  }
  assert.equal(maths.toHalfFloat(1 + 1 / 1024), 0x3c01, 'one step above 1');
  assert.equal(maths.toHalfFloat(1 + 1 / 1024 * 0.99), 0x3c00, 'just short of it');
  assert.equal(maths.toHalfFloat(-(1 + 1 / 1024 * 0.99)), 0xbc00, 'negative, towards zero too');
  assert.ok(isHalfNaN(maths.toHalfFloat(NaN)), 'NaN stays NaN');
  assert.equal(warn.mock.callCount(), 0);
  assert.equal(maths.toHalfFloat(1e6), 0x7bff, 'clamped to the largest');
  assert.equal(maths.toHalfFloat(-Infinity), 0xfbff);
  assert.equal(warn.mock.callCount(), 2, 'a warning for each');
});

test("colours follow three.js's sRGB curve, as its ColorManagement (r186) has it", () => {
  // Stated here rather than recorded: it takes Math.pow, whose results are the engine's.
  const curve = (c) => (c < 0.04045 ? c * 0.0773993808 : Math.pow(c * 0.9478672986 + 0.0521327014, 2.4));
  for (let byte = 0; byte < 256; byte++) {
    const hex = (byte << 16) | ((255 - byte) << 8) | (byte ^ 0x5a);
    const colour = new Color(hex);
    assert.deepEqual([colour.r, colour.g, colour.b], [curve(byte / 255), curve((255 - byte) / 255), curve((byte ^ 0x5a) / 255)], `#${hex.toString(16)}`);
    const style = new Color(`#${hex.toString(16).padStart(6, '0')}`);
    assert.deepEqual([style.r, style.g, style.b], [colour.r, colour.g, colour.b], 'the same as a string');
  }
  const below = new Color(-0.5); // rounded down to -1 first: every bit set
  assert.deepEqual([below.r, below.g, below.b], [curve(1), curve(1), curve(1)]);
});

test('colours: sRGB hex made linear, three numbers kept', () => {
  const rgb = (c) => [c.r, c.g, c.b];
  assert.deepEqual(rgb(new Color('#000000')), [0, 0, 0]);
  for (const c of rgb(new Color(0xffffff))) near(c, 1, 1e-9, 'white');
  near(new Color(0x808080).r, 0.2158605, 1e-6, 'mid grey');
  assert.deepEqual(rgb(new Color('#2bB3bd')), rgb(new Color(0x2bb3bd)));
  assert.deepEqual(rgb(new Color(0.1, 0.2, 0.3)), [0.1, 0.2, 0.3]);
  assert.deepEqual(rgb(new Color()), [1, 1, 1]);
});

test("what the maths doesn't take, it refuses (where three.js went on quietly)", () => {
  for (const colour of ['red', '#fff', '', null, true, {}, [1, 0, 0]]) assert.throws(() => new Color(colour), `colour ${JSON.stringify(colour)}`);
  assert.throws(() => new Euler(0, 0, 0, 'ZXY'));
  const euler = new Euler(1, 2, 3, 'YXZ');
  assert.throws(() => euler.set(4, 5, 6, 'ZYX'));
  assert.deepEqual([euler.x, euler.y, euler.z, euler.order], [1, 2, 3, 'YXZ'], 'unchanged');
  assert.throws(() => (euler.order = 'XZY'));
  assert.throws(() => euler.setFromRotationMatrix(new Matrix4(), 'ZXY'));
  assert.throws(() => new Quaternion().setFromEuler({ x: 0, y: 0, z: 0, order: 'ZXY' }));
});

test('angles in degrees and radians', () => {
  assert.equal(maths.degToRad(180), Math.PI);
  near(maths.radToDeg(Math.PI / 2), 90, 1e-12, 'a right angle');
  assert.equal(maths.clamp(5, 0, 1), 1);
  assert.equal(maths.clamp(-5, 0, 1), 0);
});
