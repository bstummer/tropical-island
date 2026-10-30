// The seabed's mottling (textures/seabed.js), a tile tens of metres across that
// water/water-seabed.wgsl reads at two sizes. Each channel holds one range of sizes
// round 0.5, bent by a slow warp so no noise's grid shows, and its mips fade to that
// average, so what a pixel covers is gone from it. r: clumps, a few metres to more
// than ten; g: a metre or so to a few; b: under a metre; a: rounded heads of coral
// metres across, light on top and dark in the gaps between them.

#include "chunks/fullscreen.wgsl"
#include "tileable.wgsl"

struct SeabedTile {
  uSeed: vec2f,
  uShift: vec2f, // tiles: shifted by whole ones, the texture is the same (fixtures/surfaces.js checks)
}

@group(1) @binding(0) var<uniform> seabedTile: SeabedTile;

const HEADS: f32 = 64.0; // heads of coral across the tile

// Round the distances from p to the two nearest of HEADS x HEADS scattered points.
fn twoNearest(p: vec2f) -> vec2f {
  let cell = floor(p);
  var nearest = vec2f(9.0);
  for (var j = -2; j <= 2; j++) {
    for (var i = -2; i <= 2; i++) {
      let c = cell + vec2f(f32(i), f32(j));
      let at = c + 0.5 + 0.45 * tileHash(c, HEADS, seabedTile.uSeed + 3.7);
      let d = length(p - at);
      if (d < nearest.x) {
        nearest = vec2f(d, nearest.x);
      } else if (d < nearest.y) {
        nearest.y = d;
      }
    }
  }
  return nearest;
}

@fragment
fn fragmentMain(in: Fullscreen) -> @location(0) vec4f {
  let uv = in.vUv + seabedTile.uShift;
  let s = seabedTile.uSeed;
  let warp = vec2f(tileFbm(uv * 7.0, 7.0, s + 11.0, 2), tileFbm(uv * 7.0, 7.0, s + 23.0, 2));
  let bent = uv + 0.05 * warp;
  let clumps = tileFbm(bent * 10.0, 10.0, s, 3);
  let small = tileFbm((bent + 0.3 * warp.yx * 0.05) * 40.0, 40.0, s + 41.0, 3);
  let fine = tileFbm(uv * 160.0, 160.0, s + 67.0, 3);
  let nearest = twoNearest(bent * HEADS);
  let heads = smoothstep(0.0, 0.5, nearest.y - nearest.x) * (1.0 - 0.35 * smoothstep(0.2, 0.8, nearest.x));
  return vec4f(clamp(0.5 + vec3f(clumps, small, fine), vec3f(0.0), vec3f(1.0)), heads);
}
