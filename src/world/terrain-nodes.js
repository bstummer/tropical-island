// The terrain's nodes (world/lod.js) as world/terrain.js draws them: the grid
// of quads each one draws, and the ground under each, from world/heightmap.js's
// grids: how low and high it lies, for culling, and the surfaces on it, which
// pick the shader that draws it. Pure and Node-importable.
import { Geometry } from '../gpu/geometry.js';
import { CUBIC_OVERSHOOT, GROUND } from './heightmap.js';
import { gridIndex } from './lod.js';

// Surfaces a node of the quadtree may hold (lod.js), each drawn by a shader
// that has its code: the others leave it out. A GPU skips a surface's code
// where a pixel has none of it, but SwiftShader runs every line of a shader at
// every pixel, branches or not. Sand, rock and green show their detail near
// the camera only: SAND is sand with it, ROCK rock without, DETAIL adds
// rock's, GREEN the green's; WET is sand without its detail, but with the
// sheen of wet sand, where a node far away reaches down to sand the sea wets.
// INLAND is any ground that is neither sand nor rock, the green's without its
// detail: a node that has none draws the green as its plain average, which it
// shows nowhere.
export const SAND = 1;
export const ROCK = 2;
export const DETAIL = 4;
export const GREEN = 8;
export const WET = 16;
export const INLAND = 32;

// A grid of `quads` x `quads` quads, its vertices at whole numbers (x, 0, z),
// drawn once per node of `nodes` (an instance Attribute); `mirrored` winds its
// triangles the other way.
export function gridGeometry(quads, nodes, mirrored) {
  const geometry = new Geometry();
  const positions = [];
  for (let j = 0; j <= quads; j++) for (let i = 0; i <= quads; i++) positions.push(i, 0, j);
  const index = gridIndex(quads);
  if (mirrored) index.reverse();
  geometry.setAttribute('position', positions, 3);
  geometry.setIndex(index);
  geometry.setAttribute('aNode', nodes);
  geometry.instanceCount = 0;
  return geometry;
}

// The lowest and highest ground over a square of the quadtree, from every
// grid that covers it (a far node draws a coarser grid's heights), with room
// for the curve between samples overshooting them (heightmap.js
// CUBIC_OVERSHOOT; the blends between grids and the morph mix heights from
// within the same samples, and the mesh is flat between its vertices) and a
// metre more; and the surfaces on it: wet sand
// where sand lies below `dry` m above the sea, the wet sand's reach
// (chunks/wet.wgsl), with room for how far the waves reach further and for the
// samples' spacing. The surfaces come only from the grids the shader reads
// them from (chunks/terrain.wgsl terrainGround), tile by tile: the finest that
// covers a tile wholly, and the finer ones blending into it over its last
// `blend` samples. A coarse grid's sand beside a cliff that a fine grid covers
// would cost the cliff the sand's shader. What a far pixel's mipmaps take in
// from beyond a node's samples shows as the surface's plain albedo, as ever.
// Beyond the coarsest grid, where the quadtree reaches past it, the GPU draws
// the heights at its edge.
export function nodeBounds(heightmap, dry, blend) {
  const { levels } = heightmap;
  // Level k's samples, a sample's room round [a0, a1] x [o0, o1], clamped to
  // the grid: [i0, i1, j0, j1], or null off a finer one.
  const range = (k, a0, o0, a1, o1) => {
    const { origin, texel, samples } = levels[k];
    const last = samples - 1;
    const i0 = Math.floor((a0 - origin[0]) / texel) - 1;
    const j0 = Math.floor((o0 - origin[1]) / texel) - 1;
    const i1 = Math.ceil((a1 - origin[0]) / texel) + 1;
    const j1 = Math.ceil((o1 - origin[1]) / texel) + 1;
    if (k < levels.length - 1 && (i1 < 0 || j1 < 0 || i0 > last || j0 > last)) return null;
    const clamp = (i) => Math.min(Math.max(i, 0), last);
    return [clamp(i0), clamp(i1), clamp(j0), clamp(j1)];
  };
  // Level k's say over [a0, a1] x [o0, o1] (heightmap.js weight, 0 within a
  // sample of its edge, 1 from `blend` samples further in): some somewhere, or all of it everywhere.
  const inSamples = (k, a0, o0, a1, o1) => {
    const { origin, texel, samples } = levels[k];
    return [(a0 - origin[0]) / texel, (a1 - origin[0]) / texel, (o0 - origin[1]) / texel, (o1 - origin[1]) / texel, samples - 1];
  };
  const touches = (k, ...square) => {
    const [fa0, fa1, fo0, fo1, last] = inSamples(k, ...square);
    return fa1 > 1 && fa0 < last - 1 && fo1 > 1 && fo0 < last - 1;
  };
  const covers = (k, ...square) => {
    const [fa0, fa1, fo0, fo1, last] = inSamples(k, ...square);
    return fa0 >= 1 + blend && fa1 <= last - 1 - blend && fo0 >= 1 + blend && fo1 <= last - 1 - blend;
  };
  return (a0, o0, size) => {
    let min = Infinity;
    let max = -Infinity;
    for (let k = 0; k < levels.length; k++) {
      const r = range(k, a0, o0, a0 + size, o0 + size);
      if (!r) continue;
      const { heights, samples } = levels[k];
      for (let j = r[2]; j <= r[3]; j++) {
        for (let i = r[0]; i <= r[1]; i++) {
          const h = heights[j * samples + i];
          if (h < min) min = h;
          if (h > max) max = h;
        }
      }
    }
    let surfaces = 0;
    const tile = Math.min(TILE, size);
    for (let ta = a0; ta < a0 + size; ta += tile) {
      for (let to = o0; to < o0 + size; to += tile) {
        for (let k = 0; k < levels.length; k++) {
          const coarsest = k === levels.length - 1; // has its say everywhere
          if (!coarsest && !touches(k, ta, to, ta + tile, to + tile)) continue;
          const r = range(k, ta, to, ta + tile, to + tile);
          if (r) surfaces |= surfacesOver(levels[k], r, dry);
          if (coarsest || covers(k, ta, to, ta + tile, to + tile)) break; // the coarser ones don't show here
        }
      }
    }
    const room = 1 + CUBIC_OVERSHOOT * (max - min);
    return [min - room, max + room, surfaces];
  };
}

const TILE = 8; // m: nodeBounds' tiles, no larger than a leaf, where grids blend into each other

// The surface bits of a level's samples r = [i0, i1, j0, j1] (see nodeBounds).
function surfacesOver({ heights, ground, samples }, [i0, i1, j0, j1], dry) {
  let surfaces = 0;
  for (let j = j0; j <= j1; j++) {
    for (let i = i0; i <= i1; i++) {
      const n = GROUND * (j * samples + i);
      const h = heights[j * samples + i];
      if (ground[n] > 0) surfaces |= h < dry + 0.5 && h > -1 ? SAND | WET : SAND;
      if (ground[n + 1] > 0) surfaces |= ROCK;
      if (ground[n] + ground[n + 1] < 255) surfaces |= INLAND;
      if (ground[n] + ground[n + 1] < 0.85 * 255) surfaces |= GREEN; // a share worth its detail
    }
  }
  return surfaces;
}
