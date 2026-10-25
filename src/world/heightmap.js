// The island as the GPU draws it: grids of samples of world/island.js in the
// cove's frame (island.js), laid out for each island: a coarse one out to the
// deep sea, and inside it a fine one over the land and the sea you can see
// into (config.world.terrain). Pure and Node-importable; world/terrain.js
// uploads the grids as textures, and chunks/terrain.wgsl samples them exactly
// as heightAt() does here, so JS knows the height the camera sees.
//
// Level k is a grid of `samples` x `samples` points, `texel` metres apart,
// from `origin` [a, o] (layoutLevel), finest first. Each level lies inside
// the next coarser one. A point takes its height from the finest level that
// covers it, blended into the next coarser one over the last `blend` samples
// before that level's edge, so there is no seam where a level ends; between
// samples, on a curve through them (cubic), so they leave no corners.
//
// Per sample, `heights` holds the height, `info` four values: the slope along
// a and along o (rise over run, from the grid itself), the ground's band and
// the reef's offset; and `ground` GROUND bytes, of 255: how much of the ground
// is sand and how much rock (island.js groundOf, given the steepest the drawn
// ground gets next to the sample, so no sand lies on a drawn cliff, and the
// steepest the land under its roughness gets there, which rock goes by), how
// lush the green is (island.js lushOf, given the grid's relief: fillLush, once
// the grid is whole), and how sandy the soil is (groundOf). Between samples the ground is read as the GPU reads
// it, so placement and the drawn ground agree (the screenshot tool's terrain
// check compares them).

// Bytes per sample of the ground: sand, rock, lush, sandy.
export const GROUND = 4;

// A grid laid out for the island is a multiple of this many samples across:
// the GPU's mipmaps halve a texture's size, rounding down, so their first five
// levels average whole blocks of samples, as filtering them assumes.
const ALIGN = 32;

// Level k of `settings` (config.world.terrain) for an island: { texel,
// origin, samples }. A level with a `centre` lies there, `samples` across
// (its own or the settings'). Otherwise the coarsest covers the island out to
// where the sea is deep all round (island.js coveBounds), and a finer one
// the samples of the next coarser one higher than `depth` metres under the
// sea, once that is built (`coarser`, with its heights; null until then):
// grown by one of those samples, for what lies between them, and by its own
// blend band, so they lie where it has its full say. Its samples lie on the
// coarser one's lines, so where both have a sample it is the same height.
export function layoutLevel(island, settings, k, coarser = null) {
  const level = settings.levels[k];
  const { texel } = level;
  if (level.centre) {
    const samples = level.samples ?? settings.samples;
    return { texel, samples, origin: [level.centre[0] - (samples / 2) * texel, level.centre[1] - (samples / 2) * texel] };
  }
  if (k === settings.levels.length - 1) {
    const { minA, maxA, minO, maxO } = island.coveBounds;
    return square([minA - texel, maxA + texel, minO - texel, maxO + texel], texel, texel, [0, 0]);
  }
  if (!coarser) return null;
  const { origin, texel: step, samples: n, heights } = coarser;
  let [i0, i1, j0, j1] = [n, -1, n, -1];
  for (let j = 0; j < n; j++) {
    for (let i = 0; i < n; i++) {
      if (!(heights[j * n + i] > -level.depth)) continue;
      i0 = Math.min(i0, i);
      i1 = Math.max(i1, i);
      j0 = Math.min(j0, j);
      j1 = Math.max(j1, j);
    }
  }
  if (i1 < 0) throw new Error(`terrain: no ground on the ${step} m grid higher than ${level.depth} m under the sea`);
  const grow = step + (settings.blend + 1) * texel;
  const fitted = square([origin[0] + i0 * step - grow, origin[0] + i1 * step + grow, origin[1] + j0 * step - grow, origin[1] + j1 * step + grow], texel, step, origin);
  // Inside the coarser one, which has its full say but at its last sample.
  const end = (fitted.samples - 1) * texel;
  for (const c of [0, 1]) {
    if (fitted.origin[c] < origin[c] + step || fitted.origin[c] + end > origin[c] + (n - 2) * step) {
      throw new Error(`terrain: the ${texel} m grid reaches past the ${step} m grid round it`);
    }
  }
  return fitted;
}

