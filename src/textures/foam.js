// The foam's lace (foam-tile.wgsl), made on the GPU at boot and drawn into its
// layer of textures/surfaces.js's array. water/water-foam.wgsl cuts it at the level
// that leaves as much of it as the foam is to cover, read back from the tile's own
// texels (textures/foam-levels.js): a promise of those levels.
import { Vector2 } from '../maths/index.js';
import shader from './foam-tile.wgsl';
import { Material } from '../gpu/material.js';
import { foamLevels } from './foam-levels.js';

// into: textures/surfaces.js's { renderer, target, layers, shift, pixels }.
export function makeFoamTile({ renderer, target, layers, shift, pixels }, rng) {
  const pass = renderer.fullscreen(
    new Material({
      name: 'foam-texture',
      shader,
      uniforms: { uSeed: { value: new Vector2(rng.range(0, 1000), rng.range(0, 1000)) }, uShift: { value: new Vector2(...shift) } },
    }),
  );
  pass.render(target, { layer: layers.foam });
  pass.dispose();
  return pixels('foam').then(foamLevels);
}
