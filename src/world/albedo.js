// The ground's albedo seen from above, over one of world/heightmap.js's grids:
// what sends the light on the ground back up into shade (chunks/lighting.wgsl
// groundAlbedo). The surfaces' albedos (config.world.terrain.albedo) mixed as
// the ground has them (world/island.js groundOf and lushOf) and as
// world/terrain.wgsl mixes them on average: sand wet below the waves' reach,
// the green as chunks/green.wgsl averages it; and the sea's albedo over
// water. Pure.
import { smoothstep } from './island.js';
import { GROUND } from './heightmap.js';
import { greenByBand, greenCover } from './green.js';

// How wet sand is at this height above the sea, 1 under a film of water and 0
// dry: the twin of chunks/wet.wgsl's groundWet, with `film` and `dry` from
// config.world.terrain.sand.wetness and `wetHeight` the wet sand's zone.
export function sandWetness(height, { film, dry }, wetHeight) {
  if (height <= film) return 1;
  if (height <= wetHeight) return 1 + ((0.35 - 1) * (height - film)) / (wetHeight - film);
  return 0.35 * (1 - smoothstep(wetHeight, dry, height));
}

// The green's albedo on average at this band, how lush and how sandy
// (chunks/green.wgsl greenAlbedo), into `out`: of its living green and bare
// ground (sand, soil, litter), by their shares per band
// (config.world.terrain.green; world/green.js).
export function greenAlbedo(band, lush, sandy, { albedo, green }, out = [0, 0, 0]) {
  const cover = greenCover(band, lush, green);
  const litter = greenByBand(green.litter, band);
  for (let c = 0; c < 3; c++) {
    const living = albedo.grass[c] + (albedo.leafy[c] - albedo.grass[c]) * lush;
    const soil = albedo.soil[c] + (albedo.drySand[c] - albedo.soil[c]) * sandy;
    const bare = soil + (albedo.litter[c] - soil) * litter;
    out[c] = bare + (living - bare) * cover;
  }
  return out;
}

// The albedo of ground with these shares of sand and rock, this band, this
// height above the sea, this lush and sandy, into `out` (linear RGB). The
// sand darkens with its wetness as chunks/sand.wgsl darkens it.
export function albedoOf(sand, rock, band, height, lush, sandy, surfaces, out = [0, 0, 0]) {
  const { albedo, wetness, wetHeight, sea } = surfaces;
  if (height < 0) {
    out[0] = sea[0];
    out[1] = sea[1];
    out[2] = sea[2];
    return out;
  }
  const dry = 1 - smoothstep(0.2, 0.5, sandWetness(height, wetness, wetHeight));
  const green = Math.max(1 - sand - rock, 0);
  greenAlbedo(band, lush, sandy, surfaces, out);
  for (let c = 0; c < 3; c++) {
    const sandC = albedo.wetSand[c] + (albedo.drySand[c] - albedo.wetSand[c]) * dry;
    out[c] = sand * sandC + rock * albedo.rock[c] + green * out[c];
  }
  return out;
}

// RGBA per sample of a grid (heightmap.js levels[k]: heights, info, ground),
// alpha 1.
export function albedoMap({ heights, info, ground }, surfaces) {
  const map = new Float32Array(4 * heights.length);
  const rgb = [0, 0, 0];
  for (let n = 0; n < heights.length; n++) {
    const g = GROUND * n;
    albedoOf(ground[g] / 255, ground[g + 1] / 255, info[4 * n + 2], heights[n], ground[g + 2] / 255, ground[g + 3] / 255, surfaces, rgb);
    map.set(rgb, 4 * n);
    map[4 * n + 3] = 1;
  }
  return map;
}