// Catmull-Rom's weights at t (0 to 1 between samples 0 and 1) for the samples
// at -1, 0, 1 and 2, into `out` (chunks/terrain.wgsl terrainCubicWeights).
// Between two samples the curve can overshoot them by up to about 7% of the
// largest step between neighbours.
export function cubicWeights(t, out) {
  const t2 = t * t;
  const t3 = t2 * t;
  out[0] = 0.5 * (-t3 + 2 * t2 - t);
  out[1] = 0.5 * (3 * t3 - 5 * t2 + 2);
  out[2] = 0.5 * (-3 * t3 + 4 * t2 + t);
  out[3] = 0.5 * (t3 - t2);
  return out;
}

// The smallest square of samples `texel` apart, a multiple of ALIGN across,
// that holds the box [minA, maxA, minO, maxO], its corner on the lines `step`
// apart through `lines` [a, o].
function square([minA, maxA, minO, maxO], texel, step, lines) {
  const origin = [lines[0] + Math.floor((minA - lines[0]) / step) * step, lines[1] + Math.floor((minO - lines[1]) / step) * step];
  const span = Math.max(maxA - origin[0], maxO - origin[1]);
  const samples = Math.ceil((Math.ceil(span / texel) + 1) / ALIGN) * ALIGN;
  return { texel, origin, samples };
}

// Evaluates rows [j0, j1) of a level ({ texel, origin, samples }) into
// `heights`, `info` and `ground` (see the top; all but how lush, which
// fillLush adds), one row after another. The slopes need the rows either
// side, so those are evaluated too: one-sided differences only at the grid's
// edges. Used by the workers that build the grids in parallel
// (heightmap-worker.js).
export function fillRows(island, level, j0, j1, heights, info, ground) {
  const [a0, o0] = level.origin;
  const { texel, samples } = level;
  const lo = Math.max(j0 - 1, 0);
  const hi = Math.min(j1 + 1, samples);
  const rows = new Float32Array((hi - lo) * samples);
  const lands = new Float32Array((hi - lo) * samples); // the land under its roughness
  const kept = new Float64Array(4 * (j1 - j0) * samples); // coast, beach, rise, reef of rows j0 to j1
  const out = {};
  for (let j = lo; j < hi; j++) {
    for (let i = 0; i < samples; i++) {
      island.evaluate(a0 + i * texel, o0 + j * texel, out);
      rows[(j - lo) * samples + i] = out.height;
      lands[(j - lo) * samples + i] = out.land;
      if (j < j0 || j >= j1) continue;
      const n = 4 * ((j - j0) * samples + i);
      kept[n] = out.coast;
      kept[n + 1] = out.beach;
      kept[n + 2] = out.rise;
      kept[n + 3] = out.reef;
    }
  }
  const at = (i, j) => rows[(j - lo) * samples + i];
  const land = (i, j) => lands[(j - lo) * samples + i];
  // The most a corner of the cells between columns i0..i1 and rows jb..jf
  // rises over a texel, squared, of `h`.
  const steepest = (h, i0, i1, jb, jf) => {
    let most = 0;
    for (let cj = jb; cj < jf; cj++) {
      for (let ci = i0; ci < i1; ci++) {
        const rise = Math.max(Math.abs(h(ci + 1, cj) - h(ci, cj)), Math.abs(h(ci + 1, cj + 1) - h(ci, cj + 1)));
        const climb = Math.max(Math.abs(h(ci, cj + 1) - h(ci, cj)), Math.abs(h(ci + 1, cj + 1) - h(ci + 1, cj)));
        most = Math.max(most, rise * rise + climb * climb);
      }
    }
    return most;
  };
  const s = {};
  const g = {};
  for (let j = j0; j < j1; j++) {
    for (let i = 0; i < samples; i++) {
      const i0 = Math.max(i - 1, 0);
      const i1 = Math.min(i + 1, samples - 1);
      const jb = Math.max(j - 1, 0);
      const jf = Math.min(j + 1, samples - 1);
      const along = (at(i1, j) - at(i0, j)) / ((i1 - i0) * texel);
      const across = (at(i, jf) - at(i, jb)) / ((jf - jb) * texel);
      // The ground is judged by the steepest the drawn ground gets in the
      // cells round the sample, which share its ground. Bilinear, a cell is
      // steepest at a corner, where its slope is the two edges' that meet
      // there. The slopes above would average a cliff with the flat ground
      // beside it, and see a gully's floor or a ridge's crest as flat. The
      // land under the roughness alike, for rock.
      const slope = Math.sqrt(steepest(at, i0, i1, jb, jf)) / texel;
      const under = Math.sqrt(steepest(land, i0, i1, jb, jf)) / texel;
      const n = (j - j0) * samples + i;
      s.coast = kept[4 * n];
      s.beach = kept[4 * n + 1];
      s.rise = kept[4 * n + 2];
      s.reef = kept[4 * n + 3];
      s.height = at(i, j);
      s.a = a0 + i * texel;
      s.o = o0 + j * texel;
      island.groundOf(s, slope, g, under);
      heights[n] = at(i, j);
      info[4 * n] = along;
      info[4 * n + 1] = across;
      info[4 * n + 2] = g.band;
      info[4 * n + 3] = g.reef;
      // Sand and rock never make more than the whole.
      const rock = Math.round(g.rock * 255);
      ground[GROUND * n] = Math.min(Math.round(g.sand * 255), 255 - rock);
      ground[GROUND * n + 1] = rock;
      ground[GROUND * n + 3] = Math.round(g.sandy * 255);
    }
  }
}

