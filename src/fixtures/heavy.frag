// Tool fixture: VARIANT makes each material its own shader program. See heavy.js.

void main() {
  gl_FragColor = vec4(vec3(float(VARIANT) / 70.0), 1.0);
  #include <colorspace_fragment>
}
