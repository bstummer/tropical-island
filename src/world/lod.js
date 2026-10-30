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
// (world/terrain.wgsl) closes every seam.
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
// createMeshHeight gives the height of the mesh so drawn, morph and all, at any
// point for a camera: far from it the mesh strays from the finest height, and
// what stands on the ground (rocks, plants) must stand on what is drawn.
// gridIndex splits a node's quads into triangles, for the mesh and its height.
//
// Positions are in the cove's frame (world/island.js): a, o across, y up.

// tree: { origin: [a, o], levels, leaf, grid }; bounds(a, o, size) -> [min, max,
// surfaces]: the height of the terrain over that square, for culling, and
// optionally bits for the surfaces on it, which a node passes on so the
// terrain can draw it with a shader that has only those.
export function createLod({ origin, levels, leaf, grid }, bounds) {
  const top = levels - 1;
  const rootSize = leaf * 2 ** top;

  // Heights and surfaces per node, filled once: level L holds (2^(top-L))^2 nodes.
  const heights = [];
  const surfaces = [];
  for (let level = 0; level <= top; level++) {
    const count = 2 ** (top - level);
    const size = leaf * 2 ** level;
    const minMax = new Float32Array(2 * count * count);
    const bits = new Uint8Array(count * count);
    for (let j = 0; j < count; j++) {
      for (let i = 0; i < count; i++) {
        const n = 2 * (j * count + i);
        if (level === 0) {
          const [min, max, on = 0] = bounds(origin[0] + i * size, origin[1] + j * size, size);
          minMax[n] = min;
          minMax[n + 1] = max;
          bits[n / 2] = on;
        } else {
          const below = heights[level - 1];
          const c = 2 * count;
          let min = Infinity;
          let max = -Infinity;
          let on = 0;
          for (const [di, dj] of [[0, 0], [1, 0], [0, 1], [1, 1]]) {
            const m = (2 * j + dj) * c + 2 * i + di;
            min = Math.min(min, below[2 * m]);
            max = Math.max(max, below[2 * m + 1]);
            on |= surfaces[level - 1][m];
          }
          minMax[n] = min;
          minMax[n + 1] = max;
          bits[n / 2] = on;
        }
      }
    }
    heights.push(minMax);
    surfaces.push(bits);
  }

  // Fills `out` with the nodes to draw for a camera at cam = [a, y, o], as
  // { a, o, spacing, level, quarter, surfaces, max }: a quarter is drawn with grid / 2 quads.
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
        out.push({ a: a0, o: o0, spacing: size / grid, level, quarter: false, surfaces: surfaces[level][n / 2], max });
        return true;
      }
      for (const [di, dj] of [[0, 0], [1, 0], [0, 1], [1, 1]]) {
        const [ci, cj] = [2 * i + di, 2 * j + dj];
        if (visit(level - 1, ci, cj)) continue;
        // The quarter covers the child's square: culled by its heights.
        const below = heights[level - 1];
        const m = cj * 2 * count + ci;
        const [qa, qo] = [a0 + (di * size) / 2, o0 + (dj * size) / 2];
        if (visible(qa, qo, size / 2, below[2 * m], below[2 * m + 1])) {
          out.push({ a: qa, o: qo, spacing: size / grid, level, quarter: true, surfaces: surfaces[level - 1][m], max: below[2 * m + 1] });
        }
      }
      return true;
    }
    if (!visit(top, 0, 0)) out.push({ a: origin[0], o: origin[1], spacing: rootSize / grid, level: top, quarter: false, surfaces: surfaces[top][0], max: heights[top][1] });
    return out;
  }

  return { select };
}

// Distance squared from the camera to a node's square, across the ground.
function distance2(cam, a0, o0, size) {
  const da = Math.max(a0 - cam[0], 0, cam[0] - a0 - size);
  const doo = Math.max(o0 - cam[2], 0, cam[2] - o0 - size);
  return da * da + doo * doo;
}

// The triangles of a grid of `quads` x `quads` quads, its vertices numbered
// row by row (j (quads + 1) + i), each quad (i, j) split into (i, j), (i, j + 1),
// (i + 1, j) and (i + 1, j), (i, j + 1), (i + 1, j + 1). The one place the
// split is made: the mesh drawn (world/terrain-nodes.js gridGeometry) and its
// height here both use it, and tests/lod.test.js holds
// chunks/terrain-mesh.wgsl's TERRAIN_BLOCK to it.
export function gridIndex(quads) {
  const index = [];
  const at = (i, j) => j * (quads + 1) + i;
  for (let j = 0; j < quads; j++) {
    for (let i = 0; i < quads; i++) index.push(at(i, j), at(i, j + 1), at(i + 1, j), at(i + 1, j), at(i, j + 1), at(i + 1, j + 1));
  }
  return index;
}

// The 2 x 2 quads around a point as triangles of their 3 x 3 vertices (3 y + x),
// split as the grid splits them.
const BLOCK = gridIndex(2);