// Fills how lush the green is into a level's ground (`level`: its layout and
// heights, info and ground, filled by fillRows), from its relief: how far each
// sample stands above the mean of the samples within the island's
// zones.lush.radius of it, in a square, cut off at the grid's edges. Once the
// level's rows are all in: the mean reaches across them. 0 under the sea.
export function fillLush(island, { origin, texel, samples, heights, info, ground }) {
  const { radius } = island.settings.zones.lush;
  const sums = new Float64Array(samples * samples);
  const line = new Float64Array(samples + 1);
  const g = {};
  const reach = Math.max(1, Math.round(radius / texel));
  // The square's sums, a row then a column at a time, from running sums.
  const boxSums = (read, write) => {
    for (let line0 = 0; line0 < samples; line0++) {
      line[0] = 0;
      for (let i = 0; i < samples; i++) line[i + 1] = line[i] + read(line0, i);
      for (let i = 0; i < samples; i++) write(line0, i, line[Math.min(i + reach + 1, samples)] - line[Math.max(i - reach, 0)]);
    }
  };
  boxSums((j, i) => heights[j * samples + i], (j, i, sum) => (sums[j * samples + i] = sum));
  const across = new Float64Array(sums);
  boxSums((i, j) => across[j * samples + i], (i, j, sum) => (sums[j * samples + i] = sum));
  const count = (i) => Math.min(i + reach, samples - 1) - Math.max(i - reach, 0) + 1;
  for (let j = 0; j < samples; j++) {
    for (let i = 0; i < samples; i++) {
      const n = j * samples + i;
      if (heights[n] < 0) continue; // nothing green grows under the sea: 0
      const relief = heights[n] - sums[n] / (count(i) * count(j));
      g.band = info[4 * n + 2];
      ground[GROUND * n + 2] = Math.round(island.lushOf(g, relief, origin[0] + i * texel, origin[1] + j * texel) * 255);
    }
  }
}

