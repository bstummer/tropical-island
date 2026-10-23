// The rock's detail (textures/rock.js), its second pass: the first pass's
// heights turned into a normal by differences across a texel. rg: the
// normal's x and y (tangent space, z up), b: the albedo's factor, halved; a:
// how much of it is the second mineral.

uniform sampler2D uHeights; // the first pass (rock-tile.frag), repeating
uniform float uTile; // m
uniform float uTexels; // across the tile

varying vec2 vUv;

void main() {
  float e = 1.0 / uTexels;
  vec4 here = texture2D(uHeights, vUv);
  float dx = texture2D(uHeights, vUv + vec2(e, 0.0)).r - texture2D(uHeights, vUv - vec2(e, 0.0)).r;
  float dy = texture2D(uHeights, vUv + vec2(0.0, e)).r - texture2D(uHeights, vUv - vec2(0.0, e)).r;
  vec2 slope = vec2(dx, dy) / (2.0 * uTile * e);
  vec3 n = normalize(vec3(-slope, 1.0));
  gl_FragColor = vec4(n.xy * 0.5 + 0.5, clamp(here.g * 0.5, 0.0, 1.0), here.b);
}
