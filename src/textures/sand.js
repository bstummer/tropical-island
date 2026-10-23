// The sand's detail (PLAN.md Stage 4), made on the GPU at boot: two tiles that
// repeat, which chunks/sand.glsl samples in ways that hide it.
//   grain    fine sand about a millimetre a texel (sand-grain.frag): the albedo's
//            factor (rgb, halved) and height (a)
//   ripples  wind ripples (sand-ripples.frag): their normal (rgb, tangent space,
//            the wind along x) and height (a)
// Both mipmapped and repeating. grainMean is the grain's average factor (read
// back once), which the shader divides by, so the sand keeps its albedo on
// average. Settings: config.world.terrain.sand; `size`: texels across a tile
// (quality.sandTexture); `shift`: tiles to shift them by, which leaves them as
// they are if they truly repeat (fixtures/surfaces.js checks); pixels(name)
// reads one back. The owner disposes them.
import * as THREE from 'three';
import vertexShader from '../post/output.vert';
import grainShader from './sand-grain.frag';
import ripplesShader from './sand-ripples.frag';
import { createFullscreen } from '../post/fullscreen.js';

export function createSandTextures(renderer, rng, { grain, ripples }, size, shift = [0, 0]) {
  const seed = () => new THREE.Vector2(rng.range(0, 1000), rng.range(0, 1000));
  const make = (fragmentShader, uniforms) => {
    const target = new THREE.WebGLRenderTarget(size, size, {
      depthBuffer: false,
      wrapS: THREE.RepeatWrapping,
      wrapT: THREE.RepeatWrapping,
      minFilter: THREE.LinearMipmapLinearFilter,
      magFilter: THREE.LinearFilter,
      generateMipmaps: true,
      anisotropy: 4,
    });
    uniforms.uShift = { value: new THREE.Vector2(...shift) };
    const pass = createFullscreen(new THREE.ShaderMaterial({ name: 'sand-texture', vertexShader, fragmentShader, uniforms }));
    pass.render(renderer, target);
    pass.dispose();
    return target;
  };
  const before = renderer.getRenderTarget();
  const grainTarget = make(grainShader, { uTile: { value: grain.tile * 1000 }, uSeed: { value: seed() } });
  const ripplesTarget = make(ripplesShader, {
    uTile: { value: ripples.tile },
    uWavelength: { value: ripples.wavelength },
    uHeight: { value: ripples.height },
    uTexels: { value: size },
    uSeed: { value: seed() },
  });

  const targets = { grain: grainTarget, ripples: ripplesTarget };
  const read = (name) => {
    const pixels = new Uint8Array(4 * size * size);
    renderer.readRenderTargetPixels(targets[name], 0, 0, size, size, pixels);
    return pixels;
  };
  const pixels = read('grain');
  renderer.setRenderTarget(before);
  const sum = [0, 0, 0];
  for (let i = 0; i < pixels.length; i += 4) for (let c = 0; c < 3; c++) sum[c] += pixels[i + c];
  const grainMean = new THREE.Vector3(...sum.map((v) => (2 * v) / 255 / (size * size)));

  return {
    grain: grainTarget.texture,
    ripples: ripplesTarget.texture,
    grainMean,
    pixels(name) {
      const pixels = read(name);
      renderer.setRenderTarget(before);
      return pixels;
    },
    dispose() {
      grainTarget.dispose();
      ripplesTarget.dispose();
    },
  };
}

// The uniforms chunks/sand.glsl reads: the textures, and config.world.terrain.sand
// with the wet sand's zone (wetHeight) and the view yaw out to sea (seaYaw,
// degrees), which the wind is turned from.
export function sandUniforms(textures, sand, wetHeight, seaYaw) {
  const yaw = ((seaYaw - sand.wind) * Math.PI) / 180; // degrees to the right turn the yaw down
  return {
    uSandGrain: { value: textures.grain },
    uSandRipples: { value: textures.ripples },
    uSandGrainMean: { value: textures.grainMean },
    uSandTiles: { value: new THREE.Vector3(sand.grain.tile, sand.ripples.tile, sand.ripples.strength) },
    uSandWind: { value: new THREE.Vector2(-Math.sin(yaw), -Math.cos(yaw)) },
    uSandWet: { value: new THREE.Vector3(sand.wetness.film, wetHeight, sand.wetness.dry) },
    uSandRoughness: { value: new THREE.Vector3(sand.roughness.dry, sand.roughness.wet, sand.roughness.film) },
    uSandRange: { value: sand.range },
  };
}
