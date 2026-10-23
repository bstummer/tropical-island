// The terrain's level-of-detail mesh (world/lod.js): each instance is a node,
// a grid of quads `spacing` metres apart from its corner, its vertices
// morphed for the camera (chunks/terrain-mesh.glsl). Ranges are measured
// across the ground, as lod.js picks the nodes.

#include "chunks/terrain-mesh.glsl"
#include "chunks/planet.glsl"

attribute vec4 aNode; // the node's corner a, o; its spacing; its level

centroid varying vec3 vWorldPos;
// The same at the pixel's centre, for derivatives: a centroid varying's are
// off wherever a triangle's edge crosses the pixels they are taken over.
varying vec3 vCentre;

void main() {
  int level = int(aNode.w);
  vec3 morph = terrainMorph(aNode.xy, position.xz, aNode.z, level, terrainCove(cameraPosition.xz));
  vec3 world = vec3(0.0, terrainMorphHeight(morph, level), 0.0);
  world.xz = terrainWorld(morph.xy);
  // The ground bends down with the planet as the sea does, so the shoreline
  // stays where it is at any distance.
  world.y -= planetDrop(world.xz);
  vWorldPos = world;
  vCentre = world;
  gl_Position = projectionMatrix * viewMatrix * vec4(world, 1.0);
}
