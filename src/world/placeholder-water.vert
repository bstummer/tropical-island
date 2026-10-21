// TEMPORARY: placeholder water. Delete together with placeholder.js.

// Centroid: the far rim lies a fraction of a pixel below the plane's horizon,
// where a pixel centre outside the triangle would extrapolate the position to
// nonsense (a dark line along the horizon).
centroid varying vec3 vWorldPos;

uniform float uGroundRadius; // km

void main() {
  vec4 world = modelMatrix * vec4(position, 1.0);
  // The sea bends down with the planet, so it ends where the sky's horizon is
  // and the haze before it matches the sky's.
  vec2 away = world.xz - cameraPosition.xz;
  world.y -= dot(away, away) / (2000.0 * uGroundRadius);
  vWorldPos = world.xyz;
  gl_Position = projectionMatrix * viewMatrix * world;
}