// The mesh's own height for a camera, as world/terrain.wgsl draws it: far out its
// coarser levels stray from the finest height by centimetres to metres, and
// whatever stands on the ground must stand on what is drawn. tree as
// createLod's; ranges and morphs from lodRanges; heightAtCove(a, o, from) samples
// the grids as the GPU does (world/heightmap.js), from grid heightLevels[L] at
// level L. Returns meshHeight(a, o, cam) for a camera at cam = [a, y, o]: the
// height before the planet's bend, NaN off the root. It allocates nothing.
export function createMeshHeight({ origin, levels, leaf, grid }, { ranges, morphs }, heightAtCove, heightLevels) {
  // Quarters pair their quads into the coarser grid's, as whole nodes do.
  if (grid % 4) throw new Error(`terrain grid ${grid}: a quarter of a node needs an even number of quads`);
  const top = levels - 1;
  const cells = 2 ** top; // leaves across the root
  // The block's vertices: where the morph has moved them, in quads from the
  // node's corner, and how far each has morphed.
  const ga = new Float64Array(9);
  const go = new Float64Array(9);
  const ks = new Float64Array(9);

  // Vertex n's height, as world/terrain.wgsl takes it at its level and the next.
  function vertexHeight(n, a0, o0, spacing, level) {
    const a = a0 + ga[n] * spacing;
    const o = o0 + go[n] * spacing;
    const k = ks[n];
    const fine = heightLevels[level];
    if (k === 0) return heightAtCove(a, o, fine);
    const coarse = heightAtCove(a, o, heightLevels[Math.min(level + 1, top)]);
    return k < 1 ? heightAtCove(a, o, fine) * (1 - k) + coarse * k : coarse;
  }

  return function meshHeight(a, o, cam) {
    const fa = (a - origin[0]) / leaf;
    const fo = (o - origin[1]) / leaf;
    if (!(fa >= 0 && fa <= cells && fo >= 0 && fo <= cells)) return NaN;

    // The node drawn over the point, as select() picks it with everything in
    // view: down from the root while a node splits, into the child holding the
    // point; a child out of its range is drawn as a quarter of its parent.
    const li = Math.min(Math.floor(fa), cells - 1);
    const lj = Math.min(Math.floor(fo), cells - 1);
    let level = top;
    let size = leaf * cells;
    let a0 = origin[0];
    let o0 = origin[1];
    let quads = grid;
    while (level > 0 && distance2(cam, a0, o0, size) <= ranges[level - 1] ** 2) {
      const half = size / 2;
      a0 = origin[0] + (li >> (level - 1)) * half;
      o0 = origin[1] + (lj >> (level - 1)) * half;
      if (distance2(cam, a0, o0, half) > ranges[level - 1] ** 2) {
        quads = grid / 2;
        break;
      }
      size = half;
      level--;
    }
    const spacing = size / grid;

    // The 2 x 2 quads between even grid lines around the point: the morph
    // moves odd vertices toward the even ones before them but never across an
    // even line, so the point lies in one of these quads' eight triangles.
    // Each vertex morphs by its own distance.
    const u = (a - a0) / spacing;
    const v = (o - o0) / spacing;
    const bi = 2 * Math.min(Math.max(Math.floor(u / 2), 0), quads / 2 - 1);
    const bj = 2 * Math.min(Math.max(Math.floor(v / 2), 0), quads / 2 - 1);
    const start = morphs[level][0];
    const end = morphs[level][1];
    for (let y = 0; y < 3; y++) {
      for (let x = 0; x < 3; x++) {
        const da = a0 + (bi + x) * spacing - cam[0];
        const dO = o0 + (bj + y) * spacing - cam[2];
        const k = Math.min(Math.max((Math.sqrt(da * da + dO * dO) - start) / (end - start), 0), 1);
        ga[3 * y + x] = bi + x - (x % 2) * k;
        go[3 * y + x] = bj + y - (y % 2) * k;
        ks[3 * y + x] = k;
      }
    }

    // The triangle the point is most inside: one holds it, with all three
    // weights at least 0. The grid's triangles have a negative area here (they
    // face up); those the morph has collapsed hold nothing, and the slivers it
    // turns over near the end of its band face down and are culled. Front
    // faces overlap a little there, and either one may be drawn.
    let best = -Infinity;
    let t = 0;
    let w0 = 0;
    let w1 = 0;
    for (let s = 0; s < BLOCK.length; s += 3) {
      const p0 = BLOCK[s];
      const p1 = BLOCK[s + 1];
      const p2 = BLOCK[s + 2];
      const area = (ga[p1] - ga[p0]) * (go[p2] - go[p0]) - (go[p1] - go[p0]) * (ga[p2] - ga[p0]);
      if (area > -1e-9) continue;
      const b0 = ((ga[p1] - u) * (go[p2] - v) - (go[p1] - v) * (ga[p2] - u)) / area;
      const b1 = ((ga[p2] - u) * (go[p0] - v) - (go[p2] - v) * (ga[p0] - u)) / area;
      const least = Math.min(b0, b1, 1 - b0 - b1);
      if (least > best) {
        best = least;
        t = s;
        w0 = b0;
        w1 = b1;
      }
    }
    // Linear across it, as the rasterizer interpolates.
    return (
      w0 * vertexHeight(BLOCK[t], a0, o0, spacing, level) +
      w1 * vertexHeight(BLOCK[t + 1], a0, o0, spacing, level) +
      (1 - w0 - w1) * vertexHeight(BLOCK[t + 2], a0, o0, spacing, level)
    );
  };
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
