// The tile of the sun's glints (glints-tile.wgsl), made on the GPU at boot and drawn
// into its layer of textures/surfaces.js's array. Read by water/water-mirror.wgsl,
// which divides by its mean, read back here: a promise of it.
import { Vector2 } from '../maths/index.js';
import shader from './glints-tile.wgsl';
import { Material } from '../gpu/material.js';

// into: textures/surfaces.js's { renderer, target, layers, shift, pixels }.
export function makeGlintsTile({ renderer, target, layers, shift, pixels }, rng) {
  const pass = renderer.fullscreen(
    new Material({
      name: 'glints-texture',
      shader,
      uniforms: { uSeed: { value: new Vector2(rng.range(0, 1000), rng.range(0, 1000)) }, uShift: { value: new Vector2(...shift) } },
    }),
  );
  pass.render(target, { layer: layers.glints });
  pass.dispose();
  return pixels('glints').then((texels) => {
    let sum = 0;
    for (let n = 0; n < texels.length; n += 4) sum += texels[n];
    return sum / (255 * (texels.length / 4));
  });
}
