// The multiple-scattering table (atmosphere.js): for every height and sun
// angle, the light scattered twice and more per unit of sun illuminance, after
// Hillaire 2020: second-order light from a sphere of directions, made into all
// orders as a geometric series. Rendered after the transmittance table, when
// the time changes.

#include "chunks/fullscreen.wgsl"
#include "chunks/frame-values.wgsl"
#include "atmosphere.wgsl"

override SQRT_DIRECTIONS: i32 = 8; // config.sky.samples
override STEPS: i32 = 20;

@fragment
fn fragmentMain(in: Fullscreen) -> @location(0) vec4f {
  var h: f32;
  var muSun: f32;
  multiscatterParams(in.position.xy / atmosphere.uMultiscatterSize, &h, &muSun);
  let sun = vec3f(sqrt(max(1.0 - muSun * muSun, 0.0)), muSun, 0.0);
  let r = frame.uGroundRadius + h;

  var second = vec3f(0.0); // light scattered once on the way and once more here
  var transfer = vec3f(0.0); // the share of light that scatters once more
  for (var i = 0; i < SQRT_DIRECTIONS; i++) {
    for (var j = 0; j < SQRT_DIRECTIONS; j++) {
      let cosT = 1.0 - 2.0 * (f32(j) + 0.5) / f32(SQRT_DIRECTIONS);
      let sinT = sqrt(max(1.0 - cosT * cosT, 0.0));
      let phi = 2.0 * PI * (f32(i) + 0.5) / f32(SQRT_DIRECTIONS);
      let dir = vec3f(sinT * cos(phi), cosT, sinT * sin(phi));
      let tGround = distanceToGround(h, dir.y);
      let tMax = select(distanceToTop(h, dir.y), tGround, tGround >= 0.0);
      var through = vec3f(1.0);
      for (var k = 0; k < STEPS; k++) {
        let span = marchSpan(k, STEPS, tMax);
        let dt = span.y - span.x;
        let t = 0.5 * (span.x + span.y);
        let hs = heightAlong(h, dir.y, t);
        let muS = dot(vec3f(0.0, r, 0.0) + t * dir, sun) / (frame.uGroundRadius + hs);
        let m = medium(hs);
        let scattering = m.rayleigh + m.mie + m.haze;
        let stepThrough = exp(-m.extinction * dt);
        let integral = through * (1.0 - stepThrough) / max(m.extinction, vec3f(1e-9));
        second += integral * scattering * transmittance(hs, muS) / (4.0 * PI);
        transfer += integral * scattering;
        through *= stepThrough;
      }
      if (tGround >= 0.0) {
        let muS = dot(normalize(vec3f(0.0, r, 0.0) + tGround * dir), sun);
        second += through * transmittance(0.0, muS) * max(muS, 0.0) * atmosphere.uGroundAlbedo / PI;
      }
    }
  }
  let n = f32(SQRT_DIRECTIONS * SQRT_DIRECTIONS);
  second /= n;
  transfer /= n;
  return vec4f(second / (1.0 - transfer), 1.0);
}
