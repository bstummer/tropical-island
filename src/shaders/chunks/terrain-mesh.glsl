// The terrain's mesh as drawn (world/lod.js, world/terrain.js): where a vertex
// of it lies once morphed for the camera, which terrain.vert draws, and the
// mesh's own height at any point, which what stands on the ground needs: far
// from the camera the mesh's coarser levels stray from the heightmap's finest
// height (terrainHeight(ao, 0)), by centimetres to metres. lod.js
// createMeshHeight is the JS twin. Needs LOD_LEVELS defined. Positions are in
// the cove's frame.

#include "terrain.glsl"

uniform vec2 uMorph[LOD_LEVELS]; // per level: the distances over which it morphs into the next
uniform float uLodRange[LOD_LEVELS]; // per level: how far it reaches
uniform vec4 uLodTree; // the quadtree's origin a, o; its leaves' size (m); quads across a node

int terrainHeightLevel(int level) {
  return min(level, TERRAIN_LEVELS - 1);
}

// A vertex of a node at `level`, `grid` whole quads from `corner`, `spacing`
// apart, morphed for the camera: where it lies (a, o) and how far it has
// morphed (0 to 1). Vertices morph onto the next coarser grid as they near
// the end of their level's range, so a node meets its coarser neighbour
// without a seam.
vec3 terrainMorph(vec2 corner, vec2 grid, float spacing, int level, vec2 camera) {
  vec2 ao = corner + grid * spacing;
  float k = clamp((length(ao - camera) - uMorph[level].x) / (uMorph[level].y - uMorph[level].x), 0.0, 1.0);
  grid -= fract(grid * 0.5) * 2.0 * k; // odd vertices slide onto the coarser grid's lines
  return vec3(corner + grid * spacing, k);
}

// A morphed vertex's height: its level's, the coarser level's, or between.
float terrainMorphHeight(vec3 morph, int level) {
  if (morph.z == 0.0) return terrainHeight(morph.xy, terrainHeightLevel(level)); // as most are
  float coarse = terrainHeight(morph.xy, terrainHeightLevel(level + 1));
  return morph.z < 1.0 ? mix(terrainHeight(morph.xy, terrainHeightLevel(level)), coarse, morph.z) : coarse;
}

// Distance squared from the camera to a node's square, across the ground.
float terrainNodeDistance2(vec2 camera, vec2 corner, float size) {
  vec2 d = max(max(corner - camera, camera - corner - size), 0.0);
  return dot(d, d);
}

// Where p lies in the triangle a, b, c (as the grid winds them): its weights
// for them, all at least 0 inside; none where the triangle has no area
// (morphed flat), or has turned over: near the end of a morph band a vertex
// that has finished can slide past a neighbour that hasn't, and the GPU culls
// the sliver between them, which faces down.
vec3 terrainBarycentric(vec2 p, vec2 a, vec2 b, vec2 c) {
  vec2 ab = b - a;
  vec2 ac = c - a;
  vec2 ap = p - a;
  float area = ab.x * ac.y - ac.x * ab.y;
  if (area > -1e-6) return vec3(-1e9);
  float u = (ap.x * ac.y - ac.x * ap.y) / area;
  float v = (ab.x * ap.y - ap.x * ab.y) / area;
  return vec3(1.0 - u - v, u, v);
}

// The 2 x 2 quads round a point as triangles of their 3 x 3 vertices (3 y + x),
// split as world/terrain.js splits each quad (i, j): (i, j), (i, j + 1),
// (i + 1, j) and (i + 1, j), (i, j + 1), (i + 1, j + 1).
const int TERRAIN_BLOCK[24] = int[24](0, 3, 1, 1, 3, 4, 1, 4, 2, 2, 4, 5, 3, 6, 4, 4, 6, 7, 4, 7, 5, 5, 7, 8);

// The mesh's height at ao for a camera at `camera` (both in the cove's
// frame), as the GPU draws it there: the twin of lod.js createMeshHeight,
// step for step.
float terrainMeshHeight(vec2 ao, vec2 camera) {
  // The node over ao, as lod.js picks it with everything in view: down from
  // the root while a node splits, into the child holding ao; a child out of
  // its range is drawn as a quarter of its parent.
  int level = LOD_LEVELS - 1;
  float size = uLodTree.z * exp2(float(level));
  vec2 corner = uLodTree.xy;
  float quads = uLodTree.w;
  for (int i = 0; i < LOD_LEVELS - 1; i++) {
    float range = uLodRange[level - 1];
    if (terrainNodeDistance2(camera, corner, size) > range * range) break;
    float child = 0.5 * size;
    corner += clamp(floor((ao - corner) / child), 0.0, 1.0) * child;
    if (terrainNodeDistance2(camera, corner, child) > range * range) {
      quads *= 0.5;
      break;
    }
    size = child;
    level--;
    if (level == 0) break;
  }
  float spacing = size / uLodTree.w;

  // The 2 x 2 quads between even grid lines round ao: the morph moves odd
  // vertices toward the even ones before them but never across an even line,
  // so ao lies in one of these quads' eight triangles. Each vertex morphs by
  // its own distance.
  vec2 block = 2.0 * clamp(floor((ao - corner) / (2.0 * spacing)), 0.0, 0.5 * quads - 1.0);
  vec3 morph[9];
  for (int n = 0; n < 9; n++) morph[n] = terrainMorph(corner, block + vec2(float(n % 3), float(n / 3)), spacing, level, camera);

  // The triangle ao is most inside; where front faces overlap a little, by
  // turned-over slivers, either one may be drawn.
  float best = -1e9;
  int t = 0;
  vec3 weights = vec3(0.0);
  for (int s = 0; s < 24; s += 3) {
    vec3 b = terrainBarycentric(ao, morph[TERRAIN_BLOCK[s]].xy, morph[TERRAIN_BLOCK[s + 1]].xy, morph[TERRAIN_BLOCK[s + 2]].xy);
    float least = min(b.x, min(b.y, b.z));
    if (least > best) {
      best = least;
      t = s;
      weights = b;
    }
  }
  // Linear across it, as the rasterizer interpolates.
  return weights.x * terrainMorphHeight(morph[TERRAIN_BLOCK[t]], level) + weights.y * terrainMorphHeight(morph[TERRAIN_BLOCK[t + 1]], level) + weights.z * terrainMorphHeight(morph[TERRAIN_BLOCK[t + 2]], level);
}
