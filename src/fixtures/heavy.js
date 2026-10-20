// Tool fixture (?fixture=heavy): a scene over every frame-cost limit of the
// `low` preset (config.budget.low), so tools/screenshot.js can prove it warns on
// each. Each part is sized to exceed one limit; it looks like nothing. Not part
// of the island.
import * as THREE from 'three';
import vertexShader from './heavy.vert';
import fragmentShader from './heavy.frag';
import { withSceneOutput } from '../post/scene-output.js';

const BOXES = 800; // draw calls
const VARIANTS = 70; // shader programs, one per material variant
const WALL_SEGMENTS = 710; // 710 x 710 x 2 = 1.0 M triangles
const LAYERS = 9; // see-through layers over the whole view: overdraw, and one 16 MB texture each
const TEXTURE_SIZE = 2048;
const TARGETS = 3; // 2048^2 half-float colour + depth: 48 MB each
const PASSES = 10; // extra render passes per frame, into tiny targets

export function create(ctx) {
  const { scene, camera, renderer, frame } = ctx;
  const group = new THREE.Group();
  group.position.copy(camera.position);
  group.quaternion.copy(camera.quaternion);
  scene.add(group);

  const box = new THREE.BoxGeometry(0.15, 0.15, 0.15);
  const variants = Array.from(
    { length: VARIANTS },
    (_, i) =>
      new THREE.ShaderMaterial({ name: `fixture-heavy-${i}`, vertexShader, fragmentShader, uniforms: { ...frame.uniforms }, defines: { VARIANT: i } }),
  );
  for (let i = 0; i < BOXES; i++) {
    const mesh = new THREE.Mesh(box, variants[i % VARIANTS]);
    mesh.position.set(((i % 40) - 19.5) * 0.4, (Math.floor(i / 40) - 9.5) * 0.4, -20);
    group.add(mesh);
  }

  const wall = new THREE.Mesh(
    new THREE.PlaneGeometry(200, 120, WALL_SEGMENTS, WALL_SEGMENTS),
    withSceneOutput(new THREE.MeshBasicMaterial({ color: '#334455' }), frame),
  );
  wall.position.z = -40;
  group.add(wall);

  // One pixel buffer shared by every texture: the GPU still holds a copy each.
  const pixels = new Uint8Array(TEXTURE_SIZE * TEXTURE_SIZE * 4);
  const textures = Array.from({ length: LAYERS }, () => {
    const texture = new THREE.DataTexture(pixels, TEXTURE_SIZE, TEXTURE_SIZE);
    texture.needsUpdate = true;
    return texture;
  });
  textures.forEach((map, i) => {
    const layer = new THREE.Mesh(
      new THREE.PlaneGeometry(20, 12),
      withSceneOutput(new THREE.MeshBasicMaterial({ map, transparent: true, opacity: 0.05, depthWrite: false }), frame),
    );
    layer.position.z = -2 - 0.1 * i;
    group.add(layer);
  });

  const targets = Array.from({ length: TARGETS }, () => {
    const target = new THREE.WebGLRenderTarget(TEXTURE_SIZE, TEXTURE_SIZE, { type: THREE.HalfFloatType });
    renderer.initRenderTarget(target);
    return target;
  });

  const tinyScene = new THREE.Scene();
  tinyScene.add(new THREE.Mesh(box, variants[0]));
  const tinyTargets = Array.from({ length: PASSES }, () => new THREE.WebGLRenderTarget(16, 16));
  const removePasses = frame.beforeScene(() => {
    for (const target of tinyTargets) {
      renderer.setRenderTarget(target);
      renderer.render(tinyScene, camera);
    }
  });

  return {
    update() {},
    dispose() {
      removePasses();
      scene.remove(group);
      group.traverse((object) => {
        object.geometry?.dispose();
        object.material?.map?.dispose();
        object.material?.dispose();
      });
      for (const target of [...targets, ...tinyTargets]) target.dispose();
    },
  };
}
