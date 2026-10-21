// The transmittance table (atmosphere.js): how much light gets through from
// every height and angle to space. Rendered once.

#include "atmosphere.glsl"

// STEPS: config.sky.samples

void main() {
  float h, mu;
  transmittanceParams(gl_FragCoord.xy / uTransmittanceSize, h, mu);
  float dt = distanceToTop(h, mu) / float(STEPS);
  vec3 depth = vec3(0.0);
  for (int i = 0; i < STEPS; i++) depth += medium(heightAlong(h, mu, (float(i) + 0.5) * dt)).extinction;
  gl_FragColor = vec4(exp(-depth * dt), 1.0);
}
