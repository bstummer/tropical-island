// The island's own shade (PLAN.md Stage 5): where its relief hides the sun,
// from the camera's feet to the far side of the island. Pure and
// Node-importable; sky/shadows.js uploads it for every lit material
// (chunks/shadows.wgsl), which reads it as shadeAt() and shadeAbove() do here.
//
// The time of day changes only when it is set (PLAN.md, Decisions), so the
// shade is worked out once per time, over the whole island at once: the same
// wherever the camera stands, at any distance. Per sample p of a grid over the
// coarsest level of the heightmap, looking along the ground towards the sun:
//
//   visible  the share of the sun's disk the ground at p sees over its
//            horizon that way (sunDisk): soft as far as the disk makes it, so
//            the softer the further the ridge that casts it
//   top      the height at p under which the island hides the sun's centre:
//            the most any ground beyond q stands over the sun's line,
//            max over q of H(q) - (t(q) - t(p)) tan(e)
//   reach    how far that ground lies, t(q*) - t(p)
//   around   the share of the ground in the sun about `around` metres round
//            p, `visible` averaged over that box: the light from below
//
// where t runs towards the sun and e is its height. What stands above the
// ground (a rock, a palm's crown) at height y sees the sun's centre stand
// atan(tan(e) + (top - y) / reach) - e under the horizon. That takes in only
// the ground that hides the sun's centre: nearer ground that grazes the sun's
// line can hide the disk's lower edge as well, so at and just above the ground
// it misses the outer half of a far ridge's soft edge, as on level ground at a
// low sun, and the ground reads `visible` instead, from its true horizon. What
// stands on the ground goes from the ground's `visible` at its foot to the
// share at its height over ABOVE_GROUND metres (shadeAbove): it sees no less
// than the ground and no more than that share, and nearer ground that hides
// the disk's edge from the ground hides it less from higher up.
//
// Worked out in a grid turned to the sun, whose rows run towards it, a row
// at a time: along a row the horizon is the tangent to the upper hull of the
// ground beyond, and the top a running max. Then back onto the grid, between
// the turned samples around each of its own. The strips between neighbouring
// rows don't depend on each other, so the shade is worked out in bands of
// them (shadeStrips), the same however it is cut: sky/shadows.js hands the
// bands to a pool of workers (shade-worker.js) and has one more put them
// together (shadeMerger), a fraction of the time it takes in one thread.

import { toHalfFloat } from '../maths/index.js';

const NONE = -1e9; // nothing beyond: the shade's top lies below everything
const TOP_LIMIT = 1000; // m: tops are kept within this of the sea, which half floats hold to a metre
const REACH_LIMIT = 60000; // m, within half floats too
const FLAT = -1e4; // the horizon's slope where nothing lies beyond: straight down
const MARGIN = 2; // texels past the grid that the turned rows run: the grid's samples read the turned ones round them
const BAND = 64; // strips worked out at a time in one thread
// m above the ground over which what stands on it goes from the ground's share
// of the sun to the share at its height (shadeAbove; sky/shadows.js hands it to the GPU).
export const ABOVE_GROUND = 2;

// The grid the shade is worked out on: over the coarsest level of `levels`,
// from its origin, `texel` metres apart, as many samples as halve it
// exactly as the coarsest one does (heightmap.js gridAlign).
export function shadeLayout(levels, texel) {
  const coarse = levels.at(-1);
  const per = coarse.texel / texel;
  if (!Number.isInteger(per)) throw new Error(`shade: ${texel} m doesn't divide the ${coarse.texel} m grid`);
  return { origin: [...coarse.origin], texel, samples: coarse.samples * per };
}

// The share of the sun's disk that stands above a horizon `x` of its radii
// above the disk's centre: 1 for -1 and below, 0 for 1 and above.
export function sunDisk(x) {
  if (x >= 1) return 0;
  if (x <= -1) return 1;
  return (Math.acos(x) - x * Math.sqrt(1 - x * x)) / Math.PI;
}

// The share of the sun seen from `below` metres under the shade's top, which
// ground `reach` metres off casts, for a sun at sin e, cos e whose disk is
// `radius` radians across its middle.
export function seen(below, reach, sinE, cosE, radius) {
  // The horizon's angle over the sun's centre, atan(tan e + below / reach) - e,
  // as the angle between the two directions (chunks/shadows.wgsl alike).
  return sunDisk(Math.atan2(below * cosE * cosE, reach + below * sinE * cosE) / radius);
}

