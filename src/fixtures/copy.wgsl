// Tool fixture: a post pass that changes nothing (see blend.js).

#include "chunks/fullscreen.wgsl"

@group(1) @binding(0) var uInput: texture_2d<f32>;

@fragment
fn fragmentMain(in: Fullscreen) -> @location(0) vec4f {
  return textureLoad(uInput, vec2i(in.position.xy), 0);
}
