// Tool fixture: a shader that compiles, but no pipeline can be made of it as
// its material stands: it needs an override the material doesn't set. See broken.js.

#include "card.wgsl"
#include "chunks/scene-output.wgsl"

override UNSET: f32; // no default

@fragment
fn fragmentMain(in: Varyings) -> @location(0) vec4f {
  return sceneOutput(vec3f(UNSET), 1.0);
}
