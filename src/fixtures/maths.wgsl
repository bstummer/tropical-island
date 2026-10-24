// Tool fixture: see maths.js. One texel per answer (maths-cases.js has the layout).

#include "chunks/fullscreen.wgsl"
#include "chunks/frame-values.wgsl"
#include "chunks/sh.wgsl"
#include "chunks/sky-view.wgsl"
#include "chunks/aerial.wgsl"
#include "../sky/atmosphere.wgsl"

const DIRECTIONS: i32 = 4; // maths-cases.js directions.length (maths.js checks)

struct Maths {
  uDirections: array<vec3f, 4>,
}

@group(1) @binding(0) var<uniform> maths: Maths;

// Each mapping run forth and back from every texel centre: the worst miss, in texels.
fn skyViewRoundTrip() -> f32 {
  let size = frame.uSkyViewSize;
  var worst = 0.0;
  for (var i = 0; i < 2; i++) {
    let h = select(0.3, 0.002, i == 0); // km: a camera on the beach and on a hill
    // Every row but the last, which looks a hair above the horizon on purpose (sky-view.wgsl).
    for (var y = 0.5; y < size.y - 1.0; y += 1.0) {
      for (var x = 0.5; x < size.x; x += 1.0) {
        let uv = vec2f(x, y) / size;
        var mu: f32;
        var cosAzimuth: f32;
        skyViewParams(uv, h, size, &mu, &cosAzimuth);
        let back = skyViewUv(h, mu, cosAzimuth, size);
        worst = max(worst, max(abs(back.x - uv.x) * size.x, abs(back.y - uv.y) * size.y));
      }
    }
  }
  return worst;
}

fn aerialRoundTrip() -> f32 {
  let size = frame.uAerialSize;
  var worst = 0.0;
  let sun = vec3f(1.0, 0.0, 0.0); // the tables' frame: the sun at azimuth 0
  // Straight up and down (the first and last rows) have no azimuth to come back to.
  for (var z = 0.5; z < size.z; z += 1.0) {
    for (var y = 1.5; y < size.y - 1.0; y += 1.0) {
      for (var x = 0.5; x < size.x; x += 1.0) {
        let uvw = vec3f(x, y, z) / size;
        var dir: vec3f;
        var distance: f32;
        aerialParams(uvw, &dir, &distance);
        let back = aerialUvw(dir, distance, sun);
        worst = max(worst, max(max(abs(back.x - uvw.x) * size.x, abs(back.y - uvw.y) * size.y), abs(back.z - uvw.z) * size.z));
      }
    }
  }
  return worst;
}

fn multiscatterRoundTrip() -> f32 {
  let size = atmosphere.uMultiscatterSize;
  var worst = 0.0;
  for (var y = 0.5; y < size.y; y += 1.0) {
    for (var x = 0.5; x < size.x; x += 1.0) {
      let uv = vec2f(x, y) / size;
      var h: f32;
      var muSun: f32;
      multiscatterParams(uv, &h, &muSun);
      let back = multiscatterUv(h, muSun);
      worst = max(worst, max(abs(back.x - uv.x) * size.x, abs(back.y - uv.y) * size.y));
    }
  }
  return worst;
}

@fragment
fn fragmentMain(in: Fullscreen) -> @location(0) vec4f {
  let i = i32(in.position.x);
  let n = DIRECTIONS;
  if (i < 9 * n) {
    return vec4f(shBasis(i - 9 * (i / 9), normalize(maths.uDirections[i / 9])), 0.0, 0.0, 1.0);
  } else if (i < 10 * n) {
    return vec4f(shIrradiance(normalize(maths.uDirections[i - 9 * n])), 1.0);
  } else if (i == 10 * n) {
    return vec4f(skyViewRoundTrip(), 0.0, 0.0, 1.0);
  } else if (i == 10 * n + 1) {
    return vec4f(aerialRoundTrip(), 0.0, 0.0, 1.0);
  }
  return vec4f(multiscatterRoundTrip(), 0.0, 0.0, 1.0);
}
