// Where the green grows inland (PLAN.md Stage 4): the ground that is neither
// sand nor rock is living green over a share of it (greenCover, by its band
// and how lush it is) and bare ground over the rest, in patches a few metres
// across that lie where they lie, whatever the camera does. chunks/green.glsl
// draws them, and this is its twin (greenCover, greenPatches), so placement
// (Stage 9) knows which ground is green and which bare. Pure and
// Node-importable.
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
// ground at world x, z is green where it falls below greenCover there. Near
// the camera chunks/green.glsl frays their edges by a blade or two, which
// this leaves out.
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
