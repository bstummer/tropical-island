// Shared 2D gradient noise: smooth (quintic fade), returns roughly [-1, 1].
// The hash avoids sin() so results match across GPUs and drivers.

vec2 noiseHash22(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * vec3(0.1031, 0.1030, 0.0973));
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.xx + p3.yz) * p3.zy) * 2.0 - 1.0;
}

float gradientNoise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * f * (f * (f * 6.0 - 15.0) + 10.0);
  float a = dot(noiseHash22(i), f);
  float b = dot(noiseHash22(i + vec2(1.0, 0.0)), f - vec2(1.0, 0.0));
  float c = dot(noiseHash22(i + vec2(0.0, 1.0)), f - vec2(0.0, 1.0));
  float d = dot(noiseHash22(i + vec2(1.0, 1.0)), f - vec2(1.0, 1.0));
  return 1.4 * mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
}

// The same noise with its slope: (value, d/dx, d/dy), for the price of one
// call (the derivative after Quilez).
vec3 gradientNoiseD(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * f * (f * (f * 6.0 - 15.0) + 10.0);
  vec2 du = 30.0 * f * f * (f * (f - 2.0) + 1.0);
  vec2 ga = noiseHash22(i);
  vec2 gb = noiseHash22(i + vec2(1.0, 0.0));
  vec2 gc = noiseHash22(i + vec2(0.0, 1.0));
  vec2 gd = noiseHash22(i + vec2(1.0, 1.0));
  float a = dot(ga, f);
  float b = dot(gb, f - vec2(1.0, 0.0));
  float c = dot(gc, f - vec2(0.0, 1.0));
  float d = dot(gd, f - vec2(1.0, 1.0));
  float value = a + u.x * (b - a) + u.y * (c - a) + u.x * u.y * (a - b - c + d);
  vec2 slope = ga + u.x * (gb - ga) + u.y * (gc - ga) + u.x * u.y * (ga - gb - gc + gd) + du * (u.yx * (a - b - c + d) + vec2(b, c) - a);
  return 1.4 * vec3(value, slope);
}

// murmur3's 32-bit finaliser (world/noise.js fmix).
uint noiseMix(uint h) {
  h ^= h >> 16u;
  h *= 0x85ebca6bu;
  h ^= h >> 13u;
  h *= 0xc2b2ae35u;
  return h ^ (h >> 16u);
}

// A lattice point's gradient in [-1, 1]^2: the bits of a hash of its cell and
// a seed, the same in JS (world/noise.js cellBits) and on every GPU.
vec2 seededGradient(ivec2 cell, uint seed) {
  uint h = noiseMix(noiseMix(noiseMix(seed) ^ uint(cell.x)) ^ uint(cell.y));
  return vec2(float(h & 65535u), float(h >> 16u)) / 32767.5 - 1.0;
}

// Gradient noise with its slope, as gradientNoiseD, from seededGradient's
// lattice: for what JS has to know too (world/noise.js seededNoise is its
// value's twin). seed: a whole number.
vec3 seededNoiseD(vec2 p, uint seed) {
  vec2 i = floor(p);
  vec2 f = p - i;
  ivec2 c = ivec2(i);
  vec2 u = f * f * f * (f * (f * 6.0 - 15.0) + 10.0);
  vec2 du = 30.0 * f * f * (f * (f - 2.0) + 1.0);
  vec2 ga = seededGradient(c, seed);
  vec2 gb = seededGradient(c + ivec2(1, 0), seed);
  vec2 gc = seededGradient(c + ivec2(0, 1), seed);
  vec2 gd = seededGradient(c + ivec2(1, 1), seed);
  float a = dot(ga, f);
  float b = dot(gb, f - vec2(1.0, 0.0));
  float cc = dot(gc, f - vec2(0.0, 1.0));
  float d = dot(gd, f - vec2(1.0, 1.0));
  float value = a + u.x * (b - a) + u.y * (cc - a) + u.x * u.y * (a - b - cc + d);
  vec2 slope = ga + u.x * (gb - ga) + u.y * (gc - ga) + u.x * u.y * (ga - gb - gc + gd) + du * (u.yx * (a - b - cc + d) + vec2(b, cc) - a);
  return 1.4 * vec3(value, slope);
}

vec3 noiseHash33(vec3 p) {
  p = fract(p * vec3(0.1031, 0.1030, 0.0973));
  p += dot(p, p.yxz + 33.33);
  return fract((p.xxy + p.yxx) * p.zyx) * 2.0 - 1.0;
}

