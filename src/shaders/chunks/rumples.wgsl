// The rumples the backwash leaves on wet sand (chunks/sand.wgsl), from swells half a
// metre across to pits and crumbs of a few centimetres, too shallow to shade but
// enough to tilt the water in and on them: the sand's sheen, and the glassy film the
// water draws over it (water/water.wgsl), so a low sun mirrored in either breaks into
// the same streak of glints.

#include "noise.wgsl"

// Their slope (dh/dx, dh/dz, world) at xz for a pixel `footprint` m wide, the largest
// `wavelength` m with `slope`, and two finer scales, each 0.3 the last and steeper; and
// the variance of the slopes of those too small for the pixel, which it can't hold, as
// GGX's alpha squared. Each scale drops out once a pixel can't hold it, so further
// away the glints merge into a broad path of glitter rather than sparkle.
fn rumples(xz: vec2f, footprint: f32, wavelength: f32, slope: f32) -> vec3f {
  var g = vec2f(0.0);
  var lost = 0.0;
  var size = wavelength;
  for (var k = 0; k < 3; k++) {
    let steep = slope * (0.3 + 0.5 * f32(k)); // the smaller, the steeper
    let held = smoothstep(4.0, 10.0, size / footprint);
    // The noise's slope is about 1.4 across a unit of it on average.
    g += held * steep / 1.4 * gradientNoiseD(xz / size + 7.3 * f32(k)).yz;
    lost += (1.0 - held * held) * steep * steep;
    size *= 0.3;
  }
  return vec3f(g, 2.0 * lost);
}

// What all the rumples add to a roughness where a pixel holds none of them.
fn rumplesSpread(slope: f32) -> f32 {
  return 2.0 * slope * slope * (0.09 + 0.64 + 1.69);
}
