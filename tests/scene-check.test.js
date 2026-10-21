import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { misplacedBlending, missingSceneOutput } from '../src/post/scene-check.js';

const LAYERS = { opaque: 0, afterOpaque: 1, translucent: 2 }; // as post/frame.js has them

// A scene with one mesh per material, each on the given layer (default opaque).
function sceneWith(...entries) {
  const scene = new THREE.Scene();
  for (const [material, layer = LAYERS.opaque] of entries) {
    const mesh = new THREE.Mesh(new THREE.BufferGeometry(), material);
    mesh.layers.set(layer);
    scene.add(mesh);
  }
  return scene;
}

// A material frame.translucent() would have set up.
function translucentMaterial(name) {
  const material = new THREE.MeshBasicMaterial({ name, transparent: true, blending: THREE.CustomBlending });
  material.defines = { SCENE_TRANSLUCENT: '' }; // as frame.translucent() sets it: the constructor ignores defines
  return material;
}

test('opaque materials and set-up translucent ones pass', () => {
  const scene = sceneWith([new THREE.MeshBasicMaterial({ name: 'solid' })], [translucentMaterial('cloud'), LAYERS.translucent]);
  assert.deepEqual(misplacedBlending(scene, LAYERS), []);
});

test('any blending outside the translucent pass is caught, whatever `transparent` says', () => {
  const blends = [
    new THREE.MeshBasicMaterial({ name: 'see-through', transparent: true }),
    new THREE.MeshBasicMaterial({ name: 'glint', blending: THREE.AdditiveBlending }), // blends though not transparent
    new THREE.MeshBasicMaterial({ name: 'custom', blending: THREE.CustomBlending }),
  ];
  const [problem, ...rest] = misplacedBlending(sceneWith(...blends.map((m) => [m])), LAYERS);
  assert.deepEqual(rest, []);
  for (const name of ['see-through', 'glint', 'custom']) assert.match(problem, new RegExp(`outside the translucent pass.*${name}`));
  // Not blending at all is fine, transparent or not.
  assert.deepEqual(misplacedBlending(sceneWith([new THREE.MeshBasicMaterial({ transparent: true, blending: THREE.NoBlending })]), LAYERS), []);
});

test('a material in the translucent pass that frame.translucent() did not set up is caught', () => {
  const scene = sceneWith([new THREE.MeshBasicMaterial({ name: 'raw', transparent: true }), LAYERS.translucent]);
  assert.deepEqual(misplacedBlending(scene, LAYERS), ['materials in the translucent pass not set up by frame.translucent(): raw (MeshBasicMaterial)']);
});

test('an object in no pass, or in two, is caught', () => {
  const scene = sceneWith([new THREE.MeshBasicMaterial()]);
  const [mesh] = scene.children;
  mesh.name = 'stray';
  mesh.layers.set(5);
  assert.deepEqual(misplacedBlending(scene, LAYERS), ["objects in none or several of the frame's passes: stray"]);
  mesh.layers.set(LAYERS.opaque);
  mesh.layers.enable(LAYERS.afterOpaque);
  assert.deepEqual(misplacedBlending(scene, LAYERS), ["objects in none or several of the frame's passes: stray"]);
});

test('missingSceneOutput: shader materials must assign it, built-in ones must be wrapped', () => {
  const ending = new THREE.ShaderMaterial({ name: 'ends', fragmentShader: 'void main() { gl_FragColor = sceneOutput(c, 1.0); }' });
  const skipping = new THREE.ShaderMaterial({ name: 'skips', fragmentShader: 'void main() { gl_FragColor = vec4(1.0); }' });
  const wrapped = new THREE.MeshBasicMaterial({ name: 'wrapped' });
  wrapped.onBeforeCompile = Object.assign(() => {}, { sceneOutput: true });
  const plain = new THREE.MeshBasicMaterial({ name: 'plain' });
  assert.deepEqual(missingSceneOutput(sceneWith([ending], [skipping], [wrapped], [plain])), ['skips (ShaderMaterial)', 'plain (MeshBasicMaterial)']);
});
