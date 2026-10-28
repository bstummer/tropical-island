// A mip level of the leaf litter's tile or its leaves' masks, made in JS
// (textures/litter-tones.js litterLevels), into its level of the surfaces'
// array (textures/green.js), which takes nothing but drawing: texel by texel.

#include "chunks/fullscreen.wgsl"

@group(1) @binding(0) var uLevel: texture_2d<f32>;

@fragment
fn fragmentMain(in: Fullscreen) -> @location(0) vec4f {
  return textureLoad(uLevel, vec2i(in.position.xy), 0);
}
