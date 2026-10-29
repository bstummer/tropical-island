// Fixture: see shade.js. At each point of uPoints (world position, and in w
// how high over the ground under it), one per output texel, the island's shade
// as chunks/shadows.wgsl reads it: with SHADE_GROUND the ground's share of the
// sun and of the ground around (at the finest level: no footprint), else the
// share at the point's height.

#include "chunks/fullscreen.wgsl"
#include "chunks/shadows.wgsl"

@group(1) @binding(0) var uPoints: texture_2d<f32>;

@fragment
fn fragmentMain(in: Fullscreen) -> @location(0) vec4f {
  let point = textureLoad(uPoints, vec2i(in.position.xy), 0);
  return vec4f(islandShadeAt(point.xyz, vec2f(0.0), vec2f(0.0), point.w), 0.0, 1.0);
}
