// Tool fixture: VARIANT makes each material a pipeline of its own. See heavy.js.

#include "card.wgsl"
#include "chunks/scene-output.wgsl"

override VARIANT: i32 = 0;

@fragment
fn fragmentMain(in: Varyings) -> @location(0) vec4f {
  return sceneOutput(vec3f(f32(VARIANT) / 70.0), 1.0);
}