// 3D gradient noise, roughly [-1, 1]: gradientNoise3D's value, for less.
float gradientNoise3(vec3 p) {
  vec3 i = floor(p);
  vec3 f = fract(p);
  vec3 u = f * f * f * (f * (f * 6.0 - 15.0) + 10.0);
  float a = dot(noiseHash33(i), f);
  float b = dot(noiseHash33(i + vec3(1.0, 0.0, 0.0)), f - vec3(1.0, 0.0, 0.0));
  float c = dot(noiseHash33(i + vec3(0.0, 1.0, 0.0)), f - vec3(0.0, 1.0, 0.0));
  float d = dot(noiseHash33(i + vec3(1.0, 1.0, 0.0)), f - vec3(1.0, 1.0, 0.0));
  float e = dot(noiseHash33(i + vec3(0.0, 0.0, 1.0)), f - vec3(0.0, 0.0, 1.0));
  float g = dot(noiseHash33(i + vec3(1.0, 0.0, 1.0)), f - vec3(1.0, 0.0, 1.0));
  float h = dot(noiseHash33(i + vec3(0.0, 1.0, 1.0)), f - vec3(0.0, 1.0, 1.0));
  float k = dot(noiseHash33(i + vec3(1.0, 1.0, 1.0)), f - vec3(1.0, 1.0, 1.0));
  return 1.2 * mix(mix(mix(a, b, u.x), mix(c, d, u.x), u.y), mix(mix(e, g, u.x), mix(h, k, u.x), u.y), u.z);
}

// 3D gradient noise with its gradient: (value, d/dx, d/dy, d/dz), roughly
// [-1, 1] (Quilez's, with the quintic fade).
vec4 gradientNoise3D(vec3 p) {
  vec3 i = floor(p);
  vec3 f = fract(p);
  vec3 u = f * f * f * (f * (f * 6.0 - 15.0) + 10.0);
  vec3 du = 30.0 * f * f * (f * (f - 2.0) + 1.0);
  vec3 ga = noiseHash33(i);
  vec3 gb = noiseHash33(i + vec3(1.0, 0.0, 0.0));
  vec3 gc = noiseHash33(i + vec3(0.0, 1.0, 0.0));
  vec3 gd = noiseHash33(i + vec3(1.0, 1.0, 0.0));
  vec3 ge = noiseHash33(i + vec3(0.0, 0.0, 1.0));
  vec3 gf = noiseHash33(i + vec3(1.0, 0.0, 1.0));
  vec3 gg = noiseHash33(i + vec3(0.0, 1.0, 1.0));
  vec3 gh = noiseHash33(i + vec3(1.0, 1.0, 1.0));
  float va = dot(ga, f);
  float vb = dot(gb, f - vec3(1.0, 0.0, 0.0));
  float vc = dot(gc, f - vec3(0.0, 1.0, 0.0));
  float vd = dot(gd, f - vec3(1.0, 1.0, 0.0));
  float ve = dot(ge, f - vec3(0.0, 0.0, 1.0));
  float vf = dot(gf, f - vec3(1.0, 0.0, 1.0));
  float vg = dot(gg, f - vec3(0.0, 1.0, 1.0));
  float vh = dot(gh, f - vec3(1.0, 1.0, 1.0));
  float value = va + u.x * (vb - va) + u.y * (vc - va) + u.z * (ve - va) + u.x * u.y * (va - vb - vc + vd) + u.y * u.z * (va - vc - ve + vg) + u.z * u.x * (va - vb - ve + vf) + u.x * u.y * u.z * (-va + vb + vc - vd + ve - vf - vg + vh);
  vec3 slope = ga + u.x * (gb - ga) + u.y * (gc - ga) + u.z * (ge - ga) + u.x * u.y * (ga - gb - gc + gd) + u.y * u.z * (ga - gc - ge + gg) + u.z * u.x * (ga - gb - ge + gf) + u.x * u.y * u.z * (-ga + gb + gc - gd + ge - gf - gg + gh)
    + du * (vec3(vb - va, vc - va, ve - va) + u.yzx * vec3(va - vb - vc + vd, va - vc - ve + vg, va - vb - ve + vf) + u.zxy * vec3(va - vb - ve + vf, va - vb - vc + vd, va - vc - ve + vg) + u.yzx * u.zxy * (-va + vb + vc - vd + ve - vf - vg + vh));
  return 1.2 * vec4(value, slope);
}
