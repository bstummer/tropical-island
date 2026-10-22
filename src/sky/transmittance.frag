// The transmittance table (atmosphere.js): how much light gets through from
// every height and angle to space. Rendered when the time changes, since the
// haze changes with it.

#include "atmosphere.glsl"

// STEPS: config.sky.samples

void main() {
  float h, mu;
  transmittanceParams(gl_FragCoord.xy / uTransmittanceSize, h, mu);
  gl_FragColor = vec4(exp(-opticalDepth(h, mu, distanceToTop(h, mu), STEPS)), 1.0);
}
