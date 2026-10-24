// Tool fixture (?fixture=heavy): a scene over every frame-cost limit of the
// `low` preset (config.budget.low), so tools/screenshot.js can prove it warns on
// each. Each part is sized from its limit, a quarter over it, so retuning the
// limits keeps the fixture over them. It looks like nothing. Not part of the island.
import shader from './heavy.wgsl';
import { basicMaterial } from './basic.js';
import { Material } from '../gpu/material.js';
import { box, plane } from '../gpu/geometry.js';
import { Mesh, Node, Scene } from '../gpu/scene.js';
import { createTarget, Texture } from '../gpu/texture.js';

const OVER = 1.25;
const TEXTURE_SIZE = 2048; // RGBA8: 16 MB each
const TARGET_MB = 48; // a 2048^2 half-float colour target with depth

export function create(ctx) {
  const { scene, camera, renderer, frame, gpu } = ctx;
  const limits = ctx.config.budget.low;
  const boxes = Math.ceil(limits.drawCalls * OVER); // one draw call each
  const variantCount = Math.ceil(limits.pipelines * OVER); // one pipeline each
  const wallSegments = Math.ceil(Math.sqrt((limits.triangles * OVER) / 2)); // two triangles per segment
  // See-through layers over the whole view: overdraw, and one texture each.
  const layers = Math.max(Math.ceil((limits.textureMB * OVER) / 16), Math.ceil(limits.overdraw * OVER));
  const targetCount = Math.ceil((limits.renderTargetMB * OVER) / TARGET_MB);
  const passCount = Math.ceil(limits.passes * OVER); // extra render passes per frame, into tiny targets
  const group = new Node();
  group.position.copy(camera.position);
  group.quaternion.copy(camera.quaternion);
  scene.add(group);

  const cube = box(0.15, 0.15, 0.15);
  const variants = Array.from({ length: variantCount }, (_, i) => new Material({ name: `fixture-heavy-${i}`, shader, overrides: { VARIANT: i } }));
  for (let i = 0; i < boxes; i++) {
    const mesh = new Mesh(cube, variants[i % variantCount]);
    mesh.position.set(((i % 40) - 19.5) * 0.4, (Math.floor(i / 40) - 9.5) * 0.4, -20);
    group.add(mesh);
  }

  const wallGeometry = plane(200, 120, wallSegments, wallSegments);
  const wall = new Mesh(wallGeometry, basicMaterial({ color: '#334455' }));
  wall.position.z = -40;
  group.add(wall);

  // One pixel buffer shared by every texture: the GPU still holds a copy each.
  const pixels = new Uint8Array(TEXTURE_SIZE * TEXTURE_SIZE * 4);
  const textures = Array.from({ length: layers }, () =>
    new Texture(gpu, { name: 'fixture-heavy', width: TEXTURE_SIZE, height: TEXTURE_SIZE, data: true, sampler: { mag: 'nearest', min: 'nearest' } }).upload(pixels),
  );
  const layerGeometry = plane(20, 12);
  const layerMaterials = textures.map((map, i) => {
    const material = basicMaterial({ map, opacity: 0.05 });
    const layer = new Mesh(layerGeometry, material);
    layer.position.z = -2 - 0.1 * i;
    group.add(frame.translucent(layer));
    return material;
  });

  const targets = Array.from({ length: targetCount }, () => createTarget(gpu, { name: 'fixture-heavy', width: TEXTURE_SIZE, height: TEXTURE_SIZE, depth: true }));

  const tinyScene = new Scene();
  tinyScene.add(new Mesh(cube, variants[0]));
  const tinyTargets = Array.from({ length: passCount }, () => createTarget(gpu, { name: 'fixture-heavy-tiny', width: 16, height: 16, format: 'rgba8unorm', depth: true }));
  const removePasses = frame.beforeScene(() => {
    for (const target of tinyTargets) renderer.render(tinyScene, camera, target, { clearColor: [0, 0, 0, 0], clearDepth: 0 });
  });

  return {
    update() {},
    dispose() {
      removePasses();
      scene.remove(group);
      for (const geometry of [cube, wallGeometry, layerGeometry]) geometry.dispose();
      for (const material of [...variants, wall.material, ...layerMaterials]) material.dispose();
      for (const texture of textures) texture.destroy();
      for (const target of [...targets, ...tinyTargets]) target.dispose();
    },
  };
}