// The island's shade for the sun in `direction` ([a, y, o], towards the sun,
// in the cove's frame: island.js toCove turns a world direction into it),
// over `levels` (heightmap.js's, with their heights, finest first), `texel`
// metres apart, with a sun's disk `radius` radians across its middle (art
// may widen it: config.shadows), `around` metres across what the light
// from below averages. Returns the layout with `visible`, `top`, `reach`
// and `around` per sample, row by row, and the sun's `elevation`
// (radians) and `radius`.
export function islandShade(levels, direction, { texel, radius, around = 0 }) {
  const layout = shadeLayout(levels, texel);
  const n = layout.samples;
  const heights = latticeHeights(levels, layout);
  const turned = turnShade(layout, direction);
  const shade = { ...layout, elevation: turned.elevation, radius, visible: new Float32Array(n * n), top: new Float32Array(n * n), reach: new Float32Array(n * n) };
  for (const [first, end] of shadeBands(turned, BAND)) {
    const piece = shadeStrips(heights, layout, turned, radius, first, end);
    for (const name of ['visible', 'top', 'reach']) placePiece(piece, n, piece[name], shade[name]);
  }
  shade.around = boxBlur(shade.visible, n, blurRadius(around, texel));
  return shade;
}

// The grid of `layout` turned to the sun in `direction` (as islandShade
// takes it): t towards the sun, w across it, a texel apart, over the grid's
// corners. A point at t, w lies at a, o = t (sa, so) + w (-so, sa). The
// shade is worked out over its `strips`, each between two neighbouring rows.
// A sun overhead (`overhead`) shades nothing: one strip, all in sun.
export function turnShade({ origin, texel, samples: n }, direction) {
  const across = Math.hypot(direction[0], direction[2]);
  const elevation = Math.atan2(direction[1], across);
  if (across < 1e-6) return { elevation, overhead: true, strips: 1 };
  const sa = direction[0] / across;
  const so = direction[2] / across;
  const end = (n - 1) * texel;
  let [tMin, tMax, wMin, wMax] = [Infinity, -Infinity, Infinity, -Infinity];
  for (const [a, o] of [[origin[0], origin[1]], [origin[0] + end, origin[1]], [origin[0], origin[1] + end], [origin[0] + end, origin[1] + end]]) {
    const t = a * sa + o * so;
    const w = -a * so + o * sa;
    [tMin, tMax, wMin, wMax] = [Math.min(tMin, t), Math.max(tMax, t), Math.min(wMin, w), Math.max(wMax, w)];
  }
  const nt = Math.ceil((tMax - tMin) / texel) + 2;
  const nw = Math.ceil((wMax - wMin) / texel) + 2;
  return { elevation, sa, so, tanE: direction[1] / across, tMin, tMax, wMin, nt, strips: nw - 1 };
}

// The strips of `turned` in bands of at most `size`: [first, end) each.
export function shadeBands({ strips }, size) {
  const bands = [];
  for (let first = 0; first < strips; first += size) bands.push([first, Math.min(first + size, strips)]);
  return bands;
}