// The grids, laid out coarsest first, a finer one as soon as the coarser one
// it is fitted to is in (layoutLevel), and stored a block of rows at a time
// in any order, as the workers return them (heightmap-worker.js).
// onLayout(k, layout) hears of each level as it is laid out, so its rows can
// be handed out. Once a level's rows are all in, its lush is filled and
// onLevel(k, level) hears of it, so work on a level starts while the others
// are still being built; whatever the order, the grids come out the same.
// finish(), once every row is in: the sampler (createHeightmap).
export function createGrids(island, settings, { onLayout = () => {}, onLevel = () => {} } = {}) {
  const count = settings.levels.length;
  const levels = new Array(count); // each once laid out: its layout, heights, info and ground
  const rowsIn = new Array(count).fill(0);
  const done = (k) => levels[k] !== undefined && rowsIn[k] === levels[k].samples;
  // A level waits for the coarser one it is fitted to, and the finer ones for it.
  const layOut = () => {
    for (let k = count - 1; k >= 0; k--) {
      if (levels[k]) continue;
      const layout = layoutLevel(island, settings, k, k + 1 < count && done(k + 1) ? levels[k + 1] : null);
      if (!layout) return;
      const n = layout.samples * layout.samples;
      levels[k] = { ...layout, heights: new Float32Array(n), info: new Float32Array(4 * n), ground: new Uint8Array(GROUND * n) };
      onLayout(k, layout);
    }
  };
  layOut();
  return {
    levels,
    // Rows j0 on of level k, as fillRows filled them.
    store({ level: k, j0, heights, info, ground }) {
      const level = levels[k];
      const { samples } = level;
      level.heights.set(heights, j0 * samples);
      level.info.set(info, 4 * j0 * samples);
      level.ground.set(ground, GROUND * j0 * samples);
      rowsIn[k] += heights.length / samples;
      if (rowsIn[k] < samples) return;
      layOut();
      fillLush(island, level);
      onLevel(k, level);
    },
    finish() {
      if (!levels.every((_, k) => done(k))) {
        throw new Error(`heightmap: rows missing (${levels.map((level, k) => `${rowsIn[k]} of ${level?.samples ?? '?'}`).join(', ')} per level)`);
      }
      return createHeightmap(island, settings, levels);
    },
  };
}

// Builds every level in this thread. The game uses workers; tests use this.
export function buildHeightmap(island, settings) {
  const due = []; // levels laid out, their rows still to fill
  const grids = createGrids(island, settings, { onLayout: (k, level) => due.push([k, level]) });
  while (due.length) {
    const [k, level] = due.shift();
    const n = level.samples * level.samples;
    const heights = new Float32Array(n);
    const info = new Float32Array(4 * n);
    const ground = new Uint8Array(GROUND * n);
    fillRows(island, level, 0, level.samples, heights, info, ground);
    grids.store({ level: k, j0: 0, heights, info, ground });
  }
  return grids.finish();
}

