// Tool fixture: see maths.js. One texel per answer (maths-cases.js has the layout).

#include "chunks/sh.glsl"
#include "chunks/sky-view.glsl"
#include "chunks/aerial.glsl"
#include "../sky/atmosphere.glsl"

uniform vec3 uDirections[DIRECTIONS];
uniform vec3 uCoefficients[9];
uniform vec2 uSkyViewSize;

// Each mapping run forth and back from every texel centre: the worst miss, in texels.
float skyViewRoundTrip() {
  float worst = 0.0;
  for (int i = 0; i < 2; i++) {
    float h = i == 0 ? 0.002 : 0.3; // km: a camera on the beach and on a hill
    // Every row but the last, which looks a hair above the horizon on purpose (sky-view.glsl).
    for (float y = 0.5; y < uSkyViewSize.y - 1.0; y += 1.0) {
      for (float x = 0.5; x < uSkyViewSize.x; x += 1.0) {
        vec2 uv = vec2(x, y) / uSkyViewSize;
        float mu, cosAzimuth;
        skyViewParams(uv, h, uSkyViewSize, mu, cosAzimuth);
        vec2 back = skyViewUv(h, mu, cosAzimuth, uSkyViewSize);
        worst = max(worst, max(abs(back.x - uv.x) * uSkyViewSize.x, abs(back.y - uv.y) * uSkyViewSize.y));
      }
    }
  }
  return worst;
}

float aerialRoundTrip() {
  float worst = 0.0;
  vec3 sun = vec3(1.0, 0.0, 0.0); // the tables' frame: the sun at azimuth 0
  // Straight up and down (the first and last rows) have no azimuth to come back to.
  for (float z = 0.5; z < uAerialSize.z; z += 1.0) {
    for (float y = 1.5; y < uAerialSize.y - 1.0; y += 1.0) {
      for (float x = 0.5; x < uAerialSize.x; x += 1.0) {
        vec3 uvw = vec3(x, y, z) / uAerialSize;
        vec3 dir;
        float distance;
        aerialParams(uvw, dir, distance);
        vec3 back = aerialUvw(dir, distance, sun);
        worst = max(worst, max(max(abs(back.x - uvw.x) * uAerialSize.x, abs(back.y - uvw.y) * uAerialSize.y), abs(back.z - uvw.z) * uAerialSize.z));
      }
    }
  }
  return worst;
}

float multiscatterRoundTrip() {
  float worst = 0.0;
  for (float y = 0.5; y < uMultiscatterSize.y; y += 1.0) {
    for (float x = 0.5; x < uMultiscatterSize.x; x += 1.0) {
      vec2 uv = vec2(x, y) / uMultiscatterSize;
      float h, muSun;
      multiscatterParams(uv, h, muSun);
      vec2 back = multiscatterUv(h, muSun);
      worst = max(worst, max(abs(back.x - uv.x) * uMultiscatterSize.x, abs(back.y - uv.y) * uMultiscatterSize.y));
    }
  }
  return worst;
}

void main() {
  int i = int(gl_FragCoord.x);
  int n = DIRECTIONS;
  if (i < 9 * n) gl_FragColor = vec4(shBasis(i - 9 * (i / 9), normalize(uDirections[i / 9])), 0.0, 0.0, 1.0);
  else if (i < 10 * n) gl_FragColor = vec4(shIrradiance(uCoefficients, normalize(uDirections[i - 9 * n])), 1.0);
  else if (i == 10 * n) gl_FragColor = vec4(skyViewRoundTrip(), 0.0, 0.0, 1.0);
  else if (i == 10 * n + 1) gl_FragColor = vec4(aerialRoundTrip(), 0.0, 0.0, 1.0);
  else gl_FragColor = vec4(multiscatterRoundTrip(), 0.0, 0.0, 1.0);
}
