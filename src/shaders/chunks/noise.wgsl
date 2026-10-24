// Shared 2D gradient noise: smooth (quintic fade), returns roughly [-1, 1].
// The hash avoids sin() so results match across GPUs and drivers.

fn noiseHash22(p: vec2f) -> vec2f {
  var p3 = fract(p.xyx * vec3f(0.1031, 0.1030, 0.0973));
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.xx + p3.yz) * p3.zy) * 2.0 - 1.0;
}

fn gradientNoise(p: vec2f) -> f32 {
  let i = floor(p);
  let f = fract(p);
  let u = f * f * f * (f * (f * 6.0 - 15.0) + 10.0);
  let a = dot(noiseHash22(i), f);
  let b = dot(noiseHash22(i + vec2f(1.0, 0.0)), f - vec2f(1.0, 0.0));
  let c = dot(noiseHash22(i + vec2f(0.0, 1.0)), f - vec2f(0.0, 1.0));
  let d = dot(noiseHash22(i + vec2f(1.0, 1.0)), f - vec2f(1.0, 1.0));
  return 1.4 * mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
}

// The same noise with its slope: (value, d/dx, d/dy), for the price of one
// call (the derivative after Quilez).
fn gradientNoiseD(p: vec2f) -> vec3f {
  let i = floor(p);
  let f = fract(p);
  let u = f * f * f * (f * (f * 6.0 - 15.0) + 10.0);
  let du = 30.0 * f * f * (f * (f - 2.0) + 1.0);
  let ga = noiseHash22(i);
  let gb = noiseHash22(i + vec2f(1.0, 0.0));
  let gc = noiseHash22(i + vec2f(0.0, 1.0));
  let gd = noiseHash22(i + vec2f(1.0, 1.0));
  let a = dot(ga, f);
  let b = dot(gb, f - vec2f(1.0, 0.0));
  let c = dot(gc, f - vec2f(0.0, 1.0));
  let d = dot(gd, f - vec2f(1.0, 1.0));
  let value = a + u.x * (b - a) + u.y * (c - a) + u.x * u.y * (a - b - c + d);
  let slope = ga + u.x * (gb - ga) + u.y * (gc - ga) + u.x * u.y * (ga - gb - gc + gd) + du * (u.yx * (a - b - c + d) + vec2f(b, c) - a);
  return 1.4 * vec3f(value, slope);
}

// murmur3's 32-bit finaliser (world/noise.js fmix).
fn noiseMix(hIn: u32) -> u32 {
  var h = hIn;
  h ^= h >> 16u;
  h *= 0x85ebca6bu;
  h ^= h >> 13u;
  h *= 0xc2b2ae35u;
  return h ^ (h >> 16u);
}

// A lattice point's gradient in [-1, 1]^2: the bits of a hash of its cell and
// a seed, the same in JS (world/noise.js cellBits) and on every GPU.
fn seededGradient(cell: vec2i, seed: u32) -> vec2f {
  let h = noiseMix(noiseMix(noiseMix(seed) ^ u32(cell.x)) ^ u32(cell.y));
  return vec2f(f32(h & 65535u), f32(h >> 16u)) / 32767.5 - 1.0;
}

// Gradient noise with its slope, as gradientNoiseD, from seededGradient's
// lattice: for what JS has to know too (world/noise.js seededNoise is its
// value's twin). seed: a whole number.
fn seededNoiseD(p: vec2f, seed: u32) -> vec3f {
  let i = floor(p);
  let f = p - i;
  let c = vec2i(i);
  let u = f * f * f * (f * (f * 6.0 - 15.0) + 10.0);
  let du = 30.0 * f * f * (f * (f - 2.0) + 1.0);
  let ga = seededGradient(c, seed);
  let gb = seededGradient(c + vec2i(1, 0), seed);
  let gc = seededGradient(c + vec2i(0, 1), seed);
  let gd = seededGradient(c + vec2i(1, 1), seed);
  let a = dot(ga, f);
  let b = dot(gb, f - vec2f(1.0, 0.0));
  let cc = dot(gc, f - vec2f(0.0, 1.0));
  let d = dot(gd, f - vec2f(1.0, 1.0));
  let value = a + u.x * (b - a) + u.y * (cc - a) + u.x * u.y * (a - b - cc + d);
  let slope = ga + u.x * (gb - ga) + u.y * (gc - ga) + u.x * u.y * (ga - gb - gc + gd) + du * (u.yx * (a - b - cc + d) + vec2f(b, cc) - a);
  return 1.4 * vec3f(value, slope);
}

