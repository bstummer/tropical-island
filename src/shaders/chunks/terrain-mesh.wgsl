// The terrain's mesh as drawn (world/lod.js, world/terrain.js): where a vertex
// of it lies once morphed for the camera, which terrain.wgsl draws, and the
// mesh's own height at any point, which what stands on the ground needs: far
// from the camera the mesh's coarser levels stray from the heightmap's finest
// height (terrainHeight(ao, 0)), by centimetres to metres. lod.js
// createMeshHeight is the JS twin. Takes LOD_LEVELS (an override) and the
// uniforms world/terrain.js keeps in ctx.terrain.mesh. Positions are in the
// cove's frame.

#include "terrain.wgsl"

override LOD_LEVELS: i32 = 8;

// The arrays hold up to 16 levels (world/terrain.js LOD_MAX checks; an array's
// length must be a literal for gpu/reflect.js).
struct TerrainMesh {
  uMorph: array<vec4f, 16>, // per level, .xy: the distances over which it morphs into the next
  uLodRange: array<vec4f, 16>, // per level, .x: how far it reaches (uniform arrays hold vec4f: reflect.js)
  uLodTree: vec4f, // the quadtree's origin a, o; its leaves' size (m); quads across a node
}

@group(1) @binding(15) var<uniform> terrainMesh: TerrainMesh;

fn terrainHeightLevel(level: i32) -> i32 {
  return min(level, TERRAIN_LEVELS - 1);
}

// A vertex of a node at `level`, `grid` whole quads from `corner`, `spacing`
// apart, morphed for the camera: where it lies (a, o) and how far it has
// morphed (0 to 1). Vertices morph onto the next coarser grid as they near
// the end of their level's range, so a node meets its coarser neighbour
// without a seam.
fn terrainMorph(corner: vec2f, gridIn: vec2f, spacing: f32, level: i32, camera: vec2f) -> vec3f {
  var grid = gridIn;
  let ao = corner + grid * spacing;
  let k = clamp((length(ao - camera) - terrainMesh.uMorph[level].x) / (terrainMesh.uMorph[level].y - terrainMesh.uMorph[level].x), 0.0, 1.0);
  grid -= fract(grid * 0.5) * 2.0 * k; // odd vertices slide onto the coarser grid's lines
  return vec3f(corner + grid * spacing, k);
}

// A morphed vertex's height: its level's, the coarser level's, or between.
fn terrainMorphHeight(morph: vec3f, level: i32) -> f32 {
  if (morph.z == 0.0) {
    return terrainHeight(morph.xy, terrainHeightLevel(level)); // as most are
  }
  let coarse = terrainHeight(morph.xy, terrainHeightLevel(level + 1));
  if (morph.z < 1.0) {
    return mix(terrainHeight(morph.xy, terrainHeightLevel(level)), coarse, morph.z);
  }
  return coarse;
}

// Distance squared from the camera to a node's square, across the ground.
fn terrainNodeDistance2(camera: vec2f, corner: vec2f, size: f32) -> f32 {
  let d = max(max(corner - camera, camera - corner - size), vec2f(0.0));
  return dot(d, d);
}

// Where p lies in the triangle a, b, c (as the grid winds them): its weights
// for them, all at least 0 inside; none where the triangle has no area
// (morphed flat), or has turned over: near the end of a morph band a vertex
// that has finished can slide past a neighbour that hasn't, and the GPU culls
// the sliver between them, which faces down.
fn terrainBarycentric(p: vec2f, a: vec2f, b: vec2f, c: vec2f) -> vec3f {
  let ab = b - a;
  let ac = c - a;
  let ap = p - a;
  let area = ab.x * ac.y - ac.x * ab.y;
  if (area > -1e-6) {
    return vec3f(-1e9);
  }
  let u = (ap.x * ac.y - ac.x * ap.y) / area;
  let v = (ab.x * ap.y - ap.x * ab.y) / area;
  return vec3f(1.0 - u - v, u, v);
}

// The 2 x 2 quads round a point as triangles of their 3 x 3 vertices (3 y + x),
// split as world/terrain.js splits each quad (i, j): (i, j), (i, j + 1),
// (i + 1, j) and (i + 1, j), (i, j + 1), (i + 1, j + 1).
const TERRAIN_BLOCK = array<i32, 24>(0, 3, 1, 1, 3, 4, 1, 4, 2, 2, 4, 5, 3, 6, 4, 4, 6, 7, 4, 7, 5, 5, 7, 8);

// The mesh's height at ao for a camera at `camera` (both in the cove's
// frame), as the GPU draws it there: the twin of lod.js createMeshHeight,
// step for step.
fn terrainMeshHeight(ao: vec2f, camera: vec2f) -> f32 {
  // The node over ao, as lod.js picks it with everything in view: down from
  // the root while a node splits, into the child holding ao; a child out of
  // its range is drawn as a quarter of its parent.
  var level = LOD_LEVELS - 1;
  var size = terrainMesh.uLodTree.z * exp2(f32(level));
  var corner = terrainMesh.uLodTree.xy;
  var quads = terrainMesh.uLodTree.w;
  for (var i = 0; i < LOD_LEVELS - 1; i++) {
    let range = terrainMesh.uLodRange[level - 1].x;
    if (terrainNodeDistance2(camera, corner, size) > range * range) {
      break;
    }
    let child = 0.5 * size;
    corner += clamp(floor((ao - corner) / child), vec2f(0.0), vec2f(1.0)) * child;
    if (terrainNodeDistance2(camera, corner, child) > range * range) {
      quads *= 0.5;
      break;
    }
    size = child;
    level--;
    if (level == 0) {
      break;
    }
  }
  let spacing = size / terrainMesh.uLodTree.w;

  // The 2 x 2 quads between even grid lines round ao: the morph moves odd
  // vertices toward the even ones before them but never across an even line,
  // so ao lies in one of these quads' eight triangles. Each vertex morphs by
  // its own distance.
  let block = 2.0 * clamp(floor((ao - corner) / (2.0 * spacing)), vec2f(0.0), vec2f(0.5 * quads - 1.0));
  var morph: array<vec3f, 9>;
  for (var n = 0; n < 9; n++) {
    morph[n] = terrainMorph(corner, block + vec2f(f32(n % 3), f32(n / 3)), spacing, level, camera);
  }

  // The triangle ao is most inside; where front faces overlap a little, by
  // turned-over slivers, either one may be drawn.
  var best = -1e9;
  var t = 0;
  var weights = vec3f(0.0);
  for (var s = 0; s < 24; s += 3) {
    let b = terrainBarycentric(ao, morph[TERRAIN_BLOCK[s]].xy, morph[TERRAIN_BLOCK[s + 1]].xy, morph[TERRAIN_BLOCK[s + 2]].xy);
    let least = min(b.x, min(b.y, b.z));
    if (least > best) {
      best = least;
      t = s;
      weights = b;
    }
  }
  // Linear across it, as the rasterizer interpolates.
  return weights.x * terrainMorphHeight(morph[TERRAIN_BLOCK[t]], level) + weights.y * terrainMorphHeight(morph[TERRAIN_BLOCK[t + 1]], level) + weights.z * terrainMorphHeight(morph[TERRAIN_BLOCK[t + 2]], level);
}