// The shade at the grid's samples in strips `first` to `end` - 1 of `turned`
// (the first band also takes what lies short of its first strip, the last
// what lies past its last, by rounding), over the grid's `heights`
// (latticeHeights), for a sun's disk `radius` radians across its middle. A
// piece: per row of the grid, the run of its samples there in `runs`
// ([start, end) per row), and their visible, top and reach, run after run.
export function shadeStrips(heights, layout, turned, radius, first, end) {
  const { origin, texel, samples: n } = layout;
  const runs = new Int32Array(2 * n);
  if (turned.overhead) {
    for (let j = 0; j < n; j++) runs[2 * j + 1] = n;
    const count = n * n;
    return { runs, visible: new Float32Array(count).fill(1), top: new Float32Array(count).fill(-TOP_LIMIT), reach: new Float32Array(count).fill(REACH_LIMIT) };
  }
  const { elevation, sa, so, tanE, tMin, tMax, wMin, nt, strips } = turned;
  const toGrid = 1 / texel;

  // The turned rows round the strips: per sample, its horizon's slope, the
  // most ground beyond stands over the sun's line (H - t tan e), and where.
  // Each row runs from its far end over the grid, MARGIN texels wider:
  // nothing past it, kilometres out in the deep, casts shade.
  const rows = end - first + 1;
  const slope = new Float32Array(rows * nt);
  const most = new Float32Array(rows * nt);
  const at = new Float32Array(rows * nt);
  const hullT = new Float64Array(nt);
  const hullH = new Float64Array(nt);
  const [aLo, oLo] = [origin[0] - MARGIN * texel, origin[1] - MARGIN * texel];
  const [aHi, oHi] = [origin[0] + (n - 1 + MARGIN) * texel, origin[1] + (n - 1 + MARGIN) * texel];
  for (let row = 0; row < rows; row++) {
    const w = wMin + (first + row) * texel;
    // Where the row crosses the wider grid: t between where it meets each side.
    let [t0, t1] = [-Infinity, Infinity];
    for (const [along, offset, lo, hi] of [[sa, -w * so, aLo, aHi], [so, w * sa, oLo, oHi]]) {
      if (Math.abs(along) < 1e-12) {
        if (offset < lo || offset > hi) t1 = -Infinity;
        continue;
      }
      const [ta, tb] = [(lo - offset) / along, (hi - offset) / along];
      [t0, t1] = [Math.max(t0, Math.min(ta, tb)), Math.min(t1, Math.max(ta, tb))];
    }
    const k0 = Math.max(0, Math.floor((t0 - tMin) * toGrid));
    const k1 = Math.min(nt - 1, Math.ceil((t1 - tMin) * toGrid));
    const base = row * nt;
    let best = NONE;
    let bestT = tMax + REACH_LIMIT;
    let size = 0;
    let k = 0; // the last tangent: the next one is mostly the same or near it
    for (let it = k1; it >= k0; it--) {
      const t = tMin + it * texel;
      const h = bilinear(heights, n, (t * sa - w * so - origin[0]) * toGrid, (t * so + w * sa - origin[1]) * toGrid);
      most[base + it] = best;
      at[base + it] = bestT;
      const f = h - t * tanE;
      if (f > best) {
        best = f;
        bestT = t;
      }
      // The horizon: the steepest line from here to the hull of what lies
      // beyond, whose slope rises from the farthest of it to the tangent and
      // falls from there to the nearest: walked to from the last tangent.
      // Slopes compared without dividing: (h1 - h) / dt1 >= (h0 - h) / dt0.
      if (size === 0) slope[base + it] = FLAT;
      else {
        k = Math.min(k, size - 1);
        while (k + 1 < size && (hullH[k + 1] - h) * (hullT[k] - t) >= (hullH[k] - h) * (hullT[k + 1] - t)) k++;
        while (k > 0 && (hullH[k - 1] - h) * (hullT[k] - t) > (hullH[k] - h) * (hullT[k - 1] - t)) k--;
        slope[base + it] = (hullH[k] - h) / (hullT[k] - t);
      }
      // Then onto the hull, leaving out what lies under the line from here
      // over it: nothing nearer can see it over that.
      while (size >= 2) {
        const bt = hullT[size - 1] - t;
        const bh = hullH[size - 1] - h;
        if (bt * (hullH[size - 2] - h) - bh * (hullT[size - 2] - t) < 0) break;
        size--;
      }
      hullT[size] = t;
      hullH[size] = h;
      size++;
    }
  }

  // The grid's samples in the strips: w runs one way along each row of the
  // grid, so they are a run of it, found by halving. Every band works w out
  // alike, so each sample lies in one band's strips.
  const wAt = (a, o) => (-a * so + o * sa - wMin) * toGrid;
  const lowest = first === 0 ? -Infinity : first;
  const highest = end === strips ? Infinity : end;
  const rising = so <= 0; // w along a row: rising, or falling
  let count = 0;
  for (let j = 0; j < n; j++) {
    const o = origin[1] + j * texel;
    const inside = (i, bound) => (rising ? wAt(origin[0] + i * texel, o) >= bound : wAt(origin[0] + i * texel, o) < bound);
    const start = firstWhere(n, (i) => inside(i, rising ? lowest : highest));
    const stop = firstWhere(n, (i) => inside(i, rising ? highest : lowest));
    runs[2 * j] = start;
    runs[2 * j + 1] = Math.max(start, stop);
    count += runs[2 * j + 1] - start;
  }
  // Each between the turned samples round it, bilinear. The sun's disk
  // only where the horizon is within its radius of the sun's centre.
  const tanLow = elevation - 2 * radius > -Math.PI / 2 ? Math.tan(elevation - radius * (1 + 1e-6)) : -Infinity;
  const tanHigh = elevation + 2 * radius < Math.PI / 2 ? Math.tan(elevation + radius * (1 + 1e-6)) : Infinity;
  const visible = new Float32Array(count);
  const top = new Float32Array(count);
  const reach = new Float32Array(count);
  let out = 0;
  for (let j = 0; j < n; j++) {
    const o = origin[1] + j * texel;
    for (let i = runs[2 * j]; i < runs[2 * j + 1]; i++, out++) {
      const a = origin[0] + i * texel;
      const fw = wAt(a, o);
      const jw = Math.min(Math.max(Math.floor(fw), first), end - 1);
      const v = Math.min(Math.max(fw - jw, 0), 1);
      const t = a * sa + o * so;
      const ft = Math.min(Math.max((t - tMin) * toGrid, 0), nt - 1);
      const it = Math.min(Math.floor(ft), nt - 2);
      const u = ft - it;
      const near = (jw - first) * nt + it;
      const far = near + nt;
      const w00 = (1 - u) * (1 - v);
      const w10 = u * (1 - v);
      const w01 = (1 - u) * v;
      const w11 = u * v;
      const s = slope[near] * w00 + slope[near + 1] * w10 + slope[far] * w01 + slope[far + 1] * w11;
      const m = most[near] * w00 + most[near + 1] * w10 + most[far] * w01 + most[far + 1] * w11;
      const q = at[near] * w00 + at[near + 1] * w10 + at[far] * w01 + at[far + 1] * w11;
      visible[out] = s >= tanHigh ? 0 : s <= tanLow ? 1 : sunDisk((Math.atan(s) - elevation) / radius);
      top[out] = Math.min(Math.max(m + t * tanE, -TOP_LIMIT), TOP_LIMIT);
      reach[out] = Math.min(Math.max(q - t, texel), REACH_LIMIT);
    }
  }
  return { runs, visible, top, reach };
}

