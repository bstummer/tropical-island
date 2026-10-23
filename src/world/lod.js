// Which pieces of terrain to draw, and how finely, for a camera: a quadtree
// over the coarsest grid, after Strugar, "Continuous Distance-Dependent Level
// of Detail for Rendering Heightmaps" (2009). Pure and Node-importable.
//
// A node at level L is leaf x 2^L metres across and drawn with `grid` x `grid`
// quads, 2^L metres apart. It splits into four children while the camera is
// within range L - 1 of it, the ranges growing by `ratio` a level from
// `detail` metres at level 0. A child out of that range is drawn as a quarter
// of its parent instead, at the parent's spacing. Every point of the root is covered once, and
// neighbours differ by at most one level, so the vertex shader's morph
// (terrain.vert) closes every seam.
//
// Ranges are measured across the ground, ignoring height, here and in the
// morph. A seam can lie a node's diagonal beyond its level's range, where the
// coarser side must not have begun to morph yet; across the ground that holds
// for any terrain once detail x (ratio - 1) x (1 - morph) exceeds a leaf's
// diagonal (lodRanges checks it). Measured in 3D, a 32 m node on the
// headland's cliffs spans 70 m of height, and the finest range would have to
// be about 120 m.
//
// A ratio over 2 refines the distance more than the near ground: the far
// levels' error on screen falls to that of the near ones (2.5 halves the worst
// level's, against doubling the finest range at under 60% of its triangles).
//
// Positions are in the cove's frame (world/island.js): a, o across, y up.

// tree: { origin: [a, o], levels, leaf, grid }; bounds(a, o, size) -> [min, max]
// height of the terrain over that square, for culling.
export function createLod({ origin, levels, leaf, grid }, bounds) {
  const top = levels - 1;
  const rootSize = leaf * 2 ** top;

  // Heights per node, filled once: level L holds (2^(top-L))^2 nodes.
  const heights = [];
  for (let level = 0; level <= top; level++) {
    const count = 2 ** (top - level);
    const size = leaf * 2 ** level;
    const minMax = new Float32Array(2 * count * count);
    for (let j = 0; j < count; j++) {
      for (let i = 0; i < count; i++) {
        const n = 2 * (j * count + i);
        if (level === 0) {
          const [min, max] = bounds(origin[0] + i * size, origin[1] + j * size, size);
          minMax[n] = min;
          minMax[n + 1] = max;
        } else {
          const below = heights[level - 1];
          const c = 2 * count;
          let min = Infinity;
          let max = -Infinity;
          for (const [di, dj] of [[0, 0], [1, 0], [0, 1], [1, 1]]) {
            const m = 2 * ((2 * j + dj) * c + 2 * i + di);
            min = Math.min(min, below[m]);
            max = Math.max(max, below[m + 1]);
          }
          minMax[n] = min;
          minMax[n + 1] = max;
        }
      }
    }
    heights.push(minMax);
  }

  // Distance squared from the camera to a node's square, across the ground.
  function distance2(cam, a0, o0, size) {
    const da = Math.max(a0 - cam[0], 0, cam[0] - a0 - size);
    const doo = Math.max(o0 - cam[2], 0, cam[2] - o0 - size);
    return da * da + doo * doo;
  }

  // Fills `out` with the nodes to draw for a camera at cam = [a, y, o], as
  // { a, o, spacing, level, quarter }: a quarter is drawn with grid / 2 quads.
  // ranges[L]: how far level L reaches. visible(a, o, size, min, max) culls,
  // with the node's heights.
  function select(cam, ranges, visible, out) {
    out.length = 0;
    function visit(level, i, j) {
      const size = leaf * 2 ** level;
      const count = 2 ** (top - level);
      const n = 2 * (j * count + i);
      const min = heights[level][n];
      const max = heights[level][n + 1];
      const a0 = origin[0] + i * size;
      const o0 = origin[1] + j * size;
      const d2 = distance2(cam, a0, o0, size);
      if (d2 > ranges[level] ** 2) return false;
      if (!visible(a0, o0, size, min, max)) return true;
      if (level === 0 || d2 > ranges[level - 1] ** 2) {
        out.push({ a: a0, o: o0, spacing: size / grid, level, quarter: false });
        return true;
      }
      for (const [di, dj] of [[0, 0], [1, 0], [0, 1], [1, 1]]) {
        const [ci, cj] = [2 * i + di, 2 * j + dj];
        if (visit(level - 1, ci, cj)) continue;
        // The quarter covers the child's square: culled by its heights.
        const below = heights[level - 1];
        const m = 2 * (cj * 2 * count + ci);
        const [qa, qo] = [a0 + (di * size) / 2, o0 + (dj * size) / 2];
        if (visible(qa, qo, size / 2, below[m], below[m + 1])) out.push({ a: qa, o: qo, spacing: size / grid, level, quarter: true });
      }
      return true;
    }
    if (!visit(top, 0, 0)) out.push({ a: origin[0], o: origin[1], spacing: rootSize / grid, level: top, quarter: false });
    return out;
  }

  return { select };
}

// How far each level reaches: `detail` metres for level 0, growing by `ratio`
// (at least 2) a level, and the distances over which each morphs into the
// next ([start, end] per level). Throws for ranges too short for nodes `leaf`
// metres across to close their seams (see the top).
export function lodRanges(detail, levels, morph, leaf, ratio = 2) {
  if (!(ratio >= 2)) throw new Error(`terrain range ratio ${ratio}: each level must reach at least twice as far as the last`);
  if (!(detail * (ratio - 1) * (1 - morph) > leaf * Math.SQRT2)) {
    throw new Error(`terrain detail ${detail} m is too short for ${leaf} m nodes: it must exceed ${((leaf * Math.SQRT2) / ((ratio - 1) * (1 - morph))).toFixed(1)} m`);
  }
  const ranges = Array.from({ length: levels }, (_, level) => detail * ratio ** level);
  const morphs = ranges.map((end, level) => {
    const start = level ? ranges[level - 1] : 0;
    return [end - (end - start) * morph, end];
  });
  return { ranges, morphs };
}
