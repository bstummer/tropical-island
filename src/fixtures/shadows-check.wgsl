// Fixture: see shadows.js. At each point of uPoints (world position), on a
// surface facing uNormals' normal, one per output texel: the share of the sun
// the shadow maps let reach it (chunks/shadows.wgsl shadowMap).

#include "chunks/fullscreen.wgsl"
#include "chunks/shadows.wgsl"

@group(1) @binding(0) var uPoints: texture_2d<f32>;
@group(1) @binding(1) var uNormals: texture_2d<f32>;

@fragment
fn fragmentMain(in: Fullscreen) -> @location(0) vec4f {
  let texel = vec2i(in.position.xy);
  let point = textureLoad(uPoints, texel, 0).xyz;
  let normal = textureLoad(uNormals, texel, 0).xyz;
  return vec4f(shadowMap(point, normal), 0.0, 0.0, 1.0);
}