// The first of 0 .. n - 1 where `holds` does (n if none), for one that
// doesn't up to some point and does from there on.
function firstWhere(n, holds) {
  let [lo, hi] = [0, n];
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (holds(mid)) hi = mid;
    else lo = mid + 1;
  }
  return lo;
}

// A piece's values, `per` a sample, from `from` into `into`, the grid's n x n
// samples row by row.
function placePiece({ runs }, n, from, into, per = 1) {
  let k = 0;
  for (let j = 0; j < n; j++) {
    const count = (runs[2 * j + 1] - runs[2 * j]) * per;
    into.set(from.subarray(k, k + count), (j * n + runs[2 * j]) * per);
    k += count;
  }
}

// A piece as a worker hands it on: its runs, its visible (the share around
// averages it over the whole grid) and its texels as packShade has them, but
// for `around`.
export function packPiece({ runs, visible, top, reach }) {
  const texels = new Uint16Array(4 * visible.length);
  for (let k = 0; k < visible.length; k++) {
    texels[4 * k] = toHalfFloat(visible[k]);
    texels[4 * k + 1] = toHalfFloat(top[k]);
    texels[4 * k + 2] = toHalfFloat(reach[k]);
  }
  return { runs, visible, texels };
}

// Puts packed pieces together (`place`, in any order) into the shade's texels
// as packShade has them, with `around` (finish), for the grid of `layout`.
export function shadeMerger({ texel, samples: n }, around) {
  const visible = new Float32Array(n * n);
  const texels = new Uint16Array(4 * n * n);
  return {
    place(piece) {
      placePiece(piece, n, piece.visible, visible);
      placePiece(piece, n, piece.texels, texels, 4);
    },
    finish() {
      const blurred = boxBlur(visible, n, blurRadius(around, texel));
      for (let k = 0; k < blurred.length; k++) texels[4 * k + 3] = toHalfFloat(blurred[k]);
      return texels;
    },
  };
}

// The samples either side the share around averages over, `around` metres across.
function blurRadius(around, texel) {
  return Math.round(around / (2 * texel));
}

// values (n x n, row by row) averaged over the box `r` samples either side,
// along rows then columns (all of them at once, a row at a time), the
// edges' samples standing in beyond them.
function boxBlur(values, n, r) {
  if (r < 1) return values.slice();
  const width = 2 * r + 1;
  const clamp = (k) => Math.min(Math.max(k, 0), n - 1);
  const rows = new Float32Array(n * n);
  for (let j = 0; j < n; j++) {
    const row = j * n;
    let sum = 0;
    for (let k = -r; k <= r; k++) sum += values[row + clamp(k)];
    for (let k = 0; k < n; k++) {
      rows[row + k] = sum / width;
      sum += values[row + clamp(k + r + 1)] - values[row + clamp(k - r)];
    }
  }
  const out = new Float32Array(n * n);
  const sums = new Float64Array(n);
  for (let k = -r; k <= r; k++) {
    const row = clamp(k) * n;
    for (let i = 0; i < n; i++) sums[i] += rows[row + i];
  }
  for (let j = 0; j < n; j++) {
    const [row, add, drop] = [j * n, clamp(j + r + 1) * n, clamp(j - r) * n];
    for (let i = 0; i < n; i++) {
      out[row + i] = sums[i] / width;
      sums[i] += rows[add + i] - rows[drop + i];
    }
  }
  return out;
}

