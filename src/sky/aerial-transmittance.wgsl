// The aerial perspective's transmittance (atmosphere.js; chunks/aerial.wgsl has
// the mapping): the share of a point's own light that reaches the camera, per
// colour, for the camera's height. It depends on neither the sun nor the
// azimuth, so a 2D table holds it, by the aerial table's rows (x) and slices (y).
// Per colour: the haze dims blue more than red, which keeps distant land warm.

#include "chunks/fullscreen.wgsl"
#include "chunks/frame-values.wgsl"
#include "atmosphere.wgsl"
#include "chunks/aerial.wgsl"

struct AerialTransmittanceTable {
  uHeight: f32, // km
}

@group(1) @binding(0) var<uniform> table: AerialTransmittanceTable;

override STEPS: i32 = 16; // config.sky.samples

@fragment
fn fragmentMain(in: Fullscreen) -> @location(0) vec4f {
  var dir: vec3f;
  var distance: f32;
  aerialParams(vec3f(0.0, in.position.xy / frame.uAerialSize.yz), &dir, &distance);
  // Past the sea, as the aerial table does (aerial.wgsl).
  return vec4f(exp(-opticalDepth(table.uHeight, dir.y, distance, STEPS)), 1.0);
}
