// Tool fixture (?fixture=green-tiles): the green's detail tiles
// (textures/green.js) as chunks/green.wgsl reads them, the island's own (the
// same stream, settings and size as world/terrain.js's). Draws nothing. Not
// part of the island.
//
// greenTile lays two reads of a tile over each other, which on average must
// hold what world/green.js greenLayers says from the tile's own averages, at
// every distance: at seeded points over metres of ground, seen by pixels from
// under a texel to the most green() reads the tiles at, the GPU's averages of
// the grass's colour factor and cover and of the litter's tone and cover go
// against greenLayers', and with the ground between the covers taken as
// nothing, a deliberate mistake.
//
// greenLeaves shows as many of the litter's leaves as their share asks, the
// lightest first (dead ones, over the bare ground) or the darkest (green ones,
// over the grass), from their masks (textures/litter-tones.js) and their
// tones, and green() gives each a factor by its tone over the one
// greenShownTone says those shown have on average. At the same pixels, the
// green near the camera at the scrub behind a beach, the palm belt and the
// jungle, its leaves as green() shows them (its formulas, copied), against
// its albedo, by luminance: where a pixel sees a leaf's own tone or none of it
// (greenLeafOwn), and between, where it mixes the tones of a few; and with the
// leaves at half their share, a deliberate mistake.
//
// window.__GREEN_TILES__ = { points, footprints, layers: { gpu, mistaken },
// lifts: { sharp, between, mistaken } }: how far the GPU lands from
// greenLayers at worst (relative for the grass's colour, else absolute); and
// how much lighter (+) or darker the green reads at worst, as { lift, at }.
import shader from './green-tiles.wgsl';
import { Material } from '../gpu/material.js';
import { createTarget } from '../gpu/texture.js';
import { createSurfaceTiles, tilesUniforms } from '../textures/surfaces.js';
import { sandUniforms } from '../textures/sand.js';
import { greenUniforms } from '../textures/green.js';
import { greenByBand, greenCover, greenLayers } from '../world/green.js';

const SIDE = 256; // points across the output: SIDE * SIDE of them
const SPACING = 0.0731; // m between them, over many repeats of either tile and either read
// Metres a pixel spans: from under a texel to where green() stops reading the
// tiles (its `near`), through where it mixes the leaves' tones: between OWN
// texels of the litter's tile (chunks/green.wgsl greenLeafOwn).
const FOOTPRINTS = [0.0005, 0.003, 0.006, 0.01, 0.015, 0.02, 0.03, 0.05];
const OWN = [1, 6];
// The green at the scrub behind a beach, the palm belt and the jungle, and
// between the first two, where its share of litter lies between two of the
// leaves' masks: [band, lush, sandy].
const CASES = { scrub: [0.3, 0.1, 0.8], 'scrub to palm belt': [0.8, 0.2, 0.5], 'palm belt': [1.5, 0.3, 0.2], jungle: [3, 0.9, 0] };
const LUMINANCE = [0.2126, 0.7152, 0.0722]; // of linear sRGB

