// Foam's lace (textures/foam.js): the holes of open water that open in it as its
// bubbles burst, at four sizes, each scattered one to a cell of a grid that tiles,
// with a radius of its own, and warped at its own size so none is round. The small
// ones open first, as bubbles burst before the larger gaps tear, and holes near each
// other run together as they grow, into torn openings with webs of foam between.
// r: how far a point lies into the foam from the holes round it, in their radii,
// halved: cut at a level, what is above it is the foam left, from all of it to a web
// of filaments to scattered bits. g: its bubbly grain, round 0.5. b: the radius of the
// nearest hole as a share of HOLE_LARGEST of the tile, so an edge can be as soft as a pixel.

#include "chunks/fullscreen.wgsl"
#include "tileable.wgsl"

struct FoamTile {
  uSeed: vec2f,
  uShift: vec2f, // tiles: shifted by whole ones, the texture is the same (fixtures/surfaces.js checks)
}

@group(1) @binding(0) var<uniform> foamTile: FoamTile;

// Cells across the tile, for each size of hole; and each one's radius as a share of
// its cell, at most, by which the smaller open sooner.
const CELLS = vec4f(176.0, 88.0, 36.0, 14.0);
const RADIUS = vec4f(0.7, 0.6, 0.5, 0.42);
// The largest radius there is, in tiles (water/water-foam.wgsl reads b by it).
const HOLE_LARGEST: f32 = 0.03;
// How soon holes run together: the softness of the minimum over them.
const MERGE: f32 = 5.0;

struct Holes {
  sum: f32, // of exp(-MERGE x how far into the foam), over the holes round the point
  nearest: f32, // how far into the foam from the nearest, in its radius
  radius: f32, // its radius, tiles
}

// The holes of a grid `cells` across round p, added into `holes`.
fn addHoles(holes: ptr<function, Holes>, p: vec2f, cells: f32, radius: f32, seed: vec2f) {
  let q = p * cells;
  let cell = floor(q);
  for (var j = -1; j <= 1; j++) {
    for (var i = -1; i <= 1; i++) {
      let c = cell + vec2f(f32(i), f32(j));
      let at = c + 0.5 + 0.35 * tileHash(c, cells, seed);
      let size = radius * (0.65 + 0.35 * tileHash(c, cells, seed + 7.1).x);
      let into = length(q - at) / size;
      (*holes).sum += exp(-MERGE * into);
      if (into < (*holes).nearest) {
        (*holes).nearest = into;
        (*holes).radius = size / cells;
      }
    }
  }
}

@fragment
fn fragmentMain(in: Fullscreen) -> @location(0) vec4f {
  let uv = in.vUv + foamTile.uShift;
  let s = foamTile.uSeed;
  var holes = Holes(0.0, 99.0, 0.0);
  for (var k = 0; k < 4; k++) {
    // Warped at its own size and twice that, by most of a cell: blobs and tears, not discs.
    let waves = CELLS[k] * 0.5;
    let warp = vec2f(tileFbm(uv * waves, waves, s + 11.0 + f32(k) * 5.3, 3), tileFbm(uv * waves, waves, s + 23.0 + f32(k) * 5.3, 3));
    addHoles(&holes, uv + warp * (0.9 / CELLS[k]), CELLS[k], RADIUS[k], s + f32(k) * 31.7);
  }
  let into = -log(max(holes.sum, 1e-6)) / MERGE;
  let grain = 0.5 + 0.5 * tileFbm(uv * 256.0, 256.0, s + 91.0, 2);
  return vec4f(clamp(0.5 * into, 0.0, 1.0), clamp(grain, 0.0, 1.0), clamp(holes.radius / HOLE_LARGEST, 0.0, 1.0), 1.0);
}
