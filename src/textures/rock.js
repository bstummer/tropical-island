// The rock's detail (PLAN.md Stage 4), made on the GPU at boot: a tile that
// repeats, which chunks/rock.glsl projects along the three axes at two scales.
//   tile  blocks between cracks, rough and pitted, speckled with two minerals
//         (rock-tile.frag for the heights, rock-form.frag for the normal):
//         the normal's x and y (rg, tangent space), the albedo's factor (b,
//         halved) and how much of it is the second mineral (a)
// Mipmapped and repeating. mean is the albedo's average factor (read back
// once) with config.world.terrain.rock's tints, which the shader divides by,
// so the rock keeps its albedo on average. Settings: config.world.terrain.rock;
// `size`: texels across the tile (quality.rockTexture); `shift`: tiles to shift
// it by, which leaves it as it is if it truly repeats (fixtures/surfaces.js
// checks); pixels() reads it back. The owner disposes it.
import * as THREE from 'three';
import vertexShader from '../post/output.vert';
import tileShader from './rock-tile.frag';
import formShader from './rock-form.frag';
import { createFullscreen } from '../post/fullscreen.js';

export function createRockTextures(renderer, rng, rock, size, shift = [0, 0]) {
  const { tile, blocks, shape, face, minerals } = rock;
  const before = renderer.getRenderTarget();
  const run = (fragmentShader, uniforms, target) => {
    const pass = createFullscreen(new THREE.ShaderMaterial({ name: 'rock-texture', vertexShader, fragmentShader, uniforms }));
    pass.render(renderer, target);
    pass.dispose();
  };
  const repeat = { depthBuffer: false, wrapS: THREE.RepeatWrapping, wrapT: THREE.RepeatWrapping };
  // Heights in metres: half floats, read texel by texel.
  const heights = new THREE.WebGLRenderTarget(size, size, { ...repeat, type: THREE.HalfFloatType, minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter, generateMipmaps: false });
  run(tileShader, {
    uTile: { value: tile },
    uSeed: { value: new THREE.Vector2(rng.range(0, 1000), rng.range(0, 1000)) },
    uShift: { value: new THREE.Vector2(...shift) },
    uBlocks: { value: new THREE.Vector4(blocks.size, blocks.regular, blocks.crack, blocks.bevel) },
    uShape: { value: new THREE.Vector4(shape.rounding, shape.tilt, shape.proud, shape.gapes) },
    uFace: { value: new THREE.Vector4(face.roughness, face.pitSize, face.pits, face.pitDepth) },
    uMinerals: { value: new THREE.Vector4(minerals.size, minerals.share, minerals.brightness, minerals.speckle) },
  }, heights);
  const target = new THREE.WebGLRenderTarget(size, size, {
    ...repeat,
    minFilter: THREE.LinearMipmapLinearFilter,
    magFilter: THREE.LinearFilter,
    generateMipmaps: true,
    anisotropy: 4,
  });
  run(formShader, { uHeights: { value: heights.texture }, uTile: { value: tile }, uTexels: { value: size } }, target);
  heights.dispose();

  const read = () => {
    const pixels = new Uint8Array(4 * size * size);
    renderer.readRenderTargetPixels(target, 0, 0, size, size, pixels);
    renderer.setRenderTarget(before);
    return pixels;
  };
  const pixels = read();
  const [first, second] = minerals.tints;
  const sum = [0, 0, 0];
  for (let i = 0; i < pixels.length; i += 4) {
    const factor = (2 * pixels[i + 2]) / 255;
    const share = pixels[i + 3] / 255;
    for (let c = 0; c < 3; c++) sum[c] += factor * (first[c] + share * (second[c] - first[c]));
  }
  const mean = new THREE.Vector3(...sum.map((v) => v / (size * size)));

  return {
    tile: target.texture,
    mean,
    pixels: read,
    dispose() {
      target.dispose();
    },
  };
}

// The uniforms chunks/rock.glsl reads: the texture, and config.world.terrain.rock
// with the height of the sea's reach (chunks/rock.glsl rockWetness).
export function rockUniforms(textures, rock) {
  const { relief, streaks, strata, lichen, wet, roughness, minerals } = rock;
  return {
    uRockTile: { value: textures.tile },
    uRockMean: { value: textures.mean },
    uRockTints: { value: minerals.tints.map((t) => new THREE.Vector3(...t)) },
    uRockScales: { value: new THREE.Vector2(rock.tile, rock.detail) },
    uRockRelief: { value: new THREE.Vector4(relief.scale, relief.height, relief.sharp, relief.stretch) },
    uRockTone: { value: rock.tone },
    uRockStreaks: { value: new THREE.Vector4(...streaks.colour, streaks.strength) },
    uRockStrata: { value: new THREE.Vector4(strata.spacing, strata.tone, strata.ledges, 0) },
    uRockLichen: { value: new THREE.Vector4(...lichen.colour, lichen.cover) },
    uRockLichenSecond: { value: new THREE.Vector4(...lichen.second, lichen.share) },
    uRockWet: { value: new THREE.Vector4(wet.reach, wet.dark, ...wet.band) },
    uRockBand: { value: wet.bandDark },
    uRockRoughness: { value: new THREE.Vector2(roughness.dry, roughness.wet) },
    uRockRange: { value: rock.range },
  };
}
