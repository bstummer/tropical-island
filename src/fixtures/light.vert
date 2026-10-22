// Fixture: see light.js.

centroid varying vec3 vWorldPos; // see world/placeholder-water.vert
varying vec3 vNormal;

#include "chunks/planet.glsl"

void main() {
  vec4 world = modelMatrix * vec4(position, 1.0);
  world.y -= planetDrop(world.xz); // with the planet, as the sea
  vWorldPos = world.xyz;
  vNormal = mat3(modelMatrix) * normal;
  gl_Position = projectionMatrix * viewMatrix * world;
}
