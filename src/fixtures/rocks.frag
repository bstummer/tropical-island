// Tool fixture (rocks.js): where world/rocks.vert put this pixel of a rock, in
// the world; 2 in alpha marks a rock's pixel.

centroid varying vec3 vWorldPos;

void main() {
  gl_FragColor = vec4(vWorldPos, 2.0);
}
