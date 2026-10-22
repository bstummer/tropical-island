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
// Per sample, `heights` holds the height and `info` four values: the slope
// along a and along o (rise over run, from the grid itself), the signed
// distance to the shore and how sandy the shore is (island.js sample()).

// The levels' layout, from config.world.terrain.
export function layoutLevels({ levels, samples }) {
  return levels.map(({ texel, centre }) => ({
    texel,
    origin: [centre[0] - (samples / 2) * texel, centre[1] - (samples / 2) * texel],
  }));
}

// Evaluates rows [j0, j1) of level `level` into `heights` (samples per row
// each) and the coast and beach of `info` (4 values per sample). Used by the
// workers that build the grids in parallel (heightmap-worker.js).
export function fillRows(island, level, samples, j0, j1, heights, info) {
  const out = {};
  const [a0, o0] = level.origin;
  for (let j = j0; j < j1; j++) {
    for (let i = 0; i < samples; i++) {
      island.evaluate(a0 + i * level.texel, o0 + j * level.texel, out);
      const n = (j - j0) * samples + i;
      heights[n] = out.height;
      info[4 * n + 2] = out.coast;
      info[4 * n + 3] = out.beach;
    }
  }
}

// The slope along a and o from each level's own samples: central differences,
// one-sided at the edges.
export function fillSlopes(heights, info, samples, texel) {
  const at = (i, j) => heights[j * samples + i];
  for (let j = 0; j < samples; j++) {
    for (let i = 0; i < samples; i++) {
      const i0 = Math.max(i - 1, 0);
      const i1 = Math.min(i + 1, samples - 1);
      const j0 = Math.max(j - 1, 0);
      const j1 = Math.min(j + 1, samples - 1);
      const n = j * samples + i;
      info[4 * n] = (at(i1, j) - at(i0, j)) / ((i1 - i0) * texel);
      info[4 * n + 1] = (at(i, j1) - at(i, j0)) / ((j1 - j0) * texel);
    }
  }
}

// Builds every level in this thread. The game uses workers; tests use this.
export function buildHeightmap(island, settings) {
  const { samples } = settings;
  const data = layoutLevels(settings).map((level) => {
    const heights = new Float32Array(samples * samples);
    const info = new Float32Array(4 * samples * samples);
    fillRows(island, level, samples, 0, samples, heights, info);
    return { heights, info };
  });
  return createHeightmap(island, settings, data);
}

// The sampler over levels of `data` ([{ heights, info }], filled), with
// their slopes worked out here.
export function createHeightmap(island, settings, data) {
  const { samples, blend } = settings;
  const levels = layoutLevels(settings).map((level, k) => {
    fillSlopes(data[k].heights, data[k].info, samples, level.texel);
    return { ...level, ...data[k] };
  });
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

  return {
    levels,
    samples,
    heightAtCove,
    // The drawn height at world x, z.
    heightAt: (x, z) => heightAtCove(...island.toCove(x, z)),
  };
}
