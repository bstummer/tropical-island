// Tool fixture (waves.js): at each point of uPoints (world x, z), one per output
// texel: uMode 0, what the sea knows there (water/sea-map.wgsl); 1, the water's
// displacement there as its vertex shader adds it up, at the finest mips; 2, the surf there;
// 4, as 1 but
// read where the texel's corner is, half a texel off (a mistake); 5, the beach's water
// (water/swash.wgsl) over the ground as drawn there, at the frame's waves' time; 6, the
// waves coming in over the last of the shallows there (swashBore), and the light they gather on the
// floor (swashLens), at that time; 7, the light
// the ripples gather on the floor (water-caustics.wgsl causticAt) at each point's x, z, depth and
// ripples dropped (uPoints' four channels), at uSeconds.

#include "/chunks/fullscreen.wgsl"
#include "/chunks/frame.wgsl"
#include "/chunks/terrain.wgsl"
#include "../water/sea-map.wgsl"
#include "../water/water-surf.wgsl"
#include "../water/swash.wgsl"
#include "../water/water-caustics.wgsl"

struct Check {
  uMode: i32,
  uPatches: vec3f,
  uWaveTexels: f32, // across each cascade's texture
  uSeconds: f32, // wrapped as the waves' time is
}

// The light the waves coming in gather on the floor is told `ahead` m further out, the light going `d` m
// sideways per their rise per m, as soft as `soft`, held to `peak` (waves.js BORE_LENS).
const BORE_LENS = vec4f(0.05, 0.06, 0.2, 4.0);
// How far apart the sea's mesh's vertices are that gather at them (waves.js BORE_GATHER).
const BORE_GATHER: f32 = 0.25;

@group(1) @binding(0) var<uniform> check: Check;
@group(1) @binding(1) var uPoints: texture_2d<f32>;
@group(1) @binding(5) var uWaves: texture_2d_array<f32>;
@group(1) @binding(6) var uWavesSampler: sampler;

@fragment
fn fragmentMain(in: Fullscreen) -> @location(0) vec4f {
  let point = textureLoad(uPoints, vec2i(in.position.xy), 0);
  if (check.uMode == 7) {
    return vec4f(causticAt(point.xy, point.z, check.uSeconds, point.w), 0.0, 0.0, 1.0);
  }
  let xz = point.xy;
  let sea = seaAt(xz);
  if (check.uMode == 0) {
    return sea;
  }
  if (check.uMode == 5) {
    let wash = swashAt(xz, terrainHeight(terrainCove(xz), 0), sea.x, seaShoreAt(xz).xy, 0.0);
    return vec4f(wash.level, wash.cover, wash.foam + wash.line, wash.film);
  }
  if (check.uMode == 6 || check.uMode == 8) {
    let bore = swashBore(swashPlace(xz, sea.x, seaShoreAt(xz).xy), sea.x, sea.y);
    if (check.uMode == 8) {
      let top = xz - normalize(terrainWorld(seaShoreAt(xz).xy) + vec2f(1e-6, 0.0)) * swashTopOf(bore);
      let seaTop = seaAt(top);
      let crest = swashBore(swashPlace(top, seaTop.x, seaShoreAt(top).xy), seaTop.x, seaTop.y);
      return vec4f(swashGather(bore, crest, BORE_GATHER, seaTop.x), 0.0, 0.0, 1.0);
    }
    return vec4f(bore.height, bore.slope, bore.foam, swashLens(bore, BORE_LENS.x, BORE_LENS.y, BORE_LENS.z, BORE_LENS.w));
  }
  if (check.uMode == 2) {
    let breaking = surfAt(sea, seaShoreAt(xz), seaWaveAt(xz), 0.0, xz, check.uSeconds);
    return vec4f(breaking.foam, breaking.height, breaking.slope, 1.0);
  }
  let reach = cascadeReach(sea);
  var moved = vec3f(0.0);
  for (var c = 0; c < 3; c++) {
    let read = select(xz, chopRest(xz), c == 1);
    let uv = select(wavesUv(read, check.uPatches[c], check.uWaveTexels), read * check.uPatches[c], check.uMode == 4);
    moved += reach[c] * textureSampleLevel(uWaves, uWavesSampler, uv, 2 * c, 0.0).xyz;
  }
  moved.y += surfAt(sea, seaShoreAt(xz), seaWaveAt(xz), 0.0, xz, check.uSeconds).height;
  moved.y = max(moved.y, troughFloor(terrainHeight(terrainCove(xz), 0)));
  return vec4f(moved, 1.0);
}
