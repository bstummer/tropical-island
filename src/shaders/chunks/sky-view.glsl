// The sky-view table's mapping (sky/atmosphere.js renders the table): the sky
// seen from one height, for one sun, down to the horizon. x runs from towards
// the sun's azimuth (0) to away from it (1), y from the zenith (0) to the
// horizon (1). Both crowd texels where the sky changes fastest: around the sun
// and at the horizon. Below the horizon the sky reads as the horizon: the sea
// and the land cover it, and where a mesh's outline dips a hair below the true
// horizon, the horizon's colour fills the gap seamlessly. h is the height in km,
// mu the cosine of the view's angle to the zenith, cosAzimuth that of the
// azimuth between view and sun.

#ifndef PI
#define PI 3.14159265358979
#endif

#include "angles.glsl"

uniform float uGroundRadius; // km

// How far the horizon dips below level from height h, in radians.
float horizonDip(float h) {
  float rho = sqrt(max(h * (2.0 * uGroundRadius + h), 0.0)); // distance to the horizon
  return asinPrecise(clamp(rho / (uGroundRadius + h), 0.0, 1.0));
}

// Angles are measured from the horizon up, with asin precise for the small
// angles there: the rows crowd at the horizon, and the GPU's own acos and asin
// put lookups a quarter of a row off.
vec2 skyViewUv(float h, float mu, float cosAzimuth, vec2 size) {
  float dip = horizonDip(h);
  float span = 0.5 * PI + dip; // zenith to horizon
  float above = asinPrecise(clamp(mu, -1.0, 1.0)) + dip; // the view's angle above the horizon
  float v = 1.0 - sqrt(clamp(above / span, 0.0, 1.0));
  float u = sqrt(clamp(0.5 - 0.5 * cosAzimuth, 0.0, 1.0));
  return (vec2(u, v) * (size - 1.0) + 0.5) / size;
}

void skyViewParams(vec2 uv, float h, vec2 size, out float mu, out float cosAzimuth) {
  vec2 x = (uv * size - 0.5) / (size - 1.0);
  float dip = horizonDip(h);
  float c = 1.0 - x.y;
  // The last row looks a hair above the horizon: a ray exactly tangent to the
  // planet counts as hitting it, and the dark ground would show at the horizon.
  float above = max((0.5 * PI + dip) * c * c, 1e-4);
  mu = sin(above - dip);
  cosAzimuth = 1.0 - 2.0 * x.x * x.x;
}
