// Tool fixture (terrain.js): at each point of uPoints (world x, z), one per
// output texel, the ground's albedo the light from below reads there
// (chunks/lighting.wgsl groundAlbedo).

#include "chunks/fullscreen.wgsl"
#include "chunks/lighting.wgsl"

@group(1) @binding(0) var uPoints: texture_2d<f32>;

@fragment
fn fragmentMain(in: Fullscreen) -> @location(0) vec4f {
  let xz = textureLoad(uPoints, vec2i(in.position.xy), 0).xy;
  return vec4f(groundAlbedo(vec3f(xz.x, 0.0, xz.y)), 1.0);
}
