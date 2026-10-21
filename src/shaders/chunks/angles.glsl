// asin, precise for small arguments. GPUs approximate asin to about 1e-5 in
// absolute terms, a large error next to the tiny angles that the sky's tables
// resolve at the horizon; the series is exact there.
float asinPrecise(float x) {
  if (abs(x) > 0.1) return asin(x);
  float x2 = x * x;
  return x * (1.0 + x2 * (1.0 / 6.0 + x2 * (3.0 / 40.0)));
}
