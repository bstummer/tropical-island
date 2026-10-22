// The terrain's level-of-detail mesh (world/lod.js): each instance is a node,
// a grid of quads `spacing` metres apart from its corner. Vertices morph onto
// the next coarser grid as they near the end of their level's range, taking
// its heights, so a node meets its coarser neighbour without a seam. Ranges
// are measured across the ground, as lod.js picks the nodes.

#include "chunks/terrain.glsl"
#include "chunks/planet.glsl"

attribute vec4 aNode; // the node's corner a, o; its spacing; its level

uniform vec2 uMorph[LOD_LEVELS]; // per level: the distances over which it morphs into the next

centroid varying vec3 vWorldPos;

int heightLevel(int level) {
  return min(level, TERRAIN_LEVELS - 1);
}

void main() {
  int level = int(aNode.w);
  vec2 grid = position.xz; // whole numbers of quads from the node's corner
  vec2 ao = aNode.xy + grid * aNode.z;
  vec2 camera = terrainCove(cameraPosition.xz);

  float k = clamp((length(ao - camera) - uMorph[level].x) / (uMorph[level].y - uMorph[level].x), 0.0, 1.0);

  // Odd vertices slide onto the coarser grid's lines. Most vertices aren't
  // morphing: they keep their level's height, or take the coarser grid's.
  float height;
  if (k == 0.0) {
    height = terrainHeight(ao, heightLevel(level));
  } else {
    grid -= fract(grid * 0.5) * 2.0 * k;
    ao = aNode.xy + grid * aNode.z;
    float coarse = terrainHeight(ao, heightLevel(level + 1));
    height = k < 1.0 ? mix(terrainHeight(ao, heightLevel(level)), coarse, k) : coarse;
  }

  vec3 world = vec3(0.0, height, 0.0);
  world.xz = terrainWorld(ao);
  // The ground bends down with the planet as the sea does, so the shoreline
  // stays where it is at any distance.
  world.y -= planetDrop(world.xz);
  vWorldPos = world;
  gl_Position = projectionMatrix * viewMatrix * vec4(world, 1.0);
}
