// Tool fixture (terrain.js): for each case of uCases, one per output texel (a
// point's a, o and a camera's a, o, in the cove's frame), the terrain mesh's
// own height at the point as drawn for that camera.

#include "chunks/fullscreen.wgsl"
#include "chunks/terrain-mesh.wgsl"

@group(1) @binding(0) var uCases: texture_2d<f32>;

@fragment
fn fragmentMain(in: Fullscreen) -> @location(0) vec4f {
  let c = textureLoad(uCases, vec2i(in.position.xy), 0);
  return vec4f(terrainMeshHeight(c.xy, c.zw), 0.0, 0.0, 1.0);
}
