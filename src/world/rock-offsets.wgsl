// How far each rock (world/rocks.js) moves up or down to stay sunk in the
// terrain's mesh as drawn this frame: as far as the mesh lies furthest below
// the finest height, which placement sank it into, at its place and round it
// as far as it spreads. A block of 3 x 3 texels per rock, one point each (the
// first its place, the rest round it), whose least is its offset: one call of
// the mesh's height per texel keeps the shader small.

#include "chunks/fullscreen.wgsl"
#include "chunks/terrain-mesh.wgsl"

struct RockOffsets {
  uCamera: vec2f, // the camera, a and o in the cove's frame
}

@group(1) @binding(0) var<uniform> offsets: RockOffsets;
@group(1) @binding(1) var uRockPlaces: texture_2d<f32>; // per rock: its place, a and o in the cove's frame; how far it spreads (m)

@fragment
fn fragmentMain(in: Fullscreen) -> @location(0) vec4f {
  let texel = vec2i(in.position.xy);
  let k = texel.x % 3 + 3 * (texel.y % 3);
  let place = textureLoad(uRockPlaces, texel / 3, 0).xyz;
  let angle = f32(k) * 0.7853982;
  let ao = place.xy + select(place.z, 0.0, k == 0) * vec2f(cos(angle), sin(angle));
  return vec4f(terrainMeshHeight(ao, offsets.uCamera) - terrainHeight(ao, 0), 0.0, 0.0, 1.0);
}
