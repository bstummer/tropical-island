// Noise that repeats, for textures that tile (textures/*.frag). Positions are
// in cells of a grid that repeats every `period` cells, a whole number, so
// the texture's edges meet. Seeds keep layers apart.

#include "/chunks/noise.glsl"

// A cell's hash, in [-1, 1]: the same for every repeat of the cell.
vec2 tileHash(vec2 cell, float period, vec2 seed) {
  return noiseHash22(mod(cell, period) + seed);
}

// Gradient noise, roughly [-1, 1], repeating every `period` cells.
float tileNoise(vec2 p, float period, vec2 seed) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * f * (f * (f * 6.0 - 15.0) + 10.0);
  float a = dot(tileHash(i, period, seed), f);
  float b = dot(tileHash(i + vec2(1.0, 0.0), period, seed), f - vec2(1.0, 0.0));
  float c = dot(tileHash(i + vec2(0.0, 1.0), period, seed), f - vec2(0.0, 1.0));
  float d = dot(tileHash(i + vec2(1.0, 1.0), period, seed), f - vec2(1.0, 1.0));
  return 1.4 * mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
}

// Octaves of it, each at twice the frequency and half the strength; the
// period doubles with them, so the sum still repeats.
float tileFbm(vec2 p, float period, vec2 seed, int octaves) {
  float sum = 0.0;
  float weight = 0.5;
  for (int k = 0; k < 8; k++) {
    if (k >= octaves) break;
    sum += weight * tileNoise(p, period, seed + float(k) * 17.3);
    p *= 2.0;
    period *= 2.0;
    weight *= 0.5;
  }
  return sum;
}

// Ridged octaves: sharp creases where the noise crosses zero, the way broken
// and weathered rock is. Roughly [0, 1].
float tileRidged(vec2 p, float period, vec2 seed, int octaves) {
  float sum = 0.0;
  float weight = 0.5;
  for (int k = 0; k < 8; k++) {
    if (k >= octaves) break;
    float r = 1.0 - abs(tileNoise(p, period, seed + float(k) * 23.9));
    sum += weight * r * r;
    p *= 2.0;
    period *= 2.0;
    weight *= 0.5;
  }
  return sum;
}
