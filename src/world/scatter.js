// Things scattered over the ground by rules: rocks now (world/rock-placement.js),
// plants in Stages 8–9. A rule keeps a candidate in some cells of a grid in
// the cove's frame, jittered within its cell, where the ground at its spot
// allows: the ground as drawn (world/heightmap.js), what the GPU draws and
// placement reads. Every choice about a cell comes from a hash of the cell and
// the rule's seed, so a rule's things stay put when another rule changes or
// the region grows. Pure and Node-importable.
import { cellHash } from './noise.js';

const DEG = 180 / Math.PI;
const SLOPE_STEP = 0.5; // m either side, for the slope

// The ground at a, o in the cove's frame, into `out`: heightmap.groundAtCove's
// sand, rock, band and reef, the height above the sea (m) and the slope
// (degrees, by differences across a metre).
export function groundSample(heightmap, a, o, out = {}) {
  heightmap.groundAtCove(a, o, out);
  const h = heightmap.heightAtCove;
  out.height = h(a, o);
  const da = h(a + SLOPE_STEP, o) - h(a - SLOPE_STEP, o);
  const dO = h(a, o + SLOPE_STEP) - h(a, o - SLOPE_STEP);
  out.slope = Math.atan(Math.hypot(da, dO) / (2 * SLOPE_STEP)) * DEG;
  return out;
}

// Whether `ground` (groundSample's) meets `where`: { field: [min, max] }.
export function allows(where, ground) {
  for (const field in where) {
    const [min, max] = where[field];
    if (!(ground[field] >= min && ground[field] <= max)) return false;
  }
  return true;
}

// Calls visit(a, o, ground, random) for each candidate of `rule` kept within
// `region`. rule: { seed (an integer), cell (m apart), chance (that a cell
// has one), where (see allows) }; region: { a: [min, max], o: [min, max] } in
// the cove's frame, and optionally `radius` round its origin. random(k) is
// the cell's k-th number in [0, 1), for the visitor's own choices: k 0 to 2
// are scatter's.
export function scatter(heightmap, rule, region, visit) {
  const { seed, cell, chance, where } = rule;
  const ground = {};
  let i;
  let j;
  const random = (k) => cellHash(i, j, (seed + 7919 * k) | 0);
  const [a0, a1] = region.a;
  const [o0, o1] = region.o;
  const radius2 = (region.radius ?? Infinity) ** 2;
  for (j = Math.floor(o0 / cell); j * cell < o1; j++) {
    for (i = Math.floor(a0 / cell); i * cell < a1; i++) {
      if (random(0) >= chance) continue;
      const a = (i + random(1)) * cell;
      const o = (j + random(2)) * cell;
      if (a < a0 || a > a1 || o < o0 || o > o1 || a * a + o * o > radius2) continue;
      if (allows(where, groundSample(heightmap, a, o, ground))) visit(a, o, ground, random);
    }
  }
}
