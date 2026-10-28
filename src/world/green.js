// Where the green grows inland (PLAN.md Stage 4): the ground that is neither
// sand nor rock is living green over a share of it (greenCover, by its band
// and how lush it is) and bare ground over the rest, in patches a few metres
// across that lie where they lie, whatever the camera does. chunks/green.wgsl
// draws them, and this is its twin (greenCover, greenPatches), so placement
// (Stage 9) knows which ground is green and which bare; and of what its
// detail tiles average to (greenLayers). Pure and Node-importable.
import { smoothstep } from './island.js';
import { seededNoise } from './noise.js';

// The patches' noise: two octaves, whose sum deviates by 0.182; the logistic
// curve spreads it about evenly over 0 to 1.
const K = 1.702 / 0.182;

// A value per band, from the scrub's through the palm belt's to the jungle's
// ([scrub, palm belt, jungle]), blended as world/island.js blends the bands.
export function greenByBand([scrub, palmBelt, jungle], band) {
  const v = scrub + (palmBelt - scrub) * smoothstep(0.5, 1.5, band);
  return v + (jungle - v) * smoothstep(1.67, 2.33, band);
}

// The share of the ground that is green, at this band and how lush
// (config.world.terrain.green.cover).
export function greenCover(band, lush, { cover }) {
  const open = greenByBand(cover.open, band);
  return open + (greenByBand(cover.lush, band) - open) * lush;
}

// The patches for config.world.terrain.green and two whole-number seeds:
// rank(x, z) is spread about evenly over 0 to 1 across the ground, and the
// ground at world x, z is green where it falls below greenCover there, from
// wherever it is seen. chunks/green.wgsl blurs their edges by (1 - sharp) x
// size / 20 m either side (10 cm at the defaults), or near the camera frays
// them as much, which this leaves out.
export function greenPatches({ patches }, seeds) {
  return {
    rank(x, z) {
      const a = x / patches.size;
      const b = z / patches.size;
      const v = 0.65 * seededNoise(a, b, seeds[0]) + 0.35 * seededNoise(3.1 * a, 3.1 * b, seeds[1]);
      return 1 / (1 + Math.exp(-K * v));
    },
  };
}

// What two reads of a detail tile laid one over the other (chunks/green.wgsl
// greenTile) average to, from the tile's own averages: `cover`, how much of it
// is covered, and `mean`, of what it holds (a colour, say: what covers it over
// `ground` where nothing does). The top read hides the other as far as it
// covers, so the two cover 1 - (1 - cover)². The reads lie at angles and
// scales that never line up, so they are independent, and a tile's mipmaps
// keep its averages: this holds at every distance.
export function greenLayers(cover, mean = [], ground = 0) {
  return { cover: 1 - (1 - cover) ** 2, mean: mean.map((m) => m + (1 - cover) * (m - ground)) };
}
