// Fixture: see light.js.

centroid varying vec3 vWorldPos; // see world/placeholder-water.vert
varying vec3 vNormal;

uniform float uGroundRadius; // km

void main() {
  vec4 world = modelMatrix * vec4(position, 1.0);
  vec2 away = world.xz - cameraPosition.xz;
  world.y -= dot(away, away) / (2000.0 * uGroundRadius); // with the planet, as the sea
  vWorldPos = world.xyz;
  vNormal = mat3(modelMatrix) * normal;
  gl_Position = projectionMatrix * viewMatrix * world;
}
