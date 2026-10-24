// The rock's detail (PLAN.md Stage 4), made on the GPU at boot: a tile that
// repeats, which chunks/rock.glsl projects along the three axes at two scales.
//   tile  blocks between cracks, rough and pitted, speckled with two minerals
//         (rock-tile.frag for the heights, rock-form.frag for the normal):
//         the normal's x and y (rg, tangent space), the albedo's factor (b,
//         halved) and how much of it is the second mineral (a)
// Drawn into its layer of textures/surfaces.js's array. mean is the albedo's
// average factor (read back once) with config.world.terrain.rock's tints,
// which the shader divides by, so the rock keeps its albedo on average.
// Settings: config.world.terrain.rock.
import * as THREE from 'three';
import vertexShader from '../post/output.vert';
import tileShader from './rock-tile.frag';
import formShader from './rock-form.frag';
import { createFullscreen } from '../post/fullscreen.js';

// into: textures/surfaces.js's { renderer, target, layers, size, shift, pixels }.
export function makeRockTile({ renderer, target, layers, size, shift, pixels }, rng, rock) {
  const { tile, blocks, shape, face, minerals } = rock;
  const run = (fragmentShader, uniforms, into, layer = 0) => {
    const pass = createFullscreen(new THREE.ShaderMaterial({ name: 'rock-texture', vertexShader, fragmentShader, uniforms }));
    pass.render(renderer, into, layer);
    pass.dispose();
  };
  // Heights in metres: half floats, read texel by texel.
  const heights = new THREE.WebGLRenderTarget(size, size, { depthBuffer: false, wrapS: THREE.RepeatWrapping, wrapT: THREE.RepeatWrapping, type: THREE.HalfFloatType, minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter, generateMipmaps: false });
  run(tileShader, {
    uTile: { value: tile },
    uSeed: { value: new THREE.Vector2(rng.range(0, 1000), rng.range(0, 1000)) },
    uShift: { value: new THREE.Vector2(...shift) },
    uBlocks: { value: new THREE.Vector4(blocks.size, blocks.regular, blocks.crack, blocks.bevel) },
    uShape: { value: new THREE.Vector4(shape.rounding, shape.tilt, shape.proud, shape.gapes) },
    uFace: { value: new THREE.Vector4(face.roughness, face.pitSize, face.pits, face.pitDepth) },
    uMinerals: { value: new THREE.Vector4(minerals.size, minerals.share, minerals.brightness, minerals.speckle) },
  }, heights);
  run(formShader, { uHeights: { value: heights.texture }, uTile: { value: tile }, uTexels: { value: size } }, target, layers.rock);
  heights.dispose();

  const texels = pixels('rock');
  const [first, second] = minerals.tints;
  const sum = [0, 0, 0];
  for (let i = 0; i < texels.length; i += 4) {
    const factor = (2 * texels[i + 2]) / 255;
    const share = texels[i + 3] / 255;
    for (let c = 0; c < 3; c++) sum[c] += factor * (first[c] + share * (second[c] - first[c]));
  }
  return { mean: new THREE.Vector3(...sum.map((v) => v / (size * size))) };
}

// The uniforms chunks/rock.glsl reads: the tile's (makeRockTile), and
// config.world.terrain.rock.
export function rockUniforms(tile, rock) {
  const { relief, streaks, strata, lichen, wet, roughness, minerals } = rock;
  return {
    uRockMean: { value: tile.mean },
    uRockTints: { value: minerals.tints.map((t) => new THREE.Vector3(...t)) },
    uRockScales: { value: new THREE.Vector2(rock.tile, rock.detail) },
    uRockRelief: { value: new THREE.Vector4(relief.scale, relief.height, relief.sharp, relief.stretch) },
    uRockTone: { value: rock.tone },
    uRockStreaks: { value: new THREE.Vector4(...streaks.colour, streaks.strength) },
    uRockStrata: { value: new THREE.Vector4(strata.spacing, strata.tone, strata.ledges, 0) },
    uRockLichen: { value: new THREE.Vector4(...lichen.colour, lichen.cover) },
    uRockLichenSecond: { value: new THREE.Vector4(...lichen.second, lichen.share) },
    uRockWet: { value: new THREE.Vector4(wet.ragged, wet.dark, ...wet.band) },
    uRockBand: { value: new THREE.Vector2(wet.bandDark, wet.bandRagged) },
    uRockRoughness: { value: new THREE.Vector2(roughness.dry, roughness.wet) },
    uRockRange: { value: rock.range },
  };
}
