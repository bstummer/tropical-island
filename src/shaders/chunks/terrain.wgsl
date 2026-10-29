// The island as drawn: the grids of world/heightmap.js, which
// world/terrain.js uploads, a fine one (level 0) inside a coarse one (level 1),
// each its own textures (chunks/frame.wgsl), as they differ in size.
// terrainHeight() samples them exactly as heightmap.js heightAtCove() does,
// and terrainGround() as groundAtCove(), so the drawn ground is where and
// what JS thinks it is (the screenshot tool's terrain check compares them).
// Positions are in the cove's frame (world/island.js): a along the beach, o
// out to sea.

#include "frame.wgsl"

const TERRAIN_LEVELS: i32 = 2;
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
  let last = frame.uTerrainLevels[k].w - 1.0;
  let inside = min(min(f.x, f.y), min(last - f.x, last - f.y)) - 1.0;
  return clamp(inside / frame.uTerrainBlend, 0.0, 1.0);
}

// Catmull-Rom's weights at t for the samples at -1, 0, 1 and 2
// (heightmap.js cubicWeights).
fn terrainCubicWeights(t: f32) -> vec4f {
  let t2 = t * t;
  let t3 = t2 * t;
  return 0.5 * vec4f(-t3 + 2.0 * t2 - t, 3.0 * t3 - 5.0 * t2 + 2.0, -3.0 * t3 + 4.0 * t2 + t, t3 - t2);
}

// Samples c to c + 1 of level k in one read, unfiltered: the 2 x 2 a bilinear
// filter would take at their shared corner, in the order (c, c+1), (c+1, c+1),
// (c+1, c), (c, c), clamped at the grid's edges. A sampled read is cheaper than
// four textureLoads, which robustness checks one by one.
fn terrainGather(k: i32, c: vec2f) -> vec4f {
  let uv = (c + 1.0) / frame.uTerrainLevels[k].w;
  if (k == 0) {
    return textureGather(0, uTerrainHeight, uTerrainHeightTexels, uv);
  }
  return textureGather(0, uTerrainHeightCoarse, uTerrainHeightTexels, uv);
}

// Catmull-Rom from the 4 x 4 samples round ao (heightmap.js cubic): a curve
// through the samples whose slope runs on across them.
fn terrainCubic(k: i32, ao: vec2f) -> f32 {
  let last = frame.uTerrainLevels[k].w - 1.0;
  let f = clamp(terrainGrid(k, ao), vec2f(0.0), vec2f(last));
  let i = min(floor(f), vec2f(last - 1.0));
  let wa = terrainCubicWeights(f.x - i.x);
  let wo = terrainCubicWeights(f.y - i.y);
  let near = terrainGather(k, i - 1.0); // columns i - 1, i; rows i - 1, i
  let right = terrainGather(k, i + vec2f(1.0, -1.0));
  let up = terrainGather(k, i + vec2f(-1.0, 1.0));
  let far = terrainGather(k, i + 1.0);
  let rows = vec4f(
    dot(wa, vec4f(near.w, near.z, right.w, right.z)),
    dot(wa, vec4f(near.x, near.y, right.x, right.y)),
    dot(wa, vec4f(up.w, up.z, far.w, far.z)),
    dot(wa, vec4f(up.x, up.y, far.x, far.y))
  );
  return dot(wo, rows);
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
    let h = terrainCubic(k, ao);
    if (w >= 1.0) {
      return h;
    }
    return mix(terrainCubic(k + 1, ao), h, w);
  }
  return terrainCubic(TERRAIN_LEVELS - 1, ao);
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
    let uv = (terrainGrid(k, ao) + 0.5) / frame.uTerrainLevels[k].w;
    let lod = log2(max(footprint / frame.uTerrainLevels[k].z, 1e-6));
    if (k == 0) {
      *info += left * w * textureSampleLevel(uTerrainSurface, uTerrainSurfaceSampler, uv, 0, lod);
      *cover += left * w * textureSampleLevel(uTerrainSurface, uTerrainSurfaceSampler, uv, 1, lod);
    } else {
      *info += left * w * textureSampleLevel(uTerrainSurfaceCoarse, uTerrainSurfaceCoarseSampler, uv, 0, lod);
      *cover += left * w * textureSampleLevel(uTerrainSurfaceCoarse, uTerrainSurfaceCoarseSampler, uv, 1, lod);
    }
    left *= 1.0 - w;
    if (left <= 0.0) {
      break;
    }
  }
}
