// Tool fixture (terrain.js): at each point of uPoints (world x, z and a height
// above the sea), one per output texel, how wet the ground is there
// (chunks/wet.wgsl groundWet), as sharp as at a point and with the waves'
// reach taken out, as world/albedo.js sandWetness has it.

#include "chunks/fullscreen.wgsl"
#include "chunks/wet.wgsl"

@group(1) @binding(0) var uPoints: texture_2d<f32>;

@fragment
fn fragmentMain(in: Fullscreen) -> @location(0) vec4f {
  let point = textureLoad(uPoints, vec2i(in.position.xy), 0).xyz;
  return vec4f(groundWet(point.xy, point.z + wetReach(point.xy, 0.0), 0.0).wetness, 0.0, 0.0, 1.0);
}
