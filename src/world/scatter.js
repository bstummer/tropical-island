// Things scattered over the ground by rules: rocks now (world/rock-placement.js),
// plants in Stages 8–9. A rule keeps a candidate in some cells of a grid in
// the cove's frame, jittered within its cell, where the ground at its spot
// allows: the ground as drawn (world/heightmap.js), what the GPU draws and
// placement reads. Every choice about a cell comes from a hash of the cell and
// the rule's seed, so a candidate stays put when another rule changes or the
// region grows.
//
// Placed things keep clear of each other: each claims its footprint across
// the ground in a clearance (createClearance), and a thing whose footprint
// would overlap one already there isn't placed; they may touch. So the order
// decides who wins: rules in the order they run, and within a rule the larger
// footprint first. A rule's things stay put when a later rule changes; an
// earlier rule's change, or a region that grows, can only keep or drop them
// where they meet what changed (a drop can let another of them in), never move
// them. Pure and Node-importable.
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

// The things `rule` places within `region` that keep clear of `clearance`,
// which they join. rule: { seed (an integer), cell (m apart), chance (that a
// cell has a candidate), where (see allows) }; `where` may also hold `coast`:
// how far inland from the coast (m, negative out to sea: `island`'s,
// world/island.js), worked out last as it is slow. region: { a: [min, max],
// o: [min, max] } in the cove's frame, and optionally `radius` round its
// origin. make(a, o, ground, random) makes the thing for a candidate, or
// nothing: random(k) is the cell's k-th number in [0, 1), for its own choices
// (k 0 to 2 are scatter's). A thing has a `footprint` (see createClearance).
export function scatter(heightmap, island, rule, region, make, clearance) {
  const { seed, cell, chance } = rule;
  const { coast, ...where } = rule.where;
  const ground = {};
  const sample = {};
  let i;
  let j;
  const random = (k) => cellHash(i, j, (seed + 7919 * k) | 0);
  const [a0, a1] = region.a;
  const [o0, o1] = region.o;
  const radius2 = (region.radius ?? Infinity) ** 2;
  const made = [];
  for (j = Math.floor(o0 / cell); j * cell < o1; j++) {
    for (i = Math.floor(a0 / cell); i * cell < a1; i++) {
      if (random(0) >= chance) continue;
      const a = (i + random(1)) * cell;
      const o = (j + random(2)) * cell;
      if (a < a0 || a > a1 || o < o0 || o > o1 || a * a + o * o > radius2) continue;
      if (!allows(where, groundSample(heightmap, a, o, ground))) continue;
      if (coast) {
        ground.coast = island.evaluate(a, o, sample).coast;
        if (!allows({ coast }, ground)) continue;
      }
      const thing = make(a, o, ground, random);
      if (thing) made.push(thing);
    }
  }
  // Largest first, else in the order of the cells: sort keeps ties in order.
  made.sort((p, q) => area(q.footprint) - area(p.footprint));
  return made.filter((thing) => clearance.claim(thing.footprint));
}

// Footprints placed things claim across the ground, in the cove's frame. A
// footprint is a convex polygon, [[a, o], ...] in order round it.
// claim(footprint) adds it and returns true if it keeps clear of every
// footprint already claimed, touching at most; else returns false. `cell`: m,
// the side of the buckets it sorts them into, about the size of a large one.
export function createClearance(cell = 8) {
  const buckets = new Map();
  // The buckets a footprint's box reaches into.
  const bucketsOf = (footprint) => {
    const as = footprint.map(([a]) => Math.floor(a / cell));
    const os = footprint.map(([, o]) => Math.floor(o / cell));
    const keys = [];
    for (let j = Math.min(...os); j <= Math.max(...os); j++) for (let i = Math.min(...as); i <= Math.max(...as); i++) keys.push(`${i},${j}`);
    return keys;
  };
  return {
    claim(footprint) {
      const keys = bucketsOf(footprint);
      if (!keys.every((key) => (buckets.get(key) ?? []).every((other) => apart(footprint, other)))) return false;
      for (const key of keys) {
        if (!buckets.has(key)) buckets.set(key, []);
        buckets.get(key).push(footprint);
      }
      return true;
    },
  };
}

// Whether two convex polygons keep apart, touching at most: some edge of one
// separates them (the separating axis theorem in the plane).
function apart(p, q) {
  return separates(p, q) || separates(q, p);
}

function separates(edges, other) {
  for (let k = 0; k < edges.length; k++) {
    const [a, o] = edges[k];
    const [na, no] = edges[(k + 1) % edges.length];
    const axis = [o - no, na - a]; // across the edge
    let [min1, max1, min2, max2] = [Infinity, -Infinity, Infinity, -Infinity];
    for (const [pa, po] of edges) {
      const d = pa * axis[0] + po * axis[1];
      [min1, max1] = [Math.min(min1, d), Math.max(max1, d)];
    }
    for (const [pa, po] of other) {
      const d = pa * axis[0] + po * axis[1];
      [min2, max2] = [Math.min(min2, d), Math.max(max2, d)];
    }
    const scale = Math.hypot(...axis);
    if (max1 <= min2 + 1e-9 * scale || max2 <= min1 + 1e-9 * scale) return true;
  }
  return false;
}

function area(polygon) {
  let sum = 0;
  polygon.forEach(([a, o], k) => {
    const [na, no] = polygon[(k + 1) % polygon.length];
    sum += a * no - na * o;
  });
  return Math.abs(sum) / 2;
}

// The convex hull of points [[a, o], ...], in order round it: a footprint.
export function hull(points) {
  const sorted = points.slice().sort((p, q) => p[0] - q[0] || p[1] - q[1]);
  const turn = (o, p, q) => (p[0] - o[0]) * (q[1] - o[1]) - (p[1] - o[1]) * (q[0] - o[0]);
  const half = (list) => {
    const out = [];
    for (const p of list) {
      while (out.length >= 2 && turn(out.at(-2), out.at(-1), p) <= 0) out.pop();
      out.push(p);
    }
    return out.slice(0, -1);
  };
  return [...half(sorted), ...half(sorted.reverse())];
}
