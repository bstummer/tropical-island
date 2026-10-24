// The green inland (PLAN.md Stage 4): its detail, made on the GPU at boot, two
// tiles that repeat, which chunks/green.wgsl reads in ways that hide it.
//   grass   short grass from straight above (grass.wgsl): the colour's factor
//           over the blades and the depths between them (rgb, a quarter of
//           it), how much the blades cover (a)
//   litter  fallen leaves from straight above (litter.wgsl): the normal's x
//           and y (rg, tangent space), the tone from light to dark (b), how
//           much a leaf covers (a)
// Drawn into their layers of textures/surfaces.js's array. grassMean is the
// grass's factor on average, grassCover and litterCover how much the blades
// and the leaves cover, read back once (so they come as a promise), so the
// green keeps its albedo on average. Settings: config.world.terrain.green.
import { Vector2, Vector3, Vector4 } from 'three';
import grassShader from './grass.wgsl';
import litterShader from './litter.wgsl';
import { Material } from '../gpu/material.js';

// into: textures/surfaces.js's { renderer, target, layers, size, shift, pixels }.
// Draws the tiles; returns a promise of { grassMean, grassCover, litterCover }.
export function makeGreenTiles({ renderer, target, layers, size, shift, pixels }, rng, { tiles, straw, depths }) {
  const make = (shader, tile, layer, own = {}) => {
    const uniforms = {
      uTile: { value: tile },
      uTexels: { value: size },
      uSeed: { value: new Vector2(rng.range(0, 1000), rng.range(0, 1000)) },
      uShift: { value: new Vector2(...shift) },
      ...own,
    };
    const pass = renderer.fullscreen(new Material({ name: 'green-texture', shader, uniforms }));
    pass.render(target, { layer });
    pass.dispose();
  };
  make(grassShader, tiles.grass, layers.grass, { uStraw: { value: new Vector3(...straw) }, uDepths: { value: depths } });
  make(litterShader, tiles.litter, layers.litter);

  return Promise.all([pixels('grass'), pixels('litter')]).then(([grass, litter]) => {
    const sum = [0, 0, 0, 0];
    for (let i = 0; i < grass.length; i += 4) for (let c = 0; c < 4; c++) sum[c] += grass[i + c];
    const texels = 255 * size * size;
    let covered = 0;
    for (let i = 3; i < litter.length; i += 4) covered += litter[i];
    return {
      grassMean: new Vector3(...sum.slice(0, 3).map((v) => (4 * v) / texels)),
      grassCover: sum[3] / texels,
      litterCover: covered / texels,
    };
  });
}

// The uniforms chunks/green.wgsl reads: the tiles' (makeGreenTiles), the
// albedos (config.world.terrain.albedo), config.world.terrain.green and the
// patches' two seeds (world/green.js greenPatches).
export function greenUniforms(tiles, albedo, green, seeds) {
  const vector = (v) => new Vector3(...v);
  return {
    uGrass: { value: vector(albedo.grass) },
    uLeafy: { value: vector(albedo.leafy) },
    uSoil: { value: vector(albedo.soil) },
    uLitter: { value: vector(albedo.litter) },
    uGreenOpen: { value: vector(green.cover.open) },
    uGreenLush: { value: vector(green.cover.lush) },
    uGreenLitter: { value: vector(green.litter) },
    uGreenTone: { value: new Vector4(...green.tone.change, green.tone.wavelength) },
    uGreenPatches: { value: new Vector2(green.patches.size, green.patches.sharp) },
    uGreenSeeds: { value: new Vector2(...seeds) },
    uGrassMean: { value: tiles.grassMean },
    uGrassCover: { value: tiles.grassCover },
    uLitterCover: { value: tiles.litterCover },
    uGreenTiles: { value: new Vector3(green.tiles.grass, green.tiles.litter, green.tiles.crumbs) },
    uLeafLight: { value: vector(green.leaves.light) },
    uLeafDark: { value: vector(green.leaves.dark) },
    uGreenRange: { value: green.range },
    uGreenClumps: { value: new Vector2(green.clumps.strength, green.clumps.size) },
    uGreenStand: { value: green.stand },
  };
}
