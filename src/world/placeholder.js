// TEMPORARY placeholder water, until Stage 6's ocean replaces it (then delete
// it along with placeholder-water.wgsl). It uses the shared lighting
// (chunks/lighting.wgsl), so the light can be judged on it meanwhile, and
// takes its colour from the depth of the terrain below (chunks/terrain.wgsl),
// so the lagoon, the reef and the drop-off read from above.
import { Color, Matrix4 } from 'three';
import shader from './placeholder-water.wgsl';
import { Material } from '../gpu/material.js';
import { plane } from '../gpu/geometry.js';
import { Mesh } from '../gpu/scene.js';

export function create(ctx) {
  const { scene, camera } = ctx;

  // Flat water plane that follows the camera; the shader works in world space.
  // Tessellated because a few huge triangles clipped at the near plane get
  // rasterised differently by different GPUs (the shoreline moved by metres).
  // It reaches 60 km, past the horizon from any view, so the sky never shows
  // below it; its vertex shader bends it down with the planet.
  const uniforms = {
    uTime: { value: 0 },
    uDeep: { value: new Color('#0a3f6e') }, // sRGB hex, made linear
    uShallow: { value: new Color('#2bb3bd') },
    uClear: { value: new Color('#8fe3d6') },
  };
  const water = new Mesh(waterGeometry(60000, 200, 8), new Material({ name: 'placeholder-water', shader, uniforms }));
  water.name = 'placeholder';
  water.frustumCulled = false;
  scene.add(water);

  return {
    update(dt, t) {
      uniforms.uTime.value = t;
      water.position.set(camera.position.x, 0, camera.position.z);
    },
    dispose() {
      scene.remove(water);
      water.geometry.dispose();
      water.material.dispose();
    },
  };
}

// A square of side 2 x extent, with cells that grow away from the centre: the
// first about extent x growth / (e^growth - 1) / segments x 2 wide.
function waterGeometry(extent, segments, growth) {
  const geometry = plane(2, 2, segments, segments).applyMatrix4(new Matrix4().makeRotationX(-Math.PI / 2));
  const position = geometry.attributes.position.array;
  const stretch = (s) => (Math.sign(s) * extent * (Math.exp(growth * Math.abs(s)) - 1)) / (Math.exp(growth) - 1);
  for (let i = 0; i < position.length; i += 3) {
    position[i] = stretch(position[i]);
    position[i + 1] = 0;
    position[i + 2] = stretch(position[i + 2]);
  }
  geometry.boundingSphere = null;
  return geometry;
}
