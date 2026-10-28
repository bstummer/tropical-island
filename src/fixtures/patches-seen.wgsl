// Fixture: see patches.js. The green (chunks/green.wgsl) and where it gives
// way to sand (greenSandShare), as a camera uDistance m off each cell and
// uHeight m up sees it, through a pixel uFootprint m across: per texel, one of
// a cell's SAMPLES x SAMPLES samples, its albedo (rgb) and how much of it is
// sand (a). uCells, per cell: its centre (world x, z), how much of it is sand
// (0 to 1, as the terrain's ground has it) and its band; in the row below,
// how lush and how sandy, and the way to the camera (x, z, a unit vector).
// uOffset shifts every sample, a deliberate mistake.

#include "chunks/fullscreen.wgsl"
#include "chunks/green.wgsl"

struct SeenCheck {
  uDrySand: vec3f, // linear
  uDistance: f32,
  uFootprint: vec2f, // m, along x and along z
  uHeight: f32,
  uCell: f32, // m across
  uOffset: f32,
}

@group(1) @binding(0) var<uniform> check: SeenCheck;
@group(1) @binding(1) var uCells: texture_2d<f32>;

const SAMPLES: i32 = 8;

@fragment
fn fragmentMain(in: Fullscreen) -> @location(0) vec4f {
  let texel = vec2i(in.position.xy);
  let cell = texel.x / SAMPLES;
  let a = textureLoad(uCells, vec2i(cell, 0), 0);
  let b = textureLoad(uCells, vec2i(cell, 1), 0);
  let at = (vec2f(f32(texel.x - cell * SAMPLES), f32(texel.y)) + 0.5) / f32(SAMPLES) - 0.5;
  let xz = a.xy + at * check.uCell + check.uOffset;
  let camera = vec3f(a.x + b.z * check.uDistance, check.uHeight, a.y + b.w * check.uDistance);
  let g = greenFrom(camera, vec3f(xz.x, 0.0, xz.y), vec3f(0.0, 1.0, 0.0), a.w, b.x, b.y, check.uDrySand, vec2f(check.uFootprint.x, 0.0), vec2f(0.0, check.uFootprint.y));
  let sand = select(a.z, greenSandShare(a.z, g), a.z > 0.0 && a.z < 1.0);
  return vec4f(mix(g.albedo, check.uDrySand, sand), sand);
}
