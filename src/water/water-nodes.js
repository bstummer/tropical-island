// Which pieces of the sea's surface to draw for a camera: the terrain's quadtree
// (world/lod.js) over the whole sea out past the horizon, fine round the camera
// and coarse far away, but with nothing to store per node, as there are too many
// of them to walk and the sea is level. Its seams close as the terrain's do: its
// ranges come from lod.js lodRanges, and the vertex shader morphs as the
// terrain's does (water.wgsl). Pure and Node-importable.
//
// tree: { origin: [x, z], levels, leaf, grid }. Fills `out` with { x, z, spacing,
// level, quarter }: a quarter is drawn with grid / 2 quads. visible(x, z, size) culls.
export function selectSea({ origin, levels, leaf, grid }, cam, ranges, visible, out) {
  out.length = 0;
  const top = levels - 1;
  const distance2 = (x0, z0, size) => {
    const dx = Math.max(x0 - cam[0], 0, cam[0] - x0 - size);
    const dz = Math.max(z0 - cam[2], 0, cam[2] - z0 - size);
    return dx * dx + dz * dz;
  };
  function visit(level, x0, z0) {
    const size = leaf * 2 ** level;
    const d2 = distance2(x0, z0, size);
    if (d2 > ranges[level] ** 2) return false;
    if (!visible(x0, z0, size)) return true;
    if (level === 0 || d2 > ranges[level - 1] ** 2) {
      out.push({ x: x0, z: z0, spacing: size / grid, level, quarter: false });
      return true;
    }
    const half = size / 2;
    for (const [dx, dz] of [[0, 0], [1, 0], [0, 1], [1, 1]]) {
      const [cx, cz] = [x0 + dx * half, z0 + dz * half];
      if (visit(level - 1, cx, cz)) continue;
      if (visible(cx, cz, half)) out.push({ x: cx, z: cz, spacing: size / grid, level, quarter: true });
    }
    return true;
  }
  if (!visit(top, origin[0], origin[1])) out.push({ x: origin[0], z: origin[1], spacing: (leaf * 2 ** top) / grid, level: top, quarter: false });
  return out;
}
