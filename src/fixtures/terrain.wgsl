// Tool fixture: at each point of uPoints (world x, z and the level to read
// from per texel), one per output texel, by uRead: 0 the drawn height, 1 the
// ground (sand, rock, band, reef's offset), 2 how lush the green is there and
// how sandy the soil; the ground as a pixel uFootprint metres across reads it
// (0: at its finest). uOffset shifts every point, a deliberate mistake.

#include "chunks/fullscreen.wgsl"
#include "chunks/terrain.wgsl"

struct TerrainCheck {
  uOffset: f32,
  uRead: i32,
  uFootprint: f32,
}

@group(1) @binding(0) var<uniform> check: TerrainCheck;
@group(1) @binding(1) var uPoints: texture_2d<f32>;

@fragment
fn fragmentMain(in: Fullscreen) -> @location(0) vec4f {
  let point = textureLoad(uPoints, vec2i(in.position.xy), 0).xyz;
  let ao = terrainCove(point.xy + check.uOffset);
  if (check.uRead > 0) {
    var info: vec4f;
    var cover: vec4f;
    terrainGround(ao, vec2f(check.uFootprint, 0.0), vec2f(0.0), &info, &cover);
    return select(vec4f(cover.zw, 0.0, 1.0), vec4f(cover.xy, info.zw), check.uRead == 1);
  }
  return vec4f(terrainHeight(ao, i32(point.z)), 0.0, 0.0, 1.0);
}
