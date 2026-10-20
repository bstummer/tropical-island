// Tool fixture: a sunset sky from 5 to over 400 times the bars' brightness. See silhouette.js.

#include "chunks/scene-output.glsl"

varying vec2 vUv;

void main() {
  vec3 sky = mix(vec3(6.0, 3.0, 1.5), vec3(1.5, 1.5, 3.0), vUv.y);
  float sun = exp(-12.0 * length((vUv - vec2(0.55, 0.45)) * vec2(1.78, 1.0)));
  gl_FragColor = sceneOutput(sky + vec3(12.0, 8.0, 4.0) * sun, 1.0);
}