fn noiseHash33(pIn: vec3f) -> vec3f {
  var p = fract(pIn * vec3f(0.1031, 0.1030, 0.0973));
  p += dot(p, p.yxz + 33.33);
  return fract((p.xxy + p.yxx) * p.zyx) * 2.0 - 1.0;
}

// 3D gradient noise, roughly [-1, 1]: gradientNoise3D's value, for less.
fn gradientNoise3(p: vec3f) -> f32 {
  let i = floor(p);
  let f = fract(p);
  let u = f * f * f * (f * (f * 6.0 - 15.0) + 10.0);
  let a = dot(noiseHash33(i), f);
  let b = dot(noiseHash33(i + vec3f(1.0, 0.0, 0.0)), f - vec3f(1.0, 0.0, 0.0));
  let c = dot(noiseHash33(i + vec3f(0.0, 1.0, 0.0)), f - vec3f(0.0, 1.0, 0.0));
  let d = dot(noiseHash33(i + vec3f(1.0, 1.0, 0.0)), f - vec3f(1.0, 1.0, 0.0));
  let e = dot(noiseHash33(i + vec3f(0.0, 0.0, 1.0)), f - vec3f(0.0, 0.0, 1.0));
  let g = dot(noiseHash33(i + vec3f(1.0, 0.0, 1.0)), f - vec3f(1.0, 0.0, 1.0));
  let h = dot(noiseHash33(i + vec3f(0.0, 1.0, 1.0)), f - vec3f(0.0, 1.0, 1.0));
  let k = dot(noiseHash33(i + vec3f(1.0, 1.0, 1.0)), f - vec3f(1.0, 1.0, 1.0));
  return 1.2 * mix(mix(mix(a, b, u.x), mix(c, d, u.x), u.y), mix(mix(e, g, u.x), mix(h, k, u.x), u.y), u.z);
}

// 3D gradient noise with its gradient: (value, d/dx, d/dy, d/dz), roughly
// [-1, 1] (Quilez's, with the quintic fade).
fn gradientNoise3D(p: vec3f) -> vec4f {
  let i = floor(p);
  let f = fract(p);
  let u = f * f * f * (f * (f * 6.0 - 15.0) + 10.0);
  let du = 30.0 * f * f * (f * (f - 2.0) + 1.0);
  let ga = noiseHash33(i);
  let gb = noiseHash33(i + vec3f(1.0, 0.0, 0.0));
  let gc = noiseHash33(i + vec3f(0.0, 1.0, 0.0));
  let gd = noiseHash33(i + vec3f(1.0, 1.0, 0.0));
  let ge = noiseHash33(i + vec3f(0.0, 0.0, 1.0));
  let gf = noiseHash33(i + vec3f(1.0, 0.0, 1.0));
  let gg = noiseHash33(i + vec3f(0.0, 1.0, 1.0));
  let gh = noiseHash33(i + vec3f(1.0, 1.0, 1.0));
  let va = dot(ga, f);
  let vb = dot(gb, f - vec3f(1.0, 0.0, 0.0));
  let vc = dot(gc, f - vec3f(0.0, 1.0, 0.0));
  let vd = dot(gd, f - vec3f(1.0, 1.0, 0.0));
  let ve = dot(ge, f - vec3f(0.0, 0.0, 1.0));
  let vf = dot(gf, f - vec3f(1.0, 0.0, 1.0));
  let vg = dot(gg, f - vec3f(0.0, 1.0, 1.0));
  let vh = dot(gh, f - vec3f(1.0, 1.0, 1.0));
  let value = va + u.x * (vb - va) + u.y * (vc - va) + u.z * (ve - va) + u.x * u.y * (va - vb - vc + vd) + u.y * u.z * (va - vc - ve + vg) + u.z * u.x * (va - vb - ve + vf) + u.x * u.y * u.z * (-va + vb + vc - vd + ve - vf - vg + vh);
  let slope = ga + u.x * (gb - ga) + u.y * (gc - ga) + u.z * (ge - ga) + u.x * u.y * (ga - gb - gc + gd) + u.y * u.z * (ga - gc - ge + gg) + u.z * u.x * (ga - gb - ge + gf) + u.x * u.y * u.z * (-ga + gb + gc - gd + ge - gf - gg + gh)
    + du * (vec3f(vb - va, vc - va, ve - va) + u.yzx * vec3f(va - vb - vc + vd, va - vc - ve + vg, va - vb - ve + vf) + u.zxy * vec3f(va - vb - ve + vf, va - vb - vc + vd, va - vc - ve + vg) + u.yzx * u.zxy * (-va + vb + vc - vd + ve - vf - vg + vh));
  return 1.2 * vec4f(value, slope);
}
