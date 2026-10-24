// asin, precise for small arguments. GPUs approximate asin to about 1e-5 in
// absolute terms, a large error next to the tiny angles that the sky's tables
// resolve at the horizon; the series is exact there.
fn asinPrecise(x: f32) -> f32 {
  if (abs(x) > 0.1) {
    return asin(x);
  }
  let x2 = x * x;
  return x * (1.0 + x2 * (1.0f / 6.0f + x2 * (3.0f / 40.0f)));
}
