// The aerial perspective's transmittance (atmosphere.js; chunks/aerial.glsl has
// the mapping): the share of a point's own light that reaches the camera, per
// colour, for the camera's height. It depends on neither the sun nor the
// azimuth, so a 2D table holds it, by the aerial table's rows (x) and slices (y).
// Per colour: the haze dims blue more than red, which keeps distant land warm.

#include "atmosphere.glsl"
#include "chunks/aerial.glsl"

uniform float uHeight; // km

// STEPS: config.sky.samples

void main() {
  vec3 dir;
  float distance;
  aerialParams(vec3(0.0, gl_FragCoord.xy / uAerialSize.yz), dir, distance);
  // Past the sea, as the aerial table does (aerial.frag).
  gl_FragColor = vec4(exp(-opticalDepth(uHeight, dir.y, distance, STEPS)), 1.0);
}
