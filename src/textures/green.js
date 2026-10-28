// The green inland (PLAN.md Stage 4): its detail, made on the GPU at boot, two
// tiles that repeat, which chunks/green.wgsl reads in ways that hide it.
//   grass   short grass from straight above (grass.wgsl): the colour's factor
//           over the blades and the depths between them (rgb, a quarter of
//           it), how much the blades cover (a)
//   litter  fallen leaves from straight above (litter.wgsl): the normal's x
//           and y (rg, tangent space), the tone from light to dark (b), its
//           leaves' tones spread evenly over 0 to 1 (litter-tones.js), how
//           much a leaf covers (a)
//   leaves  the litter's masks (litter-tones.js litterLevels): how much the
//           lightest leaves of each of leafShares cover (rgba)
// Drawn into their layers of textures/surfaces.js's array, the litter's and
// its leaves' with their mip levels once read back, so they are in once the
// promise resolves. grassMean is the grass's factor on average, grassCover
// and litterCover how much the blades and the leaves cover, as
// chunks/green.wgsl lays two reads of each tile over each other
// (world/green.js greenLayers), from the tiles' own averages read back once,
// so the green keeps its albedo on average. leafShares: the masks' shares of
// the leaves, lightest first: those the bare ground shows at the scrub, the
// palm belt and the jungle (config.world.terrain.green.litter, of the leaves'
// cover), and half, for the green leaves between. Settings:
// config.world.terrain.green.
import { Vector2, Vector3, Vector4 } from '../maths/index.js';
import grassShader from './grass.wgsl';
import litterShader from './litter.wgsl';
import levelShader from './litter-tones.wgsl';
import { Material } from '../gpu/material.js';
import { createTarget, Texture } from '../gpu/texture.js';
import { greenLayers } from '../world/green.js';
import { litterLevels } from './litter-tones.js';

// into: textures/surfaces.js's { renderer, target, layers, size, shift, pixels }.
// Draws the tiles; returns a promise of { grassMean, grassCover, litterCover, leafShares }.
export function makeGreenTiles({ renderer, target, layers, size, shift, pixels }, rng, { tiles, straw, depths, litter: bare }) {
  // Draws into `into`, at layer `layer` of it.
  const make = (shader, tile, own, into, layer) => {
    const uniforms = {
      uTile: { value: tile },
      uTexels: { value: size },
      uSeed: { value: new Vector2(rng.range(0, 1000), rng.range(0, 1000)) },
      uShift: { value: new Vector2(...shift) },
      ...own,
    };
    const pass = renderer.fullscreen(new Material({ name: 'green-texture', shader, uniforms }));
    pass.render(into, { layer });
    pass.dispose();
  };
  make(grassShader, tiles.grass, { uStraw: { value: new Vector3(...straw) }, uDepths: { value: depths } }, target, layers.grass);
  // The litter aside first, then into its layer with its tones evened out,
  // and its leaves' masks into theirs, with their mip levels, over those
  // textures/surfaces.js made.
  const drawn = createTarget(renderer.gpu, { name: 'litter as drawn', width: size, height: size, format: 'rgba8unorm' });
  make(litterShader, tiles.litter, {}, drawn, 0);

  return Promise.all([pixels('grass'), drawn.color.read()]).then(([grass, litter]) => {
    drawn.dispose();
    const sum = [0, 0, 0, 0];
    for (let i = 0; i < grass.length; i += 4) for (let c = 0; c < 4; c++) sum[c] += grass[i + c];
    const texels = 255 * size * size;
    let covered = 0;
    for (let i = 3; i < litter.length; i += 4) covered += litter[i]; // the cover as drawn, which the tones leave
    const blades = greenLayers(sum[3] / texels, sum.slice(0, 3).map((v) => (4 * v) / texels), depths);
    const litterCover = greenLayers(covered / texels).cover;
    const leafShares = [...bare.map((share) => Math.min(share / litterCover, 1)), 0.5].sort((a, b) => a - b);

    // Unless the tiles went meanwhile (a quality change while loading).
    if (target.color.texture) {
      const made = litterLevels(litter, size, leafShares);
      const pass = renderer.fullscreen(new Material({ name: 'litter-level', shader: levelShader, uniforms: { uLevel: { value: null } } }));
      for (const name of ['litter', 'leaves']) {
        made[name].forEach((bytes, level) => {
          const across = size >> level;
          const texture = new Texture(renderer.gpu, { name: `${name} level`, width: across, height: across, format: 'rgba8unorm', data: true }).upload(bytes);
          pass.uniforms.uLevel.value = texture;
          pass.render(target, { layer: layers[name], level });
          texture.destroy();
        });
      }
      pass.dispose();
    }
    return { grassMean: new Vector3(...blades.mean), grassCover: blades.cover, litterCover, leafShares: new Vector4(...leafShares) };
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
    uLeafShares: { value: tiles.leafShares ?? new Vector4() },
    uGrassDepths: { value: green.depths },
    uGreenTiles: { value: new Vector3(green.tiles.grass, green.tiles.litter, green.tiles.crumbs) },
    uLeafLight: { value: vector(green.leaves.light) },
    uLeafDark: { value: vector(green.leaves.dark) },
    uGreenRange: { value: green.range },
    uGreenClumps: { value: new Vector2(green.clumps.strength, green.clumps.size) },
  };
}
