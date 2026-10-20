// Tool fixture: aliases on purpose on the left half. See shimmer.js.

#include "chunks/scene-output.glsl"

varying vec2 vUv;

void main() {
  // About 1.8 px per stripe at 1600 x 900, sampled once per pixel with no filtering.
  float stripes = step(0.5, fract((vUv.x + 0.6 * vUv.y) * 1400.0));
  float value = vUv.x < 0.5 ? mix(0.1, 0.9, stripes) : mix(0.2, 0.8, vUv.y);
  gl_FragColor = sceneOutput(vec3(value), 1.0);
}
