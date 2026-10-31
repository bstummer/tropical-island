// Tool fixture (waves.js): at each point of uPoints (world x, z), one per output
// texel: uMode 0, what the sea knows there (water/sea-map.wgsl); 1, the water's
// displacement there as its vertex shader adds it up, at the finest mips; 2, the surf there;
// 3, how far the foam seen from far off jumps across the reef's crest.

#include "/chunks/fullscreen.wgsl"
#include "/chunks/frame.wgsl"
#include "/chunks/terrain.wgsl"
#include "../water/sea-map.wgsl"
#include "../water/water-surf.wgsl"

struct Check {
  uMode: i32,
  uPatches: vec3f,
  uSeconds: f32, // wrapped as the waves' time is
}

@group(1) @binding(0) var<uniform> check: Check;
@group(1) @binding(1) var uPoints: texture_2d<f32>;
@group(1) @binding(5) var uWaves: texture_2d_array<f32>;
@group(1) @binding(6) var uWavesSampler: sampler;

@fragment
fn fragmentMain(in: Fullscreen) -> @location(0) vec4f {
  let xz = textureLoad(uPoints, vec2i(in.position.xy), 0).xy;
  let sea = seaAt(xz);
  if (check.uMode == 0) {
    return sea;
  }
  if (check.uMode == 2) {
    let breaking = surfAt(sea, seaShoreAt(xz), seaWaveAt(xz), 0.0, 0.0, xz, check.uSeconds);
    return vec4f(breaking.foam, breaking.height, breaking.slope, 1.0);
  }
  if (check.uMode == 3) {
    let at = seaShoreAt(xz);
    let inside = surfAt(sea, vec4f(at.xyz, -0.05), seaWaveAt(xz), 20.0, 0.0, xz, check.uSeconds).foam;
    let outside = surfAt(sea, vec4f(at.xyz, 0.05), seaWaveAt(xz), 20.0, 0.0, xz, check.uSeconds).foam;
    return vec4f(abs(inside - outside), 0.0, 0.0, 1.0);
  }
  let reach = cascadeReach(sea);
  var moved = vec3f(0.0);
  for (var c = 0; c < 3; c++) {
    let read = select(xz, chopRest(xz), c == 1);
    moved += reach[c] * textureSampleLevel(uWaves, uWavesSampler, read * check.uPatches[c], 2 * c, 0.0).xyz;
  }
  moved.y += surfAt(sea, seaShoreAt(xz), seaWaveAt(xz), 0.0, 0.0, xz, check.uSeconds).height;
  return vec4f(moved, 1.0);
}
