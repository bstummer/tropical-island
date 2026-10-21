// The aerial-perspective table (atmosphere.js; chunks/aerial.glsl has the
// mapping): one distance slice per draw, for the camera's height and the sun.
// The same in-scattering as the sky, over the same curved planet (far surfaces
// bend down with it), so far land and sea meet the sky's horizon seamlessly.

#include "atmosphere.glsl"
#include "chunks/aerial.glsl"

uniform float uHeight; // km
uniform float uSunMu; // the sun's zenith cosine
uniform float uSlice;

// STEPS: config.sky.samples

void main() {
  vec3 dir;
  float distance;
  aerialParams(vec3(gl_FragCoord.xy, uSlice + 0.5) / uAerialSize, dir, distance);
  vec3 sun = vec3(sqrt(max(1.0 - uSunMu * uSunMu, 0.0)), uSunMu, 0.0);
  float tGround = distanceToGround(uHeight, dir.y);
  vec3 through;
  vec3 light = inscatter(uHeight, dir, sun, tGround >= 0.0 ? min(distance, tGround) : distance, STEPS, through);
  gl_FragColor = vec4(light, (through.r + through.g + through.b) / 3.0);
}
