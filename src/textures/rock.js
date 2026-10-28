// The rock's detail (PLAN.md Stage 4), made on the GPU at boot: a tile that
// repeats, which chunks/rock.wgsl projects along the three axes at two scales.
//   tile  blocks between cracks, rough and pitted, speckled with two minerals
//         (rock-tile.wgsl for the heights, rock-form.wgsl for the normal):
//         the normal's x and y (rg, tangent space), the albedo's factor (b,
//         halved) and how much of it is the second mineral (a)
// Drawn into its layer of textures/surfaces.js's array. The second
// mineral's brightness is in its tint (mineralTints), not in the factor, which
// would clip. mean is the albedo's average factor (read back once, so it comes
// as a promise) with the tints (rgb), and the factor's alone (w), which the
// shader divides by, so the rock keeps its albedo on average; it fails if the
// factor clips at 2. Settings: config.world.terrain.rock.
import { Vector2, Vector3, Vector4 } from '../maths/index.js';
import tileShader from './rock-tile.wgsl';
import formShader from './rock-form.wgsl';
import { Material } from '../gpu/material.js';
import { createTarget } from '../gpu/texture.js';

// into: textures/surfaces.js's { renderer, target, layers, size, shift, pixels }.
// Draws the tile; returns a promise of { mean }.
export function makeRockTile({ renderer, target, layers, size, shift, pixels }, rng, rock) {
  const { tile, blocks, shape, face, minerals } = rock;
  const run = (shader, uniforms, into, layer = 0) => {
    const pass = renderer.fullscreen(new Material({ name: 'rock-texture', shader, uniforms }));
    pass.render(into, { layer });
    pass.dispose();
  };
  // Heights in metres: half floats, read texel by texel.
  const heights = createTarget(renderer.gpu, { name: 'rock heights', width: size, height: size, format: 'rgba16float', sampler: { mag: 'nearest', min: 'nearest', wrap: 'repeat' } });
  run(tileShader, {
    uTile: { value: tile },
    uSeed: { value: new Vector2(rng.range(0, 1000), rng.range(0, 1000)) },
    uShift: { value: new Vector2(...shift) },
    uBlocks: { value: new Vector4(blocks.size, blocks.regular, blocks.crack, blocks.bevel) },
    uShape: { value: new Vector4(shape.rounding, shape.tilt, shape.proud, shape.gapes) },
    uFace: { value: new Vector4(face.roughness, face.pitSize, face.pits, face.pitDepth) },
    uMinerals: { value: new Vector3(minerals.size, minerals.share, minerals.speckle) },
  }, heights);
  run(formShader, { uHeights: { value: heights.color }, uTile: { value: tile }, uTexels: { value: size } }, target, layers.rock);
  heights.dispose(); // the form pass is submitted: it keeps what it reads

  return pixels('rock').then((texels) => {
    const [first, second] = mineralTints(minerals);
    const sum = [0, 0, 0, 0];
    let clipped = 0;
    for (let i = 0; i < texels.length; i += 4) {
      const factor = (2 * texels[i + 2]) / 255;
      const share = texels[i + 3] / 255;
      for (let c = 0; c < 3; c++) sum[c] += factor * (first[c] + share * (second[c] - first[c]));
      sum[3] += factor;
      if (texels[i + 2] === 255) clipped++;
    }
    if (clipped > 0.001 * size * size) {
      throw new Error(`rock tile: the albedo's factor clips at 2 in ${((100 * clipped) / (size * size)).toFixed(1)}% of its texels (config.world.terrain.rock)`);
    }
    return { mean: new Vector4(...sum.map((v) => v / (size * size))) };
  });
}

// The uniforms chunks/rock.wgsl reads: the tile's (makeRockTile), and
// config.world.terrain.rock.
export function rockUniforms(tile, rock) {
  const { relief, streaks, strata, lichen, wet, roughness, minerals } = rock;
  return {
    uRockMean: { value: tile.mean },
    uRockTints: { value: mineralTints(minerals).map((t) => new Vector3(...t)) },
    uRockScales: { value: new Vector2(rock.tile, rock.detail) },
    uRockRelief: { value: new Vector4(relief.scale, relief.height, relief.sharp, relief.stretch) },
    uRockTone: { value: rock.tone },
    uRockEdge: { value: new Vector4(rock.edge.rim, rock.edge.rimSlope, rock.edge.drift, rock.edge.driftSlope) },
    uRockStreaks: { value: new Vector4(...streaks.colour, streaks.strength) },
    uRockStrata: { value: new Vector4(strata.spacing, strata.tone, strata.ledges, 0) },
    uRockLichen: { value: new Vector4(...lichen.colour, lichen.cover) },
    uRockLichenSecond: { value: new Vector4(...lichen.second, lichen.share) },
    uRockWet: { value: new Vector4(wet.ragged, wet.dark, ...wet.band) },
    uRockBand: { value: new Vector2(wet.bandDark, wet.bandRagged) },
    uRockRoughness: { value: new Vector2(roughness.dry, roughness.wet) },
    uRockRange: { value: rock.range },
  };
}

// The two minerals' colour factors over the tile's factor: the second's tint at its brightness.
function mineralTints({ tints: [first, second], brightness }) {
  return [first, second.map((v) => v * brightness)];
}
