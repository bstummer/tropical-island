// Tool fixture (waves.js): at each point of uPoints (world x, z), one per output
// texel: uMode 0, what the sea knows there (water/sea-map.wgsl); 1, the water's
// displacement there as its vertex shader adds it up, at the finest mips.

#include "/chunks/fullscreen.wgsl"
#include "/chunks/frame.wgsl"
#include "/chunks/terrain.wgsl"
#include "../water/sea-map.wgsl"

struct Check {
  uMode: i32,
  uPatches: vec3f,
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
  let reach = cascadeReach(sea);
  var moved = vec3f(0.0);
  for (var c = 0; c < 3; c++) {
    moved += reach[c] * textureSampleLevel(uWaves, uWavesSampler, xz * check.uPatches[c], 2 * c, 0.0).xyz;
  }
  return vec4f(moved, 1.0);
}
