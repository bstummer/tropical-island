// How a tile read twice, at two sizes, drifts over the water (water/water.wgsl's
// gusts, water-foam.wgsl's lace). Pure and Node-importable.
//
// twoDrifting(speed, [large, small], [x, z], loop) -> Vector4: how the two reads drift
// at `speed` (m/s) the way [x, z] (unit, in the world), in tiles/s: a whole number of
// tiles in `loop` s along each of their axes, so nothing jumps as their time wraps. The
// larger read is turned as water-seabed.wgsl's SEABED_TURN. The loop has to hold many
// tiles, or rounding to whole ones moves them slower or faster and off their way.
import { Vector4 } from '../maths/index.js';

export function twoDrifting(speed, [large, small], [x, z], loop) {
  const tiles = (along, size) => Math.round((along * speed * loop) / size) / loop;
  return new Vector4(tiles(0.8 * x - 0.6 * z, large), tiles(0.6 * x + 0.8 * z, large), tiles(x, small), tiles(z, small));
}

// The two reads' drifts as they go over the water: [[x, z] m/s of the larger, of the smaller].
export function driftsOf(drift, [large, small]) {
  return [
    [(0.8 * drift.x + 0.6 * drift.y) * large, (-0.6 * drift.x + 0.8 * drift.y) * large],
    [drift.z * small, drift.w * small],
  ];
}
