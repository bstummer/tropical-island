// The seabed's mottling (seabed-tile.wgsl, which says what each channel holds), made
// on the GPU at boot and drawn into its layer of textures/surfaces.js's array:
// reading it costs the water a fraction of working out as much noise per pixel, and
// its mips do the fading with distance. Read by water/water-seabed.wgsl.
import { Vector2 } from '../maths/index.js';
import shader from './seabed-tile.wgsl';
import { Material } from '../gpu/material.js';

// into: textures/surfaces.js's { renderer, target, layers, shift }.
export function makeSeabedTile({ renderer, target, layers, shift }, rng) {
  const pass = renderer.fullscreen(
    new Material({
      name: 'seabed-texture',
      shader,
      uniforms: { uSeed: { value: new Vector2(rng.range(0, 1000), rng.range(0, 1000)) }, uShift: { value: new Vector2(...shift) } },
    }),
  );
  pass.render(target, { layer: layers.seabed });
  pass.dispose();
}
