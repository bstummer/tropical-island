// TEMPORARY: placeholder sky dome. Delete together with placeholder.js.

varying vec3 vDir;

void main() {
  vDir = position; // the dome is centred on the camera, so position is the view direction
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
