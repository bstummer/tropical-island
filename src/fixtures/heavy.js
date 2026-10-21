// Tool fixture (?fixture=heavy): a scene over every frame-cost limit of the
// `low` preset (config.budget.low), so tools/screenshot.js can prove it warns on
// each. Each part is sized from its limit, a quarter over it, so retuning the
// limits keeps the fixture over them. It looks like nothing. Not part of the island.
import * as THREE from 'three';
import vertexShader from './heavy.vert';
import fragmentShader from './heavy.frag';
import { withSceneOutput } from '../post/scene-output.js';

const OVER = 1.25;
const TEXTURE_SIZE = 2048; // RGBA8: 16 MB each
const TARGET_MB = 48; // a 2048^2 half-float colour target with depth

export function create(ctx) {
  const { scene, camera, renderer, frame } = ctx;
  const limits = ctx.config.budget.low;
  const boxes = Math.ceil(limits.drawCalls * OVER); // one draw call each
  const variantCount = Math.ceil(limits.programs * OVER); // one shader program each
  const wallSegments = Math.ceil(Math.sqrt((limits.triangles * OVER) / 2)); // two triangles per segment
  // See-through layers over the whole view: overdraw, and one texture each.
  const layers = Math.max(Math.ceil((limits.textureMB * OVER) / 16), Math.ceil(limits.overdraw * OVER));
  const targetCount = Math.ceil((limits.renderTargetMB * OVER) / TARGET_MB);
  const passCount = Math.ceil(limits.passes * OVER); // extra render passes per frame, into tiny targets
  const group = new THREE.Group();
  group.position.copy(camera.position);
  group.quaternion.copy(camera.quaternion);
  scene.add(group);

  const box = new THREE.BoxGeometry(0.15, 0.15, 0.15);
  const variants = Array.from(
    { length: variantCount },
    (_, i) =>
      new THREE.ShaderMaterial({ name: `fixture-heavy-${i}`, vertexShader, fragmentShader, uniforms: { ...frame.uniforms }, defines: { VARIANT: i } }),
  );
  for (let i = 0; i < boxes; i++) {
    const mesh = new THREE.Mesh(box, variants[i % variantCount]);
    mesh.position.set(((i % 40) - 19.5) * 0.4, (Math.floor(i / 40) - 9.5) * 0.4, -20);
    group.add(mesh);
  }

  const wall = new THREE.Mesh(
    new THREE.PlaneGeometry(200, 120, wallSegments, wallSegments),
    withSceneOutput(new THREE.MeshBasicMaterial({ color: '#334455' }), frame),
  );
  wall.position.z = -40;
  group.add(wall);

  // One pixel buffer shared by every texture: the GPU still holds a copy each.
  const pixels = new Uint8Array(TEXTURE_SIZE * TEXTURE_SIZE * 4);
  const textures = Array.from({ length: layers }, () => {
    const texture = new THREE.DataTexture(pixels, TEXTURE_SIZE, TEXTURE_SIZE);
    texture.needsUpdate = true;
    return texture;
  });
  textures.forEach((map, i) => {
    const layer = new THREE.Mesh(
      new THREE.PlaneGeometry(20, 12),
      withSceneOutput(new THREE.MeshBasicMaterial({ map, opacity: 0.05 }), frame),
    );
    layer.position.z = -2 - 0.1 * i;
    group.add(frame.translucent(layer));
  });

  const targets = Array.from({ length: targetCount }, () => {
    const target = new THREE.WebGLRenderTarget(TEXTURE_SIZE, TEXTURE_SIZE, { type: THREE.HalfFloatType });
    renderer.initRenderTarget(target);
    return target;
  });

  const tinyScene = new THREE.Scene();
  tinyScene.add(new THREE.Mesh(box, variants[0]));
  const tinyTargets = Array.from({ length: passCount }, () => new THREE.WebGLRenderTarget(16, 16));
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