// The shade as its texture holds it (rgba16float): per sample, row by row,
// visible, top, reach and around as half floats.
export function packShade({ samples, visible, top, reach, around }) {
  const texels = new Uint16Array(4 * samples * samples);
  for (let k = 0; k < visible.length; k++) {
    texels[4 * k] = toHalfFloat(visible[k]);
    texels[4 * k + 1] = toHalfFloat(top[k]);
    texels[4 * k + 2] = toHalfFloat(reach[k]);
    texels[4 * k + 3] = toHalfFloat(around[k]);
  }
  return texels;
}

// The ground's share of the sun at a, o in the cove's frame, as the GPU reads
// it from the shade's texture: bilinear, texel centres on the samples, clamped
// at the edges.
export function shadeAt(shade, a, o) {
  const { origin, texel, samples, visible } = shade;
  return bilinear(visible, samples, (a - origin[0]) / texel, (o - origin[1]) / texel);
}

// The share of the ground in the sun around a, o, as the GPU reads it.
export function shadeAround(shade, a, o) {
  const { origin, texel, samples, around } = shade;
  return bilinear(around, samples, (a - origin[0]) / texel, (o - origin[1]) / texel);
}

// The share of the sun at height y above the sea at a, o, for what stands on
// the ground there (a rock, a palm's crown), which lies at height `ground`, as
// the GPU reads it.
export function shadeAbove(shade, a, o, y, ground) {
  const { origin, texel, samples, top, reach, visible, elevation, radius } = shade;
  const fx = (a - origin[0]) / texel;
  const fy = (o - origin[1]) / texel;
  const high = seen(bilinear(top, samples, fx, fy) - y, bilinear(reach, samples, fx, fy), Math.sin(elevation), Math.cos(elevation), radius);
  const t = Math.min(Math.max((y - ground) / ABOVE_GROUND, 0), 1);
  return bilinear(visible, samples, fx, fy) + (high - bilinear(visible, samples, fx, fy)) * t * t * (3 - 2 * t);
}

// The heights at the grid's samples: the finest level's where it reaches,
// else the coarsest's, bilinear between their samples (on the grid's lines
// the finest's own samples). Out in the deep, where the finest gives way,
// nothing stands to cast shade. The same at any time of day: a worker works
// them out once.
export function latticeHeights(levels, { origin, texel, samples: n }) {
  const fine = levels[0];
  const coarse = levels.at(-1);
  const heights = new Float32Array(n * n);
  const fineLast = fine.samples - 1;
  for (let j = 0; j < n; j++) {
    const o = origin[1] + j * texel;
    const fy = (o - fine.origin[1]) / fine.texel;
    const cy = (o - coarse.origin[1]) / coarse.texel;
    for (let i = 0; i < n; i++) {
      const a = origin[0] + i * texel;
      const fx = (a - fine.origin[0]) / fine.texel;
      heights[j * n + i] =
        fx >= 0 && fy >= 0 && fx <= fineLast && fy <= fineLast
          ? bilinear(fine.heights, fine.samples, fx, fy)
          : bilinear(coarse.heights, coarse.samples, (a - coarse.origin[0]) / coarse.texel, cy);
    }
  }
  return heights;
}

// values (`width` across, `rows` down) at x, y in samples, bilinear, clamped
// at the edges.
function bilinear(values, width, x, y, rows = width) {
  const cx = Math.min(Math.max(x, 0), width - 1);
  const cy = Math.min(Math.max(y, 0), rows - 1);
  const i = Math.min(Math.floor(cx), width - 2);
  const j = Math.min(Math.floor(cy), rows - 2);
  const tx = cx - i;
  const ty = cy - j;
  const k = j * width + i;
  const bottom = values[k] + (values[k + 1] - values[k]) * tx;
  const top = values[k + width] + (values[k + width + 1] - values[k + width]) * tx;
  return bottom + (top - bottom) * ty;
}
