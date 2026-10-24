// The aerial-perspective tables' mapping (sky/atmosphere.js renders them). For
// the camera's height and the sun, they hold what the air does to the light
// from a point: the 3D table the light it adds on the way to the camera, the
// 2D one (by y and z alone) the share of the point's own light that gets
// through. By the direction to the point and its distance: x the azimuth from
// the sun's, as in the sky-view table; y the elevation, crowded around the
// horizon, where most of the world lies; z the distance, crowded near the
// camera, out to uAerialRange. Needs `frame` (frame.wgsl or frame-values.wgsl).

#include "pi.wgsl"
#include "angles.wgsl"

// dir: unit vector from the camera, y up; distance in km.
fn aerialUvw(dir: vec3f, distance: f32, sun: vec3f) -> vec3f {
  let across = dir.xz;
  let sunAcross = sun.xz;
  let cosAzimuth = dot(across, sunAcross) / max(length(across) * length(sunAcross), 1e-6);
  let elevation = asinPrecise(clamp(dir.y, -1.0, 1.0)) / (0.5 * PI);
  let x = vec3f(
    sqrt(clamp(0.5 - 0.5 * cosAzimuth, 0.0, 1.0)),
    0.5 + 0.5 * sign(elevation) * sqrt(abs(elevation)),
    sqrt(clamp(distance / frame.uAerialRange, 0.0, 1.0))
  );
  return (x * (frame.uAerialSize - 1.0) + 0.5) / frame.uAerialSize;
}

// The inverse, in a frame with the sun at azimuth 0 (towards +x).
fn aerialParams(uvw: vec3f, dir: ptr<function, vec3f>, distance: ptr<function, f32>) {
  let x = (uvw * frame.uAerialSize - 0.5) / (frame.uAerialSize - 1.0);
  let cosAzimuth = 1.0 - 2.0 * x.x * x.x;
  let e = 2.0 * x.y - 1.0;
  let elevation = sign(e) * e * e * 0.5 * PI;
  let level = cos(elevation);
  *dir = vec3f(level * cosAzimuth, sin(elevation), level * sqrt(max(1.0 - cosAzimuth * cosAzimuth, 0.0)));
  *distance = x.z * x.z * frame.uAerialRange;
}
