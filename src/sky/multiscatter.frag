// The multiple-scattering table (atmosphere.js): for every height and sun
// angle, the light scattered twice and more per unit of sun illuminance, after
// Hillaire 2020: second-order light from a sphere of directions, made into all
// orders as a geometric series. Rendered after the transmittance table, when
// the time changes.

#include "atmosphere.glsl"

// SQRT_DIRECTIONS, STEPS: config.sky.samples

void main() {
  float h, muSun;
  multiscatterParams(gl_FragCoord.xy / uMultiscatterSize, h, muSun);
  vec3 sun = vec3(sqrt(max(1.0 - muSun * muSun, 0.0)), muSun, 0.0);
  float r = uGroundRadius + h;

  vec3 second = vec3(0.0); // light scattered once on the way and once more here
  vec3 transfer = vec3(0.0); // the share of light that scatters once more
  for (int i = 0; i < SQRT_DIRECTIONS; i++) {
    for (int j = 0; j < SQRT_DIRECTIONS; j++) {
      float cosT = 1.0 - 2.0 * (float(j) + 0.5) / float(SQRT_DIRECTIONS);
      float sinT = sqrt(max(1.0 - cosT * cosT, 0.0));
      float phi = 2.0 * PI * (float(i) + 0.5) / float(SQRT_DIRECTIONS);
      vec3 dir = vec3(sinT * cos(phi), cosT, sinT * sin(phi));
      float tGround = distanceToGround(h, dir.y);
      float tMax = tGround >= 0.0 ? tGround : distanceToTop(h, dir.y);
      vec3 through = vec3(1.0);
      for (int k = 0; k < STEPS; k++) {
        vec2 span = marchSpan(k, STEPS, tMax);
        float dt = span.y - span.x;
        float t = 0.5 * (span.x + span.y);
        float hs = heightAlong(h, dir.y, t);
        float muS = dot(vec3(0.0, r, 0.0) + t * dir, sun) / (uGroundRadius + hs);
        Medium m = medium(hs);
        vec3 scattering = m.rayleigh + m.mie + m.haze;
        vec3 stepThrough = exp(-m.extinction * dt);
        vec3 integral = through * (1.0 - stepThrough) / max(m.extinction, vec3(1e-9));
        second += integral * scattering * transmittance(hs, muS) / (4.0 * PI);
        transfer += integral * scattering;
        through *= stepThrough;
      }
      if (tGround >= 0.0) {
        float muS = dot(normalize(vec3(0.0, r, 0.0) + tGround * dir), sun);
        second += through * transmittance(0.0, muS) * max(muS, 0.0) * uGroundAlbedo / PI;
      }
    }
  }
  float n = float(SQRT_DIRECTIONS * SQRT_DIRECTIONS);
  second /= n;
  transfer /= n;
  gl_FragColor = vec4(second / (1.0 - transfer), 1.0);
}
