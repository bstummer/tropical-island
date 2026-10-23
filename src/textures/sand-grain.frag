// The sand's grain (textures/sand.js): a tile uTile millimetres across. Fine
// speckle under grit of a millimetre or so, mostly pale shell, some pink
// coral, tan and dark volcanic grains, and here and there a fragment of shell
// a few millimetres long. rgb: the albedo's factor, halved; a: height.

#include "tileable.glsl"

uniform float uTile; // mm
uniform vec2 uSeed;
uniform vec2 uShift; // tiles: shifted by whole ones, the texture is the same (fixtures/surfaces.js checks)

varying vec2 vUv;

// A grid of cells about `size` mm that repeats over the tile: its cell count.
float cellsAcross(float size) {
  return floor(uTile / size + 0.5);
}

// The colour factors grains take: pale shell, pink coral, tan, dark volcanic.
vec3 grainTint(float pick) {
  if (pick < 0.5) return vec3(1.16, 1.14, 1.1);
  if (pick < 0.68) return vec3(1.12, 0.95, 0.92);
  if (pick < 0.9) return vec3(0.86, 0.78, 0.64);
  return vec3(0.34, 0.33, 0.33);
}

void main() {
  vec2 uv = vUv + uShift;
  vec3 factor = vec3(1.0);
  float height = 0.3;

  // Speckle: every cell of 0.6 mm a little lighter or darker, a little pinker or creamier.
  float n1 = cellsAcross(0.6);
  vec2 s = tileHash(floor(uv * n1), n1, uSeed);
  factor *= 1.0 + 0.07 * s.x;
  factor *= vec3(1.0 + 0.02 * s.y, 1.0, 1.0 - 0.03 * s.y);
  height += 0.08 * s.x;

  // Grit: in four cells of ten, a grain about a millimetre across.
  float n2 = cellsAcross(3.2);
  vec2 p = uv * n2;
  vec2 cell = floor(p);
  for (int j = -1; j <= 1; j++) {
    for (int i = -1; i <= 1; i++) {
      vec2 c = cell + vec2(i, j);
      vec2 h = tileHash(c, n2, uSeed + 3.1) * 0.5 + 0.5;
      if (h.x > 0.42) continue;
      vec2 at = c + 0.15 + 0.7 * (tileHash(c, n2, uSeed + 7.7) * 0.5 + 0.5);
      float radius = (0.45 + 0.4 * h.y) * n2 / uTile; // mm into cells
      float d = length(p - at) / radius;
      if (d >= 1.0) continue;
      float inside = 1.0 - smoothstep(0.7, 1.0, d);
      factor = mix(factor, grainTint(fract(h.x * 7.13 + h.y * 3.7)), inside);
      height = max(height, 0.5 + 0.3 * sqrt(1.0 - d * d));
    }
  }

  // Shell fragments: in one cell of eight, an angular flake of 2 to 5 mm, with a darker rim.
  float n3 = cellsAcross(14.0);
  p = uv * n3;
  cell = floor(p);
  for (int j = -1; j <= 1; j++) {
    for (int i = -1; i <= 1; i++) {
      vec2 c = cell + vec2(i, j);
      vec2 h = tileHash(c, n3, uSeed + 11.9) * 0.5 + 0.5;
      if (h.x > 0.12) continue;
      vec2 at = c + 0.2 + 0.6 * (tileHash(c, n3, uSeed + 5.3) * 0.5 + 0.5);
      vec2 off = (p - at) * uTile / n3; // mm
      float angle = atan(off.y, off.x);
      // Five-ish corners, from a noise read round the flake.
      float edge = (1.0 + 2.0 * h.y) * (0.75 + 0.25 * abs(sin(2.5 * angle + 9.0 * h.y)));
      float d = length(off) / edge;
      if (d >= 1.0) continue;
      vec3 shell = h.y > 0.6 ? vec3(1.18, 1.05, 1.02) : vec3(1.22, 1.2, 1.15);
      float rim = smoothstep(0.75, 0.95, d);
      factor = mix(factor, shell * (1.0 - 0.25 * rim), 1.0 - smoothstep(0.92, 1.0, d));
      height = max(height, 0.75);
    }
  }

  gl_FragColor = vec4(clamp(factor * 0.5, 0.0, 1.0), clamp(height, 0.0, 1.0));
}
