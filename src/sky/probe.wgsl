// The light probe (atmosphere.js): the light at sea level for one sun, read
// back into the light state (light.js). Texel 0 holds the sun's radiance
// through the atmosphere, texels 1 to 9 the sky's radiance from every
// direction above the horizon as spherical harmonics (chunks/sh.wgsl): the
// ground below sends back its own light (chunks/lighting.wgsl).
// Rendered when the time changes.

#include "chunks/fullscreen.wgsl"
#include "chunks/frame-values.wgsl"
#include "atmosphere.wgsl"
#include "chunks/sh.wgsl"

struct Probe {
  uSun: vec3f, // world direction, y up
}

@group(1) @binding(0) var<uniform> probe: Probe;

override AZIMUTHS: i32 = 32; // config.sky.samples
override RINGS: i32 = 16;
override STEPS: i32 = 16;

@fragment
fn fragmentMain(in: Fullscreen) -> @location(0) vec4f {
  let k = i32(in.position.x);
  if (k == 0) {
    // Through the air towards the sun's centre, kept up to the horizon: light.js
    // scales it by the share of the disk above the horizon.
    return vec4f(atmosphere.uSunIlluminance * transmittance(0.0, max(probe.uSun.y, 0.0)), 1.0);
  }
  var sum = vec3f(0.0);
  for (var i = 0; i < AZIMUTHS; i++) {
    for (var j = 0; j < RINGS; j++) {
      let cosT = 1.0 - 2.0 * (f32(j) + 0.5) / f32(RINGS);
      let sinT = sqrt(max(1.0 - cosT * cosT, 0.0));
      let phi = 2.0 * PI * (f32(i) + 0.5) / f32(AZIMUTHS);
      let dir = vec3f(sinT * cos(phi), cosT, sinT * sin(phi));
      if (dir.y > 0.0) {
        sum += skyRadianceAt(0.0, dir, probe.uSun, STEPS) * shBasis(k - 1, dir);
      }
    }
  }
  return vec4f(sum * 4.0 * PI / f32(AZIMUTHS * RINGS), 1.0);
}
