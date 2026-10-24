// Tool fixture: a fragment shader that doesn't compile, on purpose. See broken.js.

#include "card.wgsl"
#include "chunks/scene-output.wgsl"

@fragment
fn fragmentMain(in: Varyings) -> @location(0) vec4f {
  return sceneOutput(undeclaredRadiance, 1.0);
}