// The sampler over `levels` ([{ texel, origin, samples, heights, info,
// ground }], filled), finest first.
export function createHeightmap(island, { blend }, levels) {
  // How much level k has its say at a, o: 1 well inside, falling to 0 over the
  // last `blend` samples before its edge (keeping the sample beyond for cubic()).
  function weight(k, a, o) {
    const { origin, texel, samples } = levels[k];
    const last = samples - 1;
    const fx = (a - origin[0]) / texel;
    const fy = (o - origin[1]) / texel;
    const inside = Math.min(fx, fy, last - fx, last - fy) - 1;
    return Math.min(1, Math.max(0, inside / blend));
  }

  // Catmull-Rom from the 4 x 4 samples around a, o, clamped at the grid's
  // edges, as chunks/terrain.wgsl reads them: a curve through the samples
  // whose slope runs on across them, so the ground has no corners at its
  // samples, as straight lines between them would give it.
  const wa = new Float64Array(4);
  const wo = new Float64Array(4);
  function cubic(k, a, o) {
    const { origin, texel, samples, heights } = levels[k];
    const last = samples - 1;
    const fx = Math.min(Math.max((a - origin[0]) / texel, 0), last);
    const fy = Math.min(Math.max((o - origin[1]) / texel, 0), last);
    const i = Math.min(Math.floor(fx), last - 1);
    const j = Math.min(Math.floor(fy), last - 1);
    cubicWeights(fx - i, wa);
    cubicWeights(fy - j, wo);
    let h = 0;
    for (let y = 0; y < 4; y++) {
      const row = Math.min(Math.max(j - 1 + y, 0), last) * samples;
      let line = 0;
      for (let x = 0; x < 4; x++) line += wa[x] * heights[row + Math.min(Math.max(i - 1 + x, 0), last)];
      h += wo[y] * line;
    }
    return h;
  }

  // The drawn height at a, o in the cove's frame, from level `from` or coarser.
  function heightAtCove(a, o, from = 0) {
    for (let k = from; k < levels.length - 1; k++) {
      const w = weight(k, a, o);
      if (w <= 0) continue;
      const h = cubic(k, a, o);
      if (w >= 1) return h;
      const coarser = cubic(k + 1, a, o);
      return coarser + (h - coarser) * w;
    }
    return cubic(levels.length - 1, a, o);
  }

  // Adds `share` of level k's ground at a, o to `out`, bilinear as the GPU
  // filters it (texel centres on the samples, clamped at the edges).
  function addGround(k, a, o, share, out) {
    const { origin, texel, samples, info, ground } = levels[k];
    const last = samples - 1;
    const fx = Math.min(Math.max((a - origin[0]) / texel, 0), last);
    const fy = Math.min(Math.max((o - origin[1]) / texel, 0), last);
    const i = Math.min(Math.floor(fx), last - 1);
    const j = Math.min(Math.floor(fy), last - 1);
    const tx = fx - i;
    const ty = fy - j;
    const n = j * samples + i;
    // Channel c of `values`, `stride` to a sample, bilinear between the four samples around.
    const mix = (values, stride, c) => {
      const bottom = values[stride * n + c] + (values[stride * (n + 1) + c] - values[stride * n + c]) * tx;
      const top = values[stride * (n + samples) + c] + (values[stride * (n + samples + 1) + c] - values[stride * (n + samples) + c]) * tx;
      return bottom + (top - bottom) * ty;
    };
    out.sand += (share * mix(ground, GROUND, 0)) / 255;
    out.rock += (share * mix(ground, GROUND, 1)) / 255;
    out.lush += (share * mix(ground, GROUND, 2)) / 255;
    out.sandy += (share * mix(ground, GROUND, 3)) / 255;
    out.band += share * mix(info, 4, 2);
    out.reef += share * mix(info, 4, 3);
  }

  // The ground at a, o in the cove's frame ({ sand, rock, band, reef, lush,
  // sandy }, as island.js groundOf and lushOf), as the GPU reads it: from the
  // finest level there, blended into the next coarser one.
  function groundAtCove(a, o, out = {}) {
    out.sand = out.rock = out.band = out.reef = out.lush = out.sandy = 0;
    let left = 1; // the share still to fill, finest level first
    for (let k = 0; k < levels.length && left > 0; k++) {
      const w = k === levels.length - 1 ? 1 : weight(k, a, o);
      if (w <= 0) continue;
      addGround(k, a, o, left * w, out);
      left *= 1 - w;
    }
    return out;
  }

  const scratch = {};
  const zoneAtCove = (a, o) => island.zoneFrom(groundAtCove(a, o, scratch), heightAtCove(a, o));

  return {
    levels,
    heightAtCove,
    groundAtCove,
    zoneAtCove,
    // The drawn height, ground and zone at world x, z: what placement reads.
    heightAt: (x, z) => heightAtCove(...island.toCove(x, z)),
    groundAt: (x, z, out) => groundAtCove(...island.toCove(x, z), out),
    zoneAt: (x, z) => zoneAtCove(...island.toCove(x, z)),
  };
}
