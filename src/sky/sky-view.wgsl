// The sky-view table (atmosphere.js): the sky's radiance in every direction
// from one height, for one sun. Rendered again when the time or the camera's
// height changes.

#include "chunks/fullscreen.wgsl"
#include "chunks/frame-values.wgsl"
#include "atmosphere.wgsl"

struct SkyViewTable {
  uHeight: f32, // km
  uSunMu: f32, // the sun's zenith cosine
  uSize: vec2f,
}

@group(1) @binding(0) var<uniform> table: SkyViewTable;

override STEPS: i32 = 48; // config.sky.samples

@fragment
fn fragmentMain(in: Fullscreen) -> @location(0) vec4f {
  var mu: f32;
  var cosAzimuth: f32;
  skyViewParams(in.position.xy / table.uSize, table.uHeight, table.uSize, &mu, &cosAzimuth);
  let sinZ = sqrt(max(1.0 - mu * mu, 0.0));
  let dir = vec3f(sinZ * cosAzimuth, mu, sinZ * sqrt(max(1.0 - cosAzimuth * cosAzimuth, 0.0)));
  let sun = vec3f(sqrt(max(1.0 - table.uSunMu * table.uSunMu, 0.0)), table.uSunMu, 0.0);
  return vec4f(skyRadianceAt(table.uHeight, dir, sun, STEPS), 1.0);
}
