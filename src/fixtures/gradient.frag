// Tool fixture: two slow horizontal gradients (linear radiance). See gradient.js.

#include "chunks/scene-output.glsl"

varying vec2 vUv;

void main() {
  vec3 grey = vec3(mix(0.20, 0.26, vUv.x));
  vec3 sky = mix(vec3(0.10, 0.25, 0.60), vec3(0.12, 0.29, 0.66), vUv.x);
  gl_FragColor = sceneOutput(vUv.y > 0.5 ? grey : sky, 1.0);
}
