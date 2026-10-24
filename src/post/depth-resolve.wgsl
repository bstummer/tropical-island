// The scene's depth as passes read it (frame.js): one sample of each pixel of
// the multisampled depth, the first, as WebGL's blit of depth takes it. The
// translucent layer hides behind it, and after-opaque materials and depth
// posts read it (frame.opaque.depth).

#include "chunks/fullscreen.wgsl"

@group(1) @binding(0) var uDepth: texture_depth_multisampled_2d;

@fragment
fn fragmentMain(in: Fullscreen) -> @builtin(frag_depth) f32 {
  return textureLoad(uDepth, vec2i(in.position.xy), 0);
}
