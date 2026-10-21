// TEMPORARY: placeholder mound. Delete together with placeholder.js.

varying vec3 vWorldPos;
varying vec3 vNormal;

void main() {
  vec4 world = modelMatrix * vec4(position, 1.0);
  vWorldPos = world.xyz;
  vNormal = mat3(modelMatrix) * normal;
  gl_Position = projectionMatrix * viewMatrix * world;
}
