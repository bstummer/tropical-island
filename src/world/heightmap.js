// The island as the GPU draws it: nested grids of samples of world/island.js,
// finest around the cove, in the cove's frame (island.js). Pure and
// Node-importable; world/terrain.js uploads the grids as textures, and
// chunks/terrain.glsl samples them exactly as heightAt() does here, so JS
// knows the height the camera sees.
//
// Level k is a grid of `samples` x `samples` points, `texel` metres apart,
// from `origin` [a, o] (config.world.terrain.levels). Each level lies inside
// the next coarser one. A point takes its height from the finest level that
// covers it, blended into the next coarser one over the last `blend` samples
// before that level's edge, so there is no seam where a level ends.
//
// Per sample, `heights` holds the height, `info` four values: the slope along
// a and along o (rise over run, from the grid itself), the ground's band and
// the reef's offset; and `ground` GROUND bytes, of 255: how much of the ground
// is sand and how much rock (island.js groundOf, given the grid's slope), how
// lush the green is (island.js lushOf, given the grid's relief: fillLush, once
// the grid is whole), and how sandy the soil is (groundOf). Between samples the ground is read as the GPU reads
// it, so placement and the drawn ground agree (the screenshot tool's terrain
// check compares them).

// Bytes per sample of the ground: sand, rock, lush, sandy.
export const GROUND = 4;

// The levels' layout, from config.world.terrain.
export function layoutLevels({ levels, samples }) {
  return levels.map(({ texel, centre }) => ({
    texel,
    origin: [centre[0] - (samples / 2) * texel, centre[1] - (samples / 2) * texel],
  }));
}

// Evaluates rows [j0, j1) of level `level` into `heights`, `info` and `ground`
// (see the top; all but how lush, which fillLush adds), one row of `samples`
// after another. The slopes need the rows either side, so those are evaluated
// too: one-sided differences only at the grid's edges. Used by the workers
// that build the grids in parallel (heightmap-worker.js).
export function fillRows(island, level, samples, j0, j1, heights, info, ground) {
  const [a0, o0] = level.origin;
  const { texel } = level;
  const lo = Math.max(j0 - 1, 0);
  const hi = Math.min(j1 + 1, samples);
  const rows = new Float32Array((hi - lo) * samples);
  const kept = new Float64Array(3 * (j1 - j0) * samples); // coast, beach, reef of rows j0 to j1
  const out = {};
  for (let j = lo; j < hi; j++) {
    for (let i = 0; i < samples; i++) {
      island.evaluate(a0 + i * texel, o0 + j * texel, out);
      rows[(j - lo) * samples + i] = out.height;
      if (j < j0 || j >= j1) continue;
      const n = 3 * ((j - j0) * samples + i);
      kept[n] = out.coast;
      kept[n + 1] = out.beach;
      kept[n + 2] = out.reef;
    }
  }
  const at = (i, j) => rows[(j - lo) * samples + i];
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
      const n = (j - j0) * samples + i;
      s.coast = kept[3 * n];
      s.beach = kept[3 * n + 1];
      s.reef = kept[3 * n + 2];
      s.a = a0 + i * texel;
      s.o = o0 + j * texel;
      island.groundOf(s, Math.hypot(along, across), g);
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

// Fills how lush the green is into every level's ground (`data`: [{ heights,
// info, ground }], filled by fillRows), from its relief: how far each sample
// stands above the mean of the samples within the island's
// zones.lush.radius of it, in a square, cut off at the grid's edges. Once the
// rows are all in: the mean reaches across them. 0 under the sea.
export function fillLush(island, settings, data) {
  const { samples } = settings;
  const { radius } = island.settings.zones.lush;
  const sums = new Float64Array(samples * samples);
  const line = new Float64Array(samples + 1);
  const g = {};
  layoutLevels(settings).forEach(({ origin, texel }, k) => {
    const { heights, info, ground } = data[k];
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
  });
}
// Builds every level in this thread. The game uses workers; tests use this.
export function buildHeightmap(island, settings) {
  const { samples } = settings;
  const data = layoutLevels(settings).map((level) => {
    const heights = new Float32Array(samples * samples);
    const info = new Float32Array(4 * samples * samples);
    const ground = new Uint8Array(GROUND * samples * samples);
    fillRows(island, level, samples, 0, samples, heights, info, ground);
    return { heights, info, ground };
  });
  fillLush(island, settings, data);
  return createHeightmap(island, settings, data);
}

// The sampler over levels of `data` ([{ heights, info, ground }], filled).
export function createHeightmap(island, settings, data) {
  const { samples, blend } = settings;
  const levels = layoutLevels(settings).map((level, k) => ({ ...level, ...data[k] }));
  const last = samples - 1;

  // How much level k has its say at a, o: 1 well inside, falling to 0 over the
  // last `blend` samples before its edge (keeping one sample for bilinear).
  function weight(k, a, o) {
    const { origin, texel } = levels[k];
    const fx = (a - origin[0]) / texel;
    const fy = (o - origin[1]) / texel;
    const inside = Math.min(fx, fy, last - fx, last - fy) - 1;
    return Math.min(1, Math.max(0, inside / blend));
  }

  // Bilinear, from the four samples around a, o, as the GPU does with texelFetch.
  function bilinear(k, a, o) {
    const { origin, texel, heights } = levels[k];
    const fx = Math.min(Math.max((a - origin[0]) / texel, 0), last);
    const fy = Math.min(Math.max((o - origin[1]) / texel, 0), last);
    const i = Math.min(Math.floor(fx), last - 1);
    const j = Math.min(Math.floor(fy), last - 1);
    const tx = fx - i;
    const ty = fy - j;
    const n = j * samples + i;
    const bottom = heights[n] + (heights[n + 1] - heights[n]) * tx;
    const top = heights[n + samples] + (heights[n + samples + 1] - heights[n + samples]) * tx;
    return bottom + (top - bottom) * ty;
  }

  // The drawn height at a, o in the cove's frame, from level `from` or coarser.
  function heightAtCove(a, o, from = 0) {
    for (let k = from; k < levels.length - 1; k++) {
      const w = weight(k, a, o);
      if (w <= 0) continue;
      const h = bilinear(k, a, o);
      if (w >= 1) return h;
      const coarser = bilinear(k + 1, a, o);
      return coarser + (h - coarser) * w;
    }
    return bilinear(levels.length - 1, a, o);
  }

  // Adds `share` of level k's ground at a, o to `out`, bilinear as the GPU
  // filters it (texel centres on the samples, clamped at the edges).
  function addGround(k, a, o, share, out) {
    const { origin, texel, info, ground } = levels[k];
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
    samples,
    heightAtCove,
    groundAtCove,
    zoneAtCove,
    // The drawn height, ground and zone at world x, z: what placement reads.
    heightAt: (x, z) => heightAtCove(...island.toCove(x, z)),
    groundAt: (x, z, out) => groundAtCove(...island.toCove(x, z), out),
    zoneAt: (x, z) => zoneAtCove(...island.toCove(x, z)),
  };
}
