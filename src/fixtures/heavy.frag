// Tool fixture: VARIANT makes each material its own shader program. See heavy.js.

#include "chunks/scene-output.glsl"

void main() {
  gl_FragColor = sceneOutput(vec3(float(VARIANT) / 70.0), 1.0);
}
