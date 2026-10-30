// What the sea's surface mirrors, as a far pixel holds many waves and a near one
// few: after Bruneton, Neyret and Holzschuch (2010), a wave too small for the
// pixel (water/spectrum.js unresolvedSlopes) doesn't vanish but widens what the
// surface mirrors, by the variance of its slopes. So the sun is glints up close,
// a smooth band of light far off, with the same light on average, and the far
// sea mirrors less sky at a grazing angle than a smooth one would.

#include "/chunks/pi.wgsl"

// The share of the light a surface with this variance of its slopes (per axis)
// mirrors on average at cosine c.
fn seaMirrored(c: f32, variance: f32) -> f32 {
  let sigma = sqrt(variance);
  return 0.02 + 0.98 * pow(1.0 - clamp(c, 0.0, 1.0), 5.0 * exp(-2.69 * sigma)) / (1.0 + 22.7 * sigma * sqrt(sigma));
}

// Smith's shadowing of such a surface at cosine c.
fn seaShadowing(c: f32, variance: f32) -> f32 {
  let cosine = clamp(c, 0.01, 0.9999);
  let v = cosine / sqrt((1.0 - cosine * cosine) * 2.0 * variance);
  // As Walter et al. (2007) fit it.
  return select(0.0, (1.0 - 1.259 * v + 0.396 * v * v) / (3.535 * v + 2.181 * v * v), v < 1.6);
}

// The share of the sun's light sent towards the eye (view) by a surface with this
// mean normal and variance of its slopes: in the half vector's slope, Gaussian
// with a tenth of it in a Gaussian much wider, as real seas' slopes have heavier
// tails than a Gaussian's: what gives a path of sun its soft shoulders.
fn seaGlitter(n: vec3f, view: vec3f, sun: vec3f, variance: f32) -> f32 {
  let h = normalize(sun + view);
  let hn = max(dot(h, n), 0.01);
  let slope2 = max(1.0 / (hn * hn) - 1.0, 0.0);
  let wide = 6.0 * variance;
  let peak = 0.9 * exp(-0.5 * slope2 / variance) / (2.0 * PI * variance) + 0.1 * exp(-0.5 * slope2 / wide) / (2.0 * PI * wide);
  let vn = max(dot(view, n), 0.01);
  let ln = max(dot(sun, n), 0.01);
  let fresnel = 0.02 + 0.98 * pow(1.0 - clamp(dot(view, h), 0.0, 1.0), 5.0);
  return fresnel * peak / ((1.0 + seaShadowing(ln, variance) + seaShadowing(vn, variance)) * 4.0 * vn * hn * hn * hn * hn);
}
