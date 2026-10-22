// The aerial-perspective tables' mapping (sky/atmosphere.js renders them). For
// the camera's height and the sun, they hold what the air does to the light
// from a point: the 3D table the light it adds on the way to the camera, the
// 2D one (by y and z alone) the share of the point's own light that gets
// through. By the direction to the point and its distance: x the azimuth from
// the sun's, as in the sky-view table; y the elevation, crowded around the
// horizon, where most of the world lies; z the distance, crowded near the
// camera, out to uAerialRange.

#ifndef PI
#define PI 3.14159265358979
#endif

#include "angles.glsl"

uniform vec3 uAerialSize; // texels
uniform float uAerialRange; // km

// dir: unit vector from the camera, y up; distance in km.
vec3 aerialUvw(vec3 dir, float distance, vec3 sun) {
  vec2 across = dir.xz;
  vec2 sunAcross = sun.xz;
  float cosAzimuth = dot(across, sunAcross) / max(length(across) * length(sunAcross), 1e-6);
  float elevation = asinPrecise(clamp(dir.y, -1.0, 1.0)) / (0.5 * PI);
  vec3 x = vec3(
    sqrt(clamp(0.5 - 0.5 * cosAzimuth, 0.0, 1.0)),
    0.5 + 0.5 * sign(elevation) * sqrt(abs(elevation)),
    sqrt(clamp(distance / uAerialRange, 0.0, 1.0))
  );
  return (x * (uAerialSize - 1.0) + 0.5) / uAerialSize;
}

// The inverse, in a frame with the sun at azimuth 0 (towards +x).
void aerialParams(vec3 uvw, out vec3 dir, out float distance) {
  vec3 x = (uvw * uAerialSize - 0.5) / (uAerialSize - 1.0);
  float cosAzimuth = 1.0 - 2.0 * x.x * x.x;
  float e = 2.0 * x.y - 1.0;
  float elevation = sign(e) * e * e * 0.5 * PI;
  float level = cos(elevation);
  dir = vec3(level * cosAzimuth, sin(elevation), level * sqrt(max(1.0 - cosAzimuth * cosAzimuth, 0.0)));
  distance = x.z * x.z * uAerialRange;
}
