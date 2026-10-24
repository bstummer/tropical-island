// The sky-view table's mapping (sky/atmosphere.js renders the table): the sky
// seen from one height, for one sun, down to the horizon. x runs from towards
// the sun's azimuth (0) to away from it (1), y from the zenith (0) to the
// horizon (1). Both crowd texels where the sky changes fastest: around the sun
// and at the horizon. Below the horizon the sky reads as the horizon: the sea
// and the land cover it, and where a mesh's outline dips a hair below the true
// horizon, the horizon's colour fills the gap seamlessly. h is the height in km,
// mu the cosine of the view's angle to the zenith, cosAzimuth that of the
// azimuth between view and sun. Needs `frame` (frame.wgsl or frame-values.wgsl).

#include "pi.wgsl"
#include "angles.wgsl"
#include "planet.wgsl"

// How far the horizon dips below level from height h, in radians.
fn horizonDip(h: f32) -> f32 {
  let rho = sqrt(max(h * (2.0 * frame.uGroundRadius + h), 0.0)); // distance to the horizon
  return asinPrecise(clamp(rho / (frame.uGroundRadius + h), 0.0, 1.0));
}

// Angles are measured from the horizon up, with asin precise for the small
// angles there: the rows crowd at the horizon, and the GPU's own acos and asin
// put lookups a quarter of a row off.
fn skyViewUv(h: f32, mu: f32, cosAzimuth: f32, size: vec2f) -> vec2f {
  let dip = horizonDip(h);
  let span = 0.5 * PI + dip; // zenith to horizon
  let above = asinPrecise(clamp(mu, -1.0, 1.0)) + dip; // the view's angle above the horizon
  let v = 1.0 - sqrt(clamp(above / span, 0.0, 1.0));
  let u = sqrt(clamp(0.5 - 0.5 * cosAzimuth, 0.0, 1.0));
  return (vec2f(u, v) * (size - 1.0) + 0.5) / size;
}

fn skyViewParams(uv: vec2f, h: f32, size: vec2f, mu: ptr<function, f32>, cosAzimuth: ptr<function, f32>) {
  let x = (uv * size - 0.5) / (size - 1.0);
  let dip = horizonDip(h);
  let c = 1.0 - x.y;
  // The last row looks a hair above the horizon: a ray exactly tangent to the
  // planet counts as hitting it, and the dark ground would show at the horizon.
  let above = max((0.5 * PI + dip) * c * c, 1e-4);
  *mu = sin(above - dip);
  *cosAzimuth = 1.0 - 2.0 * x.x * x.x;
}
