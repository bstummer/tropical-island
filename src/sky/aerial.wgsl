// The aerial-perspective table (atmosphere.js; chunks/aerial.wgsl has the
// mapping): one distance slice per draw, for the camera's height and the sun.
// The same in-scattering as the sky, over the same curved planet (far surfaces
// bend down with it), so far land and sea meet the sky's horizon seamlessly.

#include "chunks/fullscreen.wgsl"
#include "chunks/frame-values.wgsl"
#include "atmosphere.wgsl"
#include "chunks/aerial.wgsl"

struct AerialTable {
  uHeight: f32, // km
  uSunMu: f32, // the sun's zenith cosine
  uSlice: f32,
}

@group(1) @binding(0) var<uniform> table: AerialTable;

override STEPS: i32 = 16; // config.sky.samples

@fragment
fn fragmentMain(in: Fullscreen) -> @location(0) vec4f {
  var dir: vec3f;
  var distance: f32;
  aerialParams(vec3f(in.position.xy, table.uSlice + 0.5) / frame.uAerialSize, &dir, &distance);
  let sun = vec3f(sqrt(max(1.0 - table.uSunMu * table.uSunMu, 0.0)), table.uSunMu, 0.0);
  // The whole distance, also where the row has met the sea before it: the far
  // sea lies between rows, and a row cut short there left it with too little haze.
  var through: vec3f;
  return vec4f(inscatter(table.uHeight, dir, sun, distance, STEPS, &through), 1.0);
}
