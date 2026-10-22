// TEMPORARY: placeholder water. Delete together with placeholder.js.

// Centroid: the far rim lies a fraction of a pixel below the plane's horizon,
// where a pixel centre outside the triangle would extrapolate the position to
// nonsense (a dark line along the horizon).
centroid varying vec3 vWorldPos;

#include "chunks/planet.glsl"

void main() {
  vec4 world = modelMatrix * vec4(position, 1.0);
  world.y -= planetDrop(world.xz);
  vWorldPos = world.xyz;
  gl_Position = projectionMatrix * viewMatrix * world;
}
