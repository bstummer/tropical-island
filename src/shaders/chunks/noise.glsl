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
