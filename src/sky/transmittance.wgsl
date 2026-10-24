// The transmittance table (atmosphere.js): how much light gets through from
// every height and angle to space. Rendered when the time changes, since the
// haze changes with it.

#include "chunks/fullscreen.wgsl"
#include "chunks/frame-values.wgsl"
#include "atmosphere.wgsl"

override STEPS: i32 = 40; // config.sky.samples

@fragment
fn fragmentMain(in: Fullscreen) -> @location(0) vec4f {
  var h: f32;
  var mu: f32;
  transmittanceParams(in.position.xy / atmosphere.uTransmittanceSize, &h, &mu);
  return vec4f(exp(-opticalDepth(h, mu, distanceToTop(h, mu), STEPS)), 1.0);
}
