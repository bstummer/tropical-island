// Noise that repeats, for textures that tile (textures/*.wgsl). Positions are
// in cells of a grid that repeats every `period` cells, a whole number, so
// the texture's edges meet. Seeds keep layers apart.

#include "/chunks/noise.wgsl"

// A cell's hash, in [-1, 1]: the same for every repeat of the cell.
fn tileHash(cell: vec2f, period: f32, seed: vec2f) -> vec2f {
  return noiseHash22(cell - period * floor(cell / period) + seed); // GLSL's mod(cell, period)
}

// Gradient noise, roughly [-1, 1], repeating every `period` cells.
fn tileNoise(p: vec2f, period: f32, seed: vec2f) -> f32 {
  let i = floor(p);
  let f = fract(p);
  let u = f * f * f * (f * (f * 6.0 - 15.0) + 10.0);
  let a = dot(tileHash(i, period, seed), f);
  let b = dot(tileHash(i + vec2f(1.0, 0.0), period, seed), f - vec2f(1.0, 0.0));
  let c = dot(tileHash(i + vec2f(0.0, 1.0), period, seed), f - vec2f(0.0, 1.0));
  let d = dot(tileHash(i + vec2f(1.0, 1.0), period, seed), f - vec2f(1.0, 1.0));
  return 1.4 * mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
}

// Octaves of it, each at twice the frequency and half the strength; the
// period doubles with them, so the sum still repeats.
fn tileFbm(pIn: vec2f, periodIn: f32, seed: vec2f, octaves: i32) -> f32 {
  var p = pIn;
  var period = periodIn;
  var sum = 0.0;
  var weight = 0.5;
  for (var k = 0; k < 8; k++) {
    if (k >= octaves) {
      break;
    }
    sum += weight * tileNoise(p, period, seed + f32(k) * 17.3);
    p *= 2.0;
    period *= 2.0;
    weight *= 0.5;
  }
  return sum;
}

// Ridged octaves: sharp creases where the noise crosses zero, the way broken
// and weathered rock is. Roughly [0, 1].
fn tileRidged(pIn: vec2f, periodIn: f32, seed: vec2f, octaves: i32) -> f32 {
  var p = pIn;
  var period = periodIn;
  var sum = 0.0;
  var weight = 0.5;
  for (var k = 0; k < 8; k++) {
    if (k >= octaves) {
      break;
    }
    let r = 1.0 - abs(tileNoise(p, period, seed + f32(k) * 23.9));
    sum += weight * r * r;
    p *= 2.0;
    period *= 2.0;
    weight *= 0.5;
  }
  return sum;
}
