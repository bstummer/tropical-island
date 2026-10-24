// The sand's detail (PLAN.md Stage 4), made on the GPU at boot: two tiles that
// repeat, which chunks/sand.glsl samples in ways that hide it.
//   grain    fine sand about a millimetre a texel (sand-grain.frag): the albedo's
//            factor (rgb, halved) and height (a)
//   ripples  wind ripples (sand-ripples.frag): their normal (rgb, tangent space,
//            the wind along x) and height (a)
// Drawn into their layers of textures/surfaces.js's array. grainMean is the
// grain's average factor (read back once), which the shader divides by, so
// the sand keeps its albedo on average. Settings: config.world.terrain.sand.
import * as THREE from 'three';
import vertexShader from '../post/output.vert';
import grainShader from './sand-grain.frag';
import ripplesShader from './sand-ripples.frag';
import { createFullscreen } from '../post/fullscreen.js';

// into: textures/surfaces.js's { renderer, target, layers, size, shift, pixels }.
export function makeSandTiles({ renderer, target, layers, size, shift, pixels }, rng, { grain, ripples }) {
  const seed = () => new THREE.Vector2(rng.range(0, 1000), rng.range(0, 1000));
  const make = (fragmentShader, uniforms, layer) => {
    uniforms.uShift = { value: new THREE.Vector2(...shift) };
    const pass = createFullscreen(new THREE.ShaderMaterial({ name: 'sand-texture', vertexShader, fragmentShader, uniforms }));
    pass.render(renderer, target, layer);
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

  const texels = pixels('grain');
  const sum = [0, 0, 0];
  for (let i = 0; i < texels.length; i += 4) for (let c = 0; c < 3; c++) sum[c] += texels[i + c];
  return { grainMean: new THREE.Vector3(...sum.map((v) => (2 * v) / 255 / (size * size))) };
}

// The uniforms chunks/sand.glsl reads: the tiles' (makeSandTiles), and
// config.world.terrain.sand with the wet sand's zone (wetHeight; chunks/wet.glsl's)
// and the view yaw out to sea (seaYaw, degrees), which the wind is turned from.
export function sandUniforms(tiles, sand, wetHeight, seaYaw) {
  const yaw = ((seaYaw - sand.wind) * Math.PI) / 180; // degrees to the right turn the yaw down
  return {
    uSandGrainMean: { value: tiles.grainMean },
    uSandTiles: { value: new THREE.Vector3(sand.grain.tile, sand.ripples.tile, sand.ripples.strength) },
    uSandWind: { value: new THREE.Vector2(-Math.sin(yaw), -Math.cos(yaw)) },
    uWet: { value: new THREE.Vector3(sand.wetness.film, wetHeight, sand.wetness.dry) },
    uSandRoughness: { value: new THREE.Vector3(sand.roughness.dry, sand.roughness.wet, sand.roughness.film) },
    uSandRange: { value: sand.range },
  };
}
