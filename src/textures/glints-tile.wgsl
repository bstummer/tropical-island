// The sun's glints (textures/glints.js), a tile of sparse round spots, one scattered
// in each cell, some of them dim, in two channels that don't line up. Reads of it drifting through
// each other light up where their spots meet (water/water-mirror.wgsl); its mips
// fade it to its mean, so what a pixel covers melts into a smooth light.

#include "chunks/fullscreen.wgsl"
#include "tileable.wgsl"

struct GlintsTile {
  uSeed: vec2f,
  uShift: vec2f, // tiles: shifted by whole ones, the texture is the same (fixtures/surfaces.js checks)
}

@group(1) @binding(0) var<uniform> glintsTile: GlintsTile;

const CELLS: f32 = 128.0; // across the tile; water-mirror.wgsl has the same
const WIDTH: f32 = 0.24; // a spot's, in cells (a Gaussian's standard deviation); water-mirror.wgsl has the same

fn spots(p: vec2f, seed: vec2f) -> f32 {
  let cell = floor(p);
  var most = 0.0;
  for (var j = -1; j <= 1; j++) {
    for (var i = -1; i <= 1; i++) {
      let c = cell + vec2f(f32(i), f32(j));
      let scatter = tileHash(c, CELLS, seed);
      let bright = 0.5 + 0.5 * tileHash(c, CELLS, seed + 9.1).x;
      let d = (p - (c + 0.5 + 0.5 * scatter)) / WIDTH;
      most = max(most, (0.3 + 0.7 * bright * bright) * exp(-0.5 * dot(d, d)));
    }
  }
  return most;
}

@fragment
fn fragmentMain(in: Fullscreen) -> @location(0) vec4f {
  let p = (in.vUv + glintsTile.uShift) * CELLS;
  return vec4f(spots(p, glintsTile.uSeed), spots(p, glintsTile.uSeed + 31.7), 0.0, 1.0);
}
