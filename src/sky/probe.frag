// The light probe (atmosphere.js): the light at sea level for one sun, read
// back into the light state (light.js). Texel 0 holds the sun's radiance
// through the atmosphere, texels 1 to 9 the sky's radiance from every
// direction above the horizon as spherical harmonics (chunks/sh.glsl): the
// ground below sends back its own light (chunks/lighting.glsl).
// Rendered when the time changes.

#include "atmosphere.glsl"
#include "chunks/sh.glsl"

uniform vec3 uSun; // world direction, y up

// AZIMUTHS, RINGS, STEPS: config.sky.samples

void main() {
  int k = int(gl_FragCoord.x);
  if (k == 0) {
    // Through the air towards the sun's centre, kept up to the horizon: light.js
    // scales it by the share of the disk above the horizon.
    gl_FragColor = vec4(uSunIlluminance * transmittance(0.0, max(uSun.y, 0.0)), 1.0);
    return;
  }
  vec3 sum = vec3(0.0);
  for (int i = 0; i < AZIMUTHS; i++) {
    for (int j = 0; j < RINGS; j++) {
      float cosT = 1.0 - 2.0 * (float(j) + 0.5) / float(RINGS);
      float sinT = sqrt(max(1.0 - cosT * cosT, 0.0));
      float phi = 2.0 * PI * (float(i) + 0.5) / float(AZIMUTHS);
      vec3 dir = vec3(sinT * cos(phi), cosT, sinT * sin(phi));
      if (dir.y > 0.0) sum += skyRadiance(0.0, dir, uSun, STEPS) * shBasis(k - 1, dir);
    }
  }
  gl_FragColor = vec4(sum * 4.0 * PI / float(AZIMUTHS * RINGS), 1.0);
}
