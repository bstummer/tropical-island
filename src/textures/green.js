// The green inland (PLAN.md Stage 4): its detail, made on the GPU at boot, two
// tiles that repeat, which chunks/green.glsl reads in ways that hide it.
//   grass   short grass from straight above (grass.frag): how much a blade
//           covers (r), its height (g), its tone from fresh to straw (b), its
//           brightness (a)
//   litter  fallen leaves from straight above (litter.frag): the normal's x
//           and y (rg, tangent space), the tone from light to dark (b), how
//           much a leaf covers (a)
// Both mipmapped and repeating. grassMean is a blade's factor on average over
// the blades (chunks/green.glsl greenBlade, the same sum here), grassCover and
// litterCover how much the blades and the leaves cover, read back once, so
// the green keeps its albedo on average.
// Settings: config.world.terrain.green; `size`: texels across a tile
// (quality.greenTexture); `shift`: tiles to shift them by, which leaves them
// as they are if they truly repeat (fixtures/surfaces.js checks); pixels(name)
// reads one back. The owner disposes them.
import * as THREE from 'three';
import vertexShader from '../post/output.vert';
import grassShader from './grass.frag';
import litterShader from './litter.frag';
import { createFullscreen } from '../post/fullscreen.js';

export function createGreenTextures(renderer, rng, { tiles, straw }, size, shift = [0, 0]) {
  const before = renderer.getRenderTarget();
  const make = (fragmentShader, tile) => {
    const target = new THREE.WebGLRenderTarget(size, size, {
      depthBuffer: false,
      wrapS: THREE.RepeatWrapping,
      wrapT: THREE.RepeatWrapping,
      minFilter: THREE.LinearMipmapLinearFilter,
      magFilter: THREE.LinearFilter,
      generateMipmaps: true,
      anisotropy: 4,
    });
    const uniforms = {
      uTile: { value: tile },
      uTexels: { value: size },
      uSeed: { value: new THREE.Vector2(rng.range(0, 1000), rng.range(0, 1000)) },
      uShift: { value: new THREE.Vector2(...shift) },
    };
    const pass = createFullscreen(new THREE.ShaderMaterial({ name: 'green-texture', vertexShader, fragmentShader, uniforms }));
    pass.render(renderer, target);
    pass.dispose();
    return target;
  };
  const targets = { grass: make(grassShader, tiles.grass), litter: make(litterShader, tiles.litter) };
  const read = (name) => {
    const pixels = new Uint8Array(4 * size * size);
    renderer.readRenderTargetPixels(targets[name], 0, 0, size, size, pixels);
    renderer.setRenderTarget(before);
    return pixels;
  };

  const grass = read('grass');
  const sum = [0, 0, 0];
  let bladed = 0;
  const texel = [0, 0, 0, 0];
  const factor = [0, 0, 0];
  for (let i = 0; i < grass.length; i += 4) {
    for (let c = 0; c < 4; c++) texel[c] = grass[i + c] / 255;
    blade(texel, straw, factor);
    for (let c = 0; c < 3; c++) sum[c] += texel[0] * factor[c];
    bladed += texel[0];
  }
  const grassMean = new THREE.Vector3(...sum.map((v) => v / bladed));
  const grassCover = bladed / (size * size);
  const litter = read('litter');
  let covered = 0;
  for (let i = 3; i < litter.length; i += 4) covered += litter[i];
  const litterCover = covered / 255 / (size * size);

  return {
    grass: targets.grass.texture,
    litter: targets.litter.texture,
    grassMean,
    grassCover,
    litterCover,
    pixels: read,
    dispose() {
      targets.grass.dispose();
      targets.litter.dispose();
    },
  };
}

// chunks/green.glsl greenBlade: a blade's factor at a texel [r, g, b, a] of
// the grass's tile, into `out`.
function blade([, height, tone, bright], straw, out) {
  const t = Math.min(Math.max((tone - 0.45) / 0.4, 0), 1);
  const dry = t * t * (3 - 2 * t);
  const shade = (0.4 + 0.8 * bright) * (0.55 + 0.45 * height);
  for (let c = 0; c < 3; c++) out[c] = (1 + (straw[c] - 1) * dry) * shade;
  return out;
}

// The uniforms chunks/green.glsl reads: the tiles, the albedos
// (config.world.terrain.albedo) and config.world.terrain.green.
export function greenUniforms(textures, albedo, green) {
  const vector = (v) => new THREE.Vector3(...v);
  return {
    uGrass: { value: vector(albedo.grass) },
    uLeafy: { value: vector(albedo.leafy) },
    uSoil: { value: vector(albedo.soil) },
    uLitter: { value: vector(albedo.litter) },
    uGreenOpen: { value: vector(green.cover.open) },
    uGreenLush: { value: vector(green.cover.lush) },
    uGreenLitter: { value: vector(green.litter) },
    uGreenTone: { value: new THREE.Vector4(...green.tone.change, green.tone.wavelength) },
    uGreenPatches: { value: new THREE.Vector2(green.patches.size, green.patches.sharp) },
    uGrassTile: { value: textures.grass },
    uLitterTile: { value: textures.litter },
    uGrassMean: { value: textures.grassMean },
    uGrassCover: { value: textures.grassCover },
    uLitterCover: { value: textures.litterCover },
    uGreenTiles: { value: new THREE.Vector3(green.tiles.grass, green.tiles.litter, green.tiles.crumbs) },
    uStraw: { value: vector(green.straw) },
    uLeafLight: { value: vector(green.leaves.light) },
    uLeafDark: { value: vector(green.leaves.dark) },
    uGreenRange: { value: green.range },
    uGreenClumps: { value: new THREE.Vector2(green.clumps.strength, green.clumps.size) },
    uGreenStand: { value: green.stand },
  };
}
