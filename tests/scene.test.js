import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Matrix4, Vector3 } from '../src/maths/index.js';
import { Camera } from '../src/core/camera.js';
import { Mesh, drawOrder } from '../src/gpu/scene.js';

// Meshes `distance` metres ahead of a camera looking down -z, keyed as
// gpu/renderer.js keys them: the clip-space depth of their centre.
function entries(camera, list) {
  camera.updateMatrixWorld();
  const projScreen = new Matrix4().multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
  return list.map(({ distance, material, renderOrder = 0 }) => {
    const mesh = new Mesh(null, material);
    mesh.renderOrder = renderOrder;
    mesh.name = `${distance} m`;
    return { mesh, z: new Vector3(0, 0, -distance).applyMatrix4(projScreen).z };
  });
}

const names = (items) => items.map(({ mesh }) => mesh.name);

test("passes draw in three.js's order: opaque near to far, transparent far to near", () => {
  const camera = new Camera(70, 16 / 9, 0.02, 100000);
  const opaque = { id: 1, transparent: false };
  const glass = { id: 2, transparent: true };
  const list = entries(camera, [
    { distance: 50, material: opaque },
    { distance: 5, material: opaque },
    { distance: 5, material: glass },
    { distance: 50, material: glass },
  ]);
  // Reversed depth: the nearer mesh has the larger z, which the order must undo.
  assert.ok(list[1].z > list[0].z);
  assert.deepEqual(names(drawOrder(list)), ['5 m', '50 m', '50 m', '5 m']);
});

test('renderOrder comes first, then the material, then the distance', () => {
  const camera = new Camera(70, 1, 0.02, 100000);
  const [a, b] = [{ id: 1, transparent: false }, { id: 2, transparent: false }];
  const list = entries(camera, [
    { distance: 1, material: b },
    { distance: 2, material: a },
    { distance: 3, material: a, renderOrder: -1 },
  ]);
  assert.deepEqual(names(drawOrder(list)), ['3 m', '2 m', '1 m']);
});