export function create(ctx) {
  const { renderer, config, quality, gpu } = ctx;
  const { terrain } = config.world;
  const tiles = createSurfaceTiles(renderer, ctx.rng, 'terrain', terrain, quality.surfaceTexture);

  const ready = (async () => {
    const averages = await tiles.ready;
    const litter = await tiles.pixels('litter');
    const pass = renderer.fullscreen(
      new Material({
        name: 'fixture-green-tiles',
        shader,
        uniforms: {
          ...tilesUniforms(tiles),
          ...sandUniforms(averages.sand, terrain.sand, config.world.island.zones.wetSand, config.sky.sun.sunsetYaw),
          ...greenUniforms(averages.green, terrain.albedo, terrain.green, [1, 2]),
          uMode: { value: 0 },
          uFootprint: { value: 0 },
          uShare: { value: 0 },
          uMistaken: { value: 0 },
          uSpacing: { value: SPACING },
        },
      }),
    );
    const target = createTarget(gpu, { name: 'fixture-green-tiles', width: SIDE, height: SIDE, format: 'rgba32float' });
    // Each channel's average over the points.
    const mean = async (mode, footprint, { share = 0, mistaken = 0 } = {}) => {
      const u = pass.uniforms;
      u.uMode.value = mode;
      u.uFootprint.value = footprint;
      u.uShare.value = share;
      u.uMistaken.value = mistaken;
      pass.render(target);
      const values = await target.color.read();
      const sum = [0, 0, 0, 0];
      for (let i = 0; i < values.length; i += 4) for (let c = 0; c < 4; c++) sum[c] += values[i + c];
      return sum.map((s) => s / (SIDE * SIDE));
    };

    // What greenLayers says: the grass's as textures/green.js has it, the litter's tone from its texels.
    const { grassMean, grassCover } = averages.green;
    const texels = 255 * (litter.length / 4);
    let tone = 0;
    let covered = 0;
    for (let i = 0; i < litter.length; i += 4) {
      tone += litter[i + 2];
      covered += litter[i + 3];
    }
    const litterLayers = greenLayers(covered / texels, [tone / texels], 0.5);
    const layers = { gpu: 0, mistaken: 0 };
    for (const footprint of FOOTPRINTS) {
      for (const mistaken of [0, 1]) {
        const [r, g, b, a] = await mean(0, footprint, { mistaken });
        const [t, c] = await mean(1, footprint, { mistaken });
        const misses = [r / grassMean.x - 1, g / grassMean.y - 1, b / grassMean.z - 1, a - grassCover, t - litterLayers.mean[0], c - litterLayers.cover];
        const key = mistaken ? 'mistaken' : 'gpu';
        layers[key] = Math.max(layers[key], ...misses.map(Math.abs));
      }
    }

    // The green near the camera: the bare ground under its dead leaves, the
    // grass under its green ones, in its shares of each, as green() has them.
    const { albedo, green } = terrain;
    const lum = (rgb) => rgb.reduce((sum, v, c) => sum + v * LUMINANCE[c], 0);
    const mixed = (a, b, t) => a.map((v, c) => v + (b[c] - v) * t);
    const texel = green.tiles.litter / quality.surfaceTexture;
    const worst = () => ({ lift: 0, at: '' });
    const lifts = { sharp: worst(), between: worst(), mistaken: worst() };
    for (const [name, [band, lush, sandy]] of Object.entries(CASES)) {
      const litterShare = greenByBand(green.litter, band);
      const freshShare = 0.6 * lush;
      const soil = mixed(albedo.soil, albedo.drySand, sandy);
      const living = mixed(albedo.grass, albedo.leafy, lush);
      const cover = greenCover(band, lush, green);
      const plain = lum(mixed(mixed(soil, albedo.litter, litterShare), living, cover));
      for (const footprint of FOOTPRINTS) {
        for (const mistaken of [0, 1]) {
          // What the leaves show, over nothing, and how much they cover.
          const dead = await mean(2, footprint, { share: litterShare, mistaken });
          const fresh = await mean(3, footprint, { share: freshShare, mistaken });
          const bare = soil.map((s, c) => s * (1 - dead[3]) + albedo.litter[c] * dead[c]);
          const grass = living.map((l, c) => l * (1 - fresh[3] + fresh[c])); // the grass averages to the living green
          const lift = lum(mixed(bare, grass, cover)) / plain - 1;
          const between = footprint > OWN[0] * texel && footprint < OWN[1] * texel;
          const key = mistaken ? 'mistaken' : between ? 'between' : 'sharp';
          if (Math.abs(lift) > Math.abs(lifts[key].lift)) lifts[key] = { lift, at: `the ${name}, pixels ${1000 * footprint} mm across` };
        }
      }
    }

    target.dispose();
    pass.dispose();
    window.__GREEN_TILES__ = { points: SIDE * SIDE, footprints: FOOTPRINTS.length, layers, lifts };
  })();

  return {
    ready,
    update() {},
    dispose() {
      tiles.dispose();
      delete window.__GREEN_TILES__;
    },
  };
}
