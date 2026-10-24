// The island as drawn: the nested grids of world/heightmap.js, which
// world/terrain.js uploads. terrainHeight() samples them exactly as
// heightmap.js heightAtCove() does, and terrainGround() as groundAtCove(), so
// the drawn ground is where and what JS thinks it is (the screenshot tool's
// terrain check compares them). Positions are in
// the cove's frame (world/island.js): a along the beach, o out to sea.

#include "frame.wgsl"

const TERRAIN_LEVELS: i32 = 4;
const TERRAIN_DEEP: f32 = -1000.0;

fn terrainCove(xz: vec2f) -> vec2f {
  return vec2f(dot(xz, frame.uTerrainFrame.xy), dot(xz, frame.uTerrainFrame.zw));
}

// The frame is orthonormal: its inverse is its transpose.
fn terrainWorld(ao: vec2f) -> vec2f {
  return ao.x * frame.uTerrainFrame.xy + ao.y * frame.uTerrainFrame.zw;
}

// A slope along a and o as one along world x and z.
fn terrainWorldSlope(slope: vec2f) -> vec2f {
  return vec2f(dot(slope, vec2f(frame.uTerrainFrame.x, frame.uTerrainFrame.z)), dot(slope, vec2f(frame.uTerrainFrame.y, frame.uTerrainFrame.w)));
}

// Position in level k's samples.
fn terrainGrid(k: i32, ao: vec2f) -> vec2f {
  return (ao - frame.uTerrainLevels[k].xy) / frame.uTerrainLevels[k].z;
}

// How much level k has its say: 1 well inside it, 0 over the last
// uTerrainBlend samples before its edge.
fn terrainWeight(k: i32, ao: vec2f) -> f32 {
  let f = terrainGrid(k, ao);
  let last = frame.uTerrainSamples - 1.0;
  let inside = min(min(f.x, f.y), min(last - f.x, last - f.y)) - 1.0;
  return clamp(inside / frame.uTerrainBlend, 0.0, 1.0);
}

fn terrainBilinear(k: i32, ao: vec2f) -> f32 {
  let last = frame.uTerrainSamples - 1.0;
  let f = clamp(terrainGrid(k, ao), vec2f(0.0), vec2f(last));
  let i = min(floor(f), vec2f(last - 1.0));
  let t = f - i;
  let p = vec2i(i32(i.x), i32(i.y));
  let h00 = textureLoad(uTerrainHeight, p, k, 0).r;
  let h10 = textureLoad(uTerrainHeight, p + vec2i(1, 0), k, 0).r;
  let h01 = textureLoad(uTerrainHeight, p + vec2i(0, 1), k, 0).r;
  let h11 = textureLoad(uTerrainHeight, p + vec2i(1, 1), k, 0).r;
  return mix(mix(h00, h10, t.x), mix(h01, h11, t.x), t.y);
}

// The drawn height at ao, from level `first` or coarser.
fn terrainHeight(ao: vec2f, first: i32) -> f32 {
  if (frame.uTerrainReady < 0.5) {
    return TERRAIN_DEEP;
  }
  for (var k = first; k < TERRAIN_LEVELS - 1; k++) {
    let w = terrainWeight(k, ao);
    if (w <= 0.0) {
      continue;
    }
    let h = terrainBilinear(k, ao);
    if (w >= 1.0) {
      return h;
    }
    return mix(terrainBilinear(k + 1, ao), h, w);
  }
  return terrainBilinear(TERRAIN_LEVELS - 1, ao);
}

// The slopes and the ground at ao (heightmap.js groundAtCove, world/island.js
// groundOf and lushOf), filtered over a pixel's footprint (dx, dy: the
// derivatives of ao), from the finest level there. info: slope along a and o,
// band, reef's offset; cover: sand, rock, how lush the green is, how sandy the soil.
fn terrainGround(ao: vec2f, dx: vec2f, dy: vec2f, info: ptr<function, vec4f>, cover: ptr<function, vec4f>) {
  *info = vec4f(0.0);
  *cover = vec4f(0.0);
  if (frame.uTerrainReady < 0.5) {
    return;
  }
  let footprint = sqrt(max(dot(dx, dx), dot(dy, dy)));
  var left = 1.0; // the share still to fill, finest level first
  for (var k = 0; k < TERRAIN_LEVELS; k++) {
    var w = 1.0;
    if (k != TERRAIN_LEVELS - 1) {
      w = terrainWeight(k, ao);
    }
    if (w <= 0.0) {
      continue;
    }
    let uv = (terrainGrid(k, ao) + 0.5) / frame.uTerrainSamples;
    let lod = log2(max(footprint / frame.uTerrainLevels[k].z, 1e-6));
    *info += left * w * textureSampleLevel(uTerrainInfo, uTerrainInfoSampler, uv, k, lod);
    *cover += left * w * textureSampleLevel(uTerrainGround, uTerrainGroundSampler, uv, k, lod);
    left *= 1.0 - w;
    if (left <= 0.0) {
      break;
    }
  }
}
