// The sky (sky.js): one triangle over the whole view on the far plane, which
// the frame draws after every other opaque object, so only where nothing else
// drew. Passes the view ray through each corner on, in world space.

varying vec3 vDirection;

void main() {
  vec3 view = vec3(position.x / projectionMatrix[0][0], position.y / projectionMatrix[1][1], -1.0);
  vDirection = (vec4(view, 0.0) * viewMatrix).xyz; // the camera's rotation, inverted
#ifdef USE_REVERSED_DEPTH_BUFFER
  gl_Position = vec4(position.xy, 0.0, 1.0);
#else
  gl_Position = vec4(position.xy, 1.0, 1.0);
#endif
}
