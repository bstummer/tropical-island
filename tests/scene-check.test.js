import test from 'node:test';
import assert from 'node:assert/strict';
import { Geometry } from '../src/gpu/geometry.js';
import { Material, TRANSLUCENT_BLEND } from '../src/gpu/material.js';
import { Mesh, Scene } from '../src/gpu/scene.js';
import { misplacedBlending, missingSceneOutput } from '../src/post/scene-check.js';

const PASSES = ['opaque', 'afterOpaque', 'translucent']; // as post/frame.js has them
const ENDS = '@fragment fn fragmentMain() -> @location(0) vec4f { return sceneOutput(c, 1.0); }';

// A scene with one mesh per material, each in the given pass (default opaque).
function sceneWith(...entries) {
  const scene = new Scene();
  for (const [material, pass = 'opaque'] of entries) {
    const mesh = new Mesh(new Geometry(), material);
    mesh.pass = pass;
    scene.add(mesh);
  }
  return scene;
}

const material = (name, options = {}) => new Material({ name, shader: ENDS, ...options });

// A material frame.translucent() would have set up.
const translucentMaterial = (name) => material(name, { transparent: true, blend: TRANSLUCENT_BLEND, overrides: { SCENE_TRANSLUCENT: true } });

test('opaque materials and set-up translucent ones pass', () => {
  const scene = sceneWith([material('solid')], [translucentMaterial('cloud'), 'translucent']);
  assert.deepEqual(misplacedBlending(scene, PASSES), []);
});

test('any blending outside the translucent pass is caught, whatever `transparent` says', () => {
  const additive = { color: { srcFactor: 'one', dstFactor: 'one' }, alpha: { srcFactor: 'one', dstFactor: 'one' } };
  const blends = [material('see-through', { transparent: true, blend: TRANSLUCENT_BLEND }), material('glint', { blend: additive })];
  const [problem, ...rest] = misplacedBlending(sceneWith(...blends.map((m) => [m]), [blends[1], 'afterOpaque']), PASSES);
  assert.deepEqual(rest, []);
  for (const name of ['see-through', 'glint']) assert.match(problem, new RegExp(`outside the translucent pass.*${name}`));
  // Not blending at all is fine, transparent or not.
  assert.deepEqual(misplacedBlending(sceneWith([material('clear', { transparent: true })]), PASSES), []);
});

test('a material in the translucent pass that frame.translucent() did not set up is caught', () => {
  const scene = sceneWith([material('raw', { transparent: true, blend: TRANSLUCENT_BLEND }), 'translucent']);
  assert.deepEqual(misplacedBlending(scene, PASSES), ['materials in the translucent pass not set up by frame.translucent(): raw']);
});

test('a mesh in no pass is caught, also when hidden', () => {
  const scene = sceneWith([material('m')]);
  const [mesh] = scene.children;
  mesh.name = 'stray';
  mesh.pass = 'layer-5';
  mesh.visible = false;
  assert.deepEqual(misplacedBlending(scene, PASSES), ["meshes in none of the frame's passes: stray"]);
});

test('missingSceneOutput: the fragment entry point of every material must return sceneOutput()', () => {
  const skipping = new Material({ name: 'skips', shader: '@fragment fn fragmentMain() -> @location(0) vec4f { return vec4f(1.0); }' });
  // Another entry point of the same shader that does return it doesn't count.
  const raw = new Material({ name: 'raw', shader: `${ENDS} @fragment fn rawFragment() -> @location(0) vec4f { if (a) { b(); } return c; }`, fragment: 'rawFragment' });
  assert.deepEqual(missingSceneOutput(sceneWith([material('ends')], [skipping], [raw])), ['skips', 'raw']);
});
