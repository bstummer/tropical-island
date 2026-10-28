// The sand's detail (PLAN.md Stage 4), made on the GPU at boot: two tiles that
// repeat, which chunks/sand.wgsl samples in ways that hide it.
//   grain    fine sand about a millimetre a texel (sand-grain.wgsl): the albedo's
//            factor (rgb, halved) and height (a)
//   ripples  wind ripples (sand-ripples.wgsl): their normal (rgb, tangent space,
//            the wind along x) and height (a)
// Drawn into their layers of textures/surfaces.js's array. grainMean is the
// grain's average factor (read back once, so it comes as a promise), which the
// shader divides by, so the sand keeps its albedo on average. Settings:
// config.world.terrain.sand.
import { Vector2, Vector3, Vector4 } from '../maths/index.js';
import grainShader from './sand-grain.wgsl';
import ripplesShader from './sand-ripples.wgsl';
import { Material } from '../gpu/material.js';

// into: textures/surfaces.js's { renderer, target, layers, size, shift, pixels }.
// Draws the tiles; returns a promise of { grainMean }.
export function makeSandTiles({ renderer, target, layers, size, shift, pixels }, rng, { grain, ripples }) {
  const seed = () => new Vector2(rng.range(0, 1000), rng.range(0, 1000));
  const make = (shader, uniforms, layer) => {
    uniforms.uShift = { value: new Vector2(...shift) };
    const pass = renderer.fullscreen(new Material({ name: 'sand-texture', shader, uniforms }));
    pass.render(target, { layer });
    pass.dispose();
  };
  make(grainShader, { uTile: { value: grain.tile * 1000 }, uSeed: { value: seed() } }, layers.grain);
  make(ripplesShader, {
    uTile: { value: ripples.tile },
    uWavelength: { value: ripples.wavelength },
    uHeight: { value: ripples.height },
    uTexels: { value: size },
    uSeed: { value: seed() },
  }, layers.ripples);

  return pixels('grain').then((texels) => {
    const sum = [0, 0, 0];
    for (let i = 0; i < texels.length; i += 4) for (let c = 0; c < 3; c++) sum[c] += texels[i + c];
    return { grainMean: new Vector3(...sum.map((v) => (2 * v) / 255 / (size * size))) };
  });
}

// The uniforms chunks/sand.wgsl reads: the tiles' (makeSandTiles), and
// config.world.terrain.sand with the wet sand's zone (wetHeight; chunks/wet.wgsl's)
// and the view yaw out to sea (seaYaw, degrees), which the wind is turned from.
export function sandUniforms(tiles, sand, wetHeight, seaYaw) {
  const yaw = ((seaYaw - sand.wind) * Math.PI) / 180; // degrees to the right turn the yaw down
  return {
    uSandGrainMean: { value: tiles.grainMean },
    uSandTiles: { value: new Vector3(sand.grain.tile, sand.ripples.tile, sand.ripples.strength) },
    uSandWind: { value: new Vector2(-Math.sin(yaw), -Math.cos(yaw)) },
    uWet: { value: new Vector4(sand.wetness.film, wetHeight, sand.wetness.dry, sand.wetness.step) },
    uSandRoughness: { value: new Vector4(sand.roughness.dry, sand.roughness.wet, sand.roughness.soaked, sand.roughness.film) },
    uSandRange: { value: sand.range },
    uSandRumples: { value: new Vector2(sand.rumples.wavelength, sand.rumples.slope) },
  };
}
