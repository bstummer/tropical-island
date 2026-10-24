// Tool fixture (rocks.js), appended to world/rocks.wgsl: where its vertex stage
// put this pixel of a rock, in the world; 2 in alpha marks a rock's pixel.

@fragment
fn positionFragment(in: Varyings) -> @location(0) vec4f {
  return vec4f(in.vWorldPos, 2.0);
}
