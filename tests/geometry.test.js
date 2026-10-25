import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Attribute, Geometry } from '../src/gpu/geometry.js';

test('geometries share an attribute and its buffer, freed when the last lets go', () => {
  const nodes = new Attribute(new Float32Array(4 * 8), 4, { instance: true });
  const [whole, quarter] = [new Geometry(), new Geometry()];
  for (const geometry of [whole, quarter]) geometry.setAttribute('position', [0, 0, 0, 1, 0, 0, 0, 0, 1], 3).setAttribute('aNode', nodes);
  assert.equal(whole.attributes.aNode, quarter.attributes.aNode);
  let destroyed = 0;
  nodes.gpu = { destroy: () => destroyed++ }; // as the renderer leaves it
  whole.dispose();
  assert.equal(destroyed, 0);
  assert.ok(nodes.gpu);
  quarter.dispose();
  assert.equal(destroyed, 1);
  assert.equal(nodes.gpu, null);
});

test('a range of shared instances: updates merge, and each geometry draws its own', () => {
  const nodes = new Attribute(new Float32Array(4 * 8), 4, { instance: true });
  nodes.dirty = null; // uploaded
  const geometry = new Geometry().setAttribute('aNode', nodes);
  geometry.update('aNode', 2, 1);
  nodes.update(5, 2);
  assert.deepEqual(nodes.dirty, [8, 28]);
  assert.equal(geometry.instances, 8);
  geometry.firstInstance = 3;
  assert.equal(geometry.instances, 5);
  geometry.instanceCount = 2;
  assert.equal(geometry.instances, 2);
});
