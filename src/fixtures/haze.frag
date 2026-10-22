// Tool fixture: see haze.js; haze-cases.js has the answers' order. One texel
// per answer: the worst miss over the cases, in 8-bit levels on screen.

#include "chunks/lighting.glsl"
#include "../sky/atmosphere.glsl"
#include "../post/tonemap.glsl"

uniform float uExposure;

// TONEMAP: the frame's

const int DIRECT_STEPS = 256; // the direct marches: far finer than any table's
const float DEG = PI / 180.0;
const float AZIMUTHS[3] = float[3](0.0, 60.0, 180.0); // degrees from the sun's
const float SEA[5] = float[5](0.1, 0.3, 0.6, 0.9, 0.99); // points on the sea, as shares of the distance to the horizon
const float HILLS[3] = float[3](3000.0, 10000.0, 25000.0); // m: hilltops 40 m high
const float ELEVATIONS[6] = float[6](0.2, 1.0, 4.0, 15.0, 45.0, 85.0); // degrees: sky directions

// 8-bit sRGB levels, as the output pass shows radiance.
vec3 screen(vec3 radiance) {
  vec3 c = clamp(tonemap(max(radiance * uExposure, 0.0)), 0.0, 1.0);
  return 255.0 * mix(12.92 * c, 1.055 * pow(c, vec3(1.0 / 2.4)) - 0.055, step(0.0031308, c));
}

float miss(vec3 seen, vec3 truth) {
  vec3 d = abs(screen(seen) - screen(truth));
  return max(d.r, max(d.g, d.b));
}

// The horizontal unit vector `degrees` round from the sun's azimuth.
vec3 across(float degrees) {
  vec2 s = normalize(uSunDirection.xz);
  float a = degrees * DEG;
  return vec3(s.x * cos(a) - s.y * sin(a), 0.0, s.x * sin(a) + s.y * cos(a));
}

// Far sea and hills that way, in world space (m), bent down with the planet as
// the sea is. All in sight: the sea short of the horizon, the hills above it.
vec3 farPoint(vec3 way, int k) {
  float horizon = sqrt(2000.0 * uGroundRadius * cameraPosition.y);
  float d = k < 5 ? SEA[k] * horizon : HILLS[k - 5];
  vec3 p = cameraPosition + way * d;
  p.y = (k < 5 ? 0.0 : 40.0) - d * d / (2000.0 * uGroundRadius);
  return p;
}

// mode 0: through the tables (lighting.glsl); 1: without air; 2: the air seen from sea level.
float aerialMiss(int mode) {
  float worst = 0.0;
  vec3 up = vec3(0.0, 1.0, 0.0);
  for (int a = 0; a < 3; a++) {
    for (int k = 0; k < 8; k++) {
      vec3 p = farPoint(across(AZIMUTHS[a]), k);
      vec3 radiance = 0.3 / PI * (sunLight(p, up) + skyIrradiance(p, up)); // grey ground
      vec3 ray = p - cameraPosition;
      vec3 dir = normalize(ray);
      float d = length(ray) * 0.001;
      vec3 through;
      vec3 truth = inscatter(cameraPosition.y * 0.001, dir, uSunDirection, d, DIRECT_STEPS, through);
      truth += radiance * through;
      vec3 seen = radiance;
      if (mode == 0) seen = aerialPerspective(radiance, p);
      if (mode == 2) seen = radiance * through + inscatter(0.0, dir, uSunDirection, d, DIRECT_STEPS, through);
      worst = max(worst, miss(seen, truth));
    }
  }
  return worst;
}

float skyViewMiss() {
  float worst = 0.0;
  for (int a = 0; a < 3; a++) {
    for (int k = 0; k < 6; k++) {
      float e = ELEVATIONS[k] * DEG;
      vec3 dir = across(AZIMUTHS[a]) * cos(e) + vec3(0.0, sin(e), 0.0);
      worst = max(worst, miss(skyRadiance(dir), skyRadiance(cameraPosition.y * 0.001, dir, uSunDirection, DIRECT_STEPS)));
    }
  }
  return worst;
}

// On a white surface facing up, the sun's way and away from it, sky light only:
// the light state's (times `scale`) against the sky integrated over every
// direction above the horizon from sea level, where the light state holds it,
// and the ground lit by the sun and that sky (the fourth sum: level ground).
float skyLightMiss(float scale) {
  vec3 normals[4] = vec3[4](vec3(0.0, 1.0, 0.0), across(0.0), across(180.0), vec3(0.0, 1.0, 0.0));
  vec3 sum[4] = vec3[4](vec3(0.0), vec3(0.0), vec3(0.0), vec3(0.0));
  const int AZ = 64;
  const int RINGS = 32;
  for (int i = 0; i < AZ; i++) {
    for (int j = 0; j < RINGS; j++) {
      float cosT = 1.0 - 2.0 * (float(j) + 0.5) / float(RINGS);
      float sinT = sqrt(max(1.0 - cosT * cosT, 0.0));
      float phi = 2.0 * PI * (float(i) + 0.5) / float(AZ);
      vec3 dir = vec3(sinT * cos(phi), cosT, sinT * sin(phi));
      if (dir.y < 0.0) continue;
      vec3 sky = skyRadiance(0.0, dir, uSunDirection, 32);
      for (int n = 0; n < 4; n++) sum[n] += sky * max(dot(normals[n], dir), 0.0);
    }
  }
  vec3 level = sum[3] * 4.0 * PI / float(AZ * RINGS) + uSunRadiance * max(uSunDirection.y, 0.0);
  float worst = 0.0;
  for (int n = 0; n < 3; n++) {
    vec3 truth = sum[n] * 4.0 * PI / float(AZ * RINGS) + uBounceAlbedo * level * (0.5 - 0.5 * normals[n].y);
    worst = max(worst, miss(0.8 / PI * scale * skyIrradiance(cameraPosition, normals[n]), 0.8 / PI * truth));
  }
  return worst;
}

void main() {
  int answer = int(gl_FragCoord.x);
  float worst;
  if (answer == 0) worst = aerialMiss(0);
  else if (answer == 1) worst = skyViewMiss();
  else if (answer == 2) worst = skyLightMiss(1.0);
  else if (answer == 3) worst = aerialMiss(1);
  else if (answer == 4) worst = aerialMiss(2);
  else worst = skyLightMiss(0.75);
  gl_FragColor = vec4(worst, 0.0, 0.0, 1.0);
}
