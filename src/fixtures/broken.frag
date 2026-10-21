// Tool fixture: a fragment shader that doesn't compile, on purpose. See broken.js.

#include "chunks/scene-output.glsl"

void main() {
  gl_FragColor = sceneOutput(undeclaredRadiance, 1.0);
}
