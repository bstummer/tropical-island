// Spherical harmonics up to l = 2, for the sky's light: the basis, which
// sky/light.js mirrors (the screenshot tool checks the two agree, with
// fixtures/maths.js), and the irradiance the nine coefficients in uSkySH give.

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

uniform vec3 uSkySH[9]; // radiance as nine coefficients: the sky's (lighting.glsl)

// Irradiance on a surface facing n, from the radiance in uSkySH: each band kept
// as much as a cosine lobe keeps it (Ramamoorthi and Hanrahan 2001). Every lit
// pixel runs this, so it is shBasis() written out, band factors included, and
// it reads the uniform in place: a loop over shBasis(), and the copy of an array
// passed in, cost a fifth of a SwiftShader frame.
vec3 shIrradiance(vec3 n) {
  const float PI_ = 3.14159265;
  vec3 e = PI_ * 0.282095 * uSkySH[0]
         + 2.0 * PI_ / 3.0 * 0.488603 * (uSkySH[1] * n.y + uSkySH[2] * n.z + uSkySH[3] * n.x)
         + PI_ / 4.0 * (1.092548 * (uSkySH[4] * n.x * n.y + uSkySH[5] * n.y * n.z + uSkySH[7] * n.x * n.z)
                      + 0.315392 * uSkySH[6] * (3.0 * n.z * n.z - 1.0)
                      + 0.546274 * uSkySH[8] * (n.x * n.x - n.y * n.y));
  return max(e, vec3(0.0));
}
