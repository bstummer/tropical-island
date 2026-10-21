// Spherical harmonics up to l = 2, for the sky's light: the basis, which
// sky/light.js mirrors (the screenshot tool checks the two agree, with
// fixtures/maths.js), and the irradiance nine coefficients give.

// The k-th real spherical harmonic at unit direction d.
float shBasis(int k, vec3 d) {
  if (k == 0) return 0.282095;
  if (k == 1) return 0.488603 * d.y;
  if (k == 2) return 0.488603 * d.z;
  if (k == 3) return 0.488603 * d.x;
  if (k == 4) return 1.092548 * d.x * d.y;
  if (k == 5) return 1.092548 * d.y * d.z;
  if (k == 6) return 0.315392 * (3.0 * d.z * d.z - 1.0);
  if (k == 7) return 1.092548 * d.x * d.z;
  return 0.546274 * (d.x * d.x - d.y * d.y);
}

// Irradiance on a surface facing n, from radiance given as nine coefficients:
// each band kept as much as a cosine lobe keeps it (Ramamoorthi and Hanrahan 2001).
vec3 shIrradiance(vec3 c[9], vec3 n) {
  const float BAND[9] = float[9](3.141593, 2.094395, 2.094395, 2.094395, 0.785398, 0.785398, 0.785398, 0.785398, 0.785398);
  vec3 e = vec3(0.0);
  for (int k = 0; k < 9; k++) e += BAND[k] * c[k] * shBasis(k, n);
  return max(e, vec3(0.0));
}
