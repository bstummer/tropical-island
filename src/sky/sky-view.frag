// The sky-view table (atmosphere.js): the sky's radiance in every direction
// from one height, for one sun. Rendered again when the time or the camera's
// height changes.

#include "atmosphere.glsl"

uniform float uHeight; // km
uniform float uSunMu; // the sun's zenith cosine
uniform vec2 uSize;

// STEPS: config.sky.samples

void main() {
  float mu, cosAzimuth;
  skyViewParams(gl_FragCoord.xy / uSize, uHeight, uSize, mu, cosAzimuth);
  float sinZ = sqrt(max(1.0 - mu * mu, 0.0));
  vec3 dir = vec3(sinZ * cosAzimuth, mu, sinZ * sqrt(max(1.0 - cosAzimuth * cosAzimuth, 0.0)));
  vec3 sun = vec3(sqrt(max(1.0 - uSunMu * uSunMu, 0.0)), uSunMu, 0.0);
  gl_FragColor = vec4(skyRadiance(uHeight, dir, sun, STEPS), 1.0);
}
