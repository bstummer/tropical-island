/**
 * @license
 * Copyright 2010-2026 Three.js Authors
 * SPDX-License-Identifier: MIT
 */
// The maths the game takes from three.js, ported from three.js 0.186 (MIT, the
// notice above, which covers the code elsewhere that follows three.js's too:
// the scene graph, the camera, geometry, the renderer's bounding spheres). Only
// what the game uses, as it uses it, and in three.js's order of operations:
// the pictures were made with three.js's results, to the last bit, and a
// difference there moves rocks, culling and texels (PLAN.md Stage 4c).
// tests/maths.test.js holds every function to three.js's answers.
export { DEG2RAD, clamp, degToRad, radToDeg } from './scalar.js';
export { fromHalfFloat, toHalfFloat } from './half-float.js';
export { Vector2, Vector3, Vector4 } from './vector.js';
export { Quaternion } from './quaternion.js';
export { Euler } from './euler.js';
export { Matrix3, Matrix4 } from './matrix.js';
export { Box3, Frustum, Sphere } from './bounds.js';
export { Color } from './color.js';
