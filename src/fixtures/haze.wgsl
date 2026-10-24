// Tool fixture: see haze.js; haze-cases.js has the answers' order. One texel
// per answer: the worst miss over the cases, in 8-bit levels on screen.

#include "chunks/fullscreen.wgsl"
#include "chunks/lighting.wgsl"
#include "../sky/atmosphere.wgsl"
#include "../post/tonemap.wgsl"

const SUN_AT: i32 = 8; // haze-cases.js sunlightHeights.length (haze.js checks)
const RATIOS: i32 = 2; // and sunHeights.length

struct Haze {
  uSunAt: array<vec4f, 8>, // .x, m: where the sunlight is checked (haze-cases.js; uniform arrays hold vec4f)
  uSunTruth: array<vec3f, 8>, // and what it is there (sky/light.js sunAtHeight)
  uSunHeights: array<vec4f, 2>, // .x, m: where to report it against the sea level's
}

@group(1) @binding(0) var<uniform> haze: Haze;

// TONEMAP (tonemap.wgsl): the frame's; ANSWERS: how many answers come before the reported heights
override ANSWERS: i32 = 8;

const DIRECT_STEPS: i32 = 256; // the direct marches: far finer than any table's
const DEG: f32 = PI / 180.0;

fn azimuthAt(i: i32) -> f32 {
  return array<f32, 3>(0.0, 60.0, 180.0)[i]; // degrees from the sun's
}

fn seaAt(i: i32) -> f32 {
  return array<f32, 5>(0.1, 0.3, 0.6, 0.9, 0.99)[i]; // points on the sea, as shares of the distance to the horizon
}

fn hillAt(i: i32) -> f32 {
  return array<f32, 3>(3000.0, 10000.0, 25000.0)[i]; // m: hilltops 40 m high
}

fn elevationAt(i: i32) -> f32 {
  return array<f32, 6>(0.2, 1.0, 4.0, 15.0, 45.0, 85.0)[i]; // degrees: sky directions
}

// 8-bit sRGB levels, as the output pass shows radiance.
fn screen(radiance: vec3f) -> vec3f {
  let c = clamp(tonemap(max(radiance * frame.uExposure, vec3f(0.0))), vec3f(0.0), vec3f(1.0));
  return 255.0 * mix(12.92 * c, 1.055 * pow(c, vec3f(1.0f / 2.4f)) - 0.055, step(vec3f(0.0031308), c));
}

fn miss(seen: vec3f, truth: vec3f) -> f32 {
  let d = abs(screen(seen) - screen(truth));
  return max(d.r, max(d.g, d.b));
}

// The horizontal unit vector `degrees` round from the sun's azimuth.
fn across(degrees: f32) -> vec3f {
  let s = normalize(frame.uSunDirection.xz);
  let a = degrees * DEG;
  return vec3f(s.x * cos(a) - s.y * sin(a), 0.0, s.x * sin(a) + s.y * cos(a));
}

// Far sea and hills that way, in world space (m), bent down with the planet as
// the sea is. All in sight: the sea short of the horizon, the hills above it.
fn farPoint(way: vec3f, k: i32) -> vec3f {
  let horizon = sqrt(2000.0 * frame.uGroundRadius * frame.cameraPosition.y);
  var d: f32;
  if (k < 5) {
    d = seaAt(k) * horizon;
  } else {
    d = hillAt(k - 5);
  }
  var p = frame.cameraPosition + way * d;
  p.y = select(40.0, 0.0, k < 5) - planetDrop(p.xz);
  return p;
}

// mode 0: through the tables (lighting.wgsl); 1: without air; 2: the air seen from sea level.
fn aerialMiss(mode: i32) -> f32 {
  var worst = 0.0;
  let up = vec3f(0.0, 1.0, 0.0);
  for (var a = 0; a < 3; a++) {
    for (var k = 0; k < 8; k++) {
      let p = farPoint(across(azimuthAt(a)), k);
      let radiance = 0.3 / PI * (sunLight(p, up) + skyIrradiance(p, up)); // grey ground
      let ray = p - frame.cameraPosition;
      let dir = normalize(ray);
      let d = length(ray) * 0.001;
      var through: vec3f;
      var truth = inscatter(frame.cameraPosition.y * 0.001, dir, frame.uSunDirection, d, DIRECT_STEPS, &through);
      truth += radiance * through;
      var seen = radiance;
      if (mode == 0) {
        seen = aerialPerspective(radiance, p);
      }
      if (mode == 2) {
        seen = radiance * through + inscatter(0.0, dir, frame.uSunDirection, d, DIRECT_STEPS, &through);
      }
      worst = max(worst, miss(seen, truth));
    }
  }
  return worst;
}

fn skyViewMiss() -> f32 {
  var worst = 0.0;
  for (var a = 0; a < 3; a++) {
    for (var k = 0; k < 6; k++) {
      let e = elevationAt(k) * DEG;
      let dir = across(azimuthAt(a)) * cos(e) + vec3f(0.0, sin(e), 0.0);
      worst = max(worst, miss(skyRadiance(dir), skyRadianceAt(frame.cameraPosition.y * 0.001, dir, frame.uSunDirection, DIRECT_STEPS)));
    }
  }
  return worst;
}

// On a white surface facing up, the sun's way and away from it, sky light only:
// the light state's (times `scale`) against the sky integrated over every
// direction above the horizon from sea level, where the light state holds it,
// and the ground lit by the sun and that sky (the fourth sum: level ground).
fn skyLightMiss(scale: f32) -> f32 {
  let normals = array<vec3f, 4>(vec3f(0.0, 1.0, 0.0), across(0.0), across(180.0), vec3f(0.0, 1.0, 0.0));
  var sum = array<vec3f, 4>(vec3f(0.0), vec3f(0.0), vec3f(0.0), vec3f(0.0));
  const AZ: i32 = 64;
  const RINGS: i32 = 32;
  for (var i = 0; i < AZ; i++) {
    for (var j = 0; j < RINGS; j++) {
      let cosT = 1.0 - 2.0 * (f32(j) + 0.5) / f32(RINGS);
      let sinT = sqrt(max(1.0 - cosT * cosT, 0.0));
      let phi = 2.0 * PI * (f32(i) + 0.5) / f32(AZ);
      let dir = vec3f(sinT * cos(phi), cosT, sinT * sin(phi));
      if (dir.y < 0.0) {
        continue;
      }
      let sky = skyRadianceAt(0.0, dir, frame.uSunDirection, 32);
      for (var n = 0; n < 4; n++) {
        sum[n] += sky * max(dot(normals[n], dir), 0.0);
      }
    }
  }
  let level = sum[3] * 4.0 * PI / f32(AZ * RINGS) + frame.uSunRadiance * max(frame.uSunDirection.y, 0.0);
  var worst = 0.0;
  for (var n = 0; n < 3; n++) {
    let truth = sum[n] * 4.0 * PI / f32(AZ * RINGS) + frame.uBounceAlbedo * level * (0.5 - 0.5 * normals[n].y);
    worst = max(worst, miss(0.8 / PI * scale * skyIrradiance(frame.cameraPosition, normals[n]), 0.8 / PI * truth));
  }
  return worst;
}

// A point h metres above the sea, every other one 25 km from the camera and
// bent down with the planet as the terrain is, about 50 m there.
fn sunPoint(h: f32, k: i32) -> vec3f {
  var away = vec3f(0.0);
  if (k % 2 == 1) {
    away = 25000.0 * across(90.0);
  }
  var p = vec3f(frame.cameraPosition.x, h, frame.cameraPosition.z) + away;
  p.y -= planetDrop(p.xz);
  return p;
}

// The sunlight on a white surface facing the sun, as lighting.wgsl gives it,
// against sky/light.js's at each height, and at sea level against the light
// state's (probe.wgsl and light.js). seaLevel: the sea level's sunlight at
// every height.
fn sunlightMiss(seaLevel: bool) -> f32 {
  var worst = miss(0.8 / PI * sunLight(sunPoint(0.0, 0), frame.uSunDirection), 0.8 / PI * frame.uSunRadiance);
  for (var k = 0; k < SUN_AT; k++) {
    let seen = sunLight(sunPoint(select(haze.uSunAt[k].x, 0.0, seaLevel), k), frame.uSunDirection);
    worst = max(worst, miss(0.8 / PI * seen, 0.8 / PI * haze.uSunTruth[k]));
  }
  return worst;
}

@fragment
fn fragmentMain(in: Fullscreen) -> @location(0) vec4f {
  let answer = i32(in.position.x);
  if (answer >= ANSWERS) {
    // The sunlight at a height, as a multiple of the sea level's.
    let h = haze.uSunHeights[answer - ANSWERS].x;
    const LUMINANCE = vec3f(0.2126, 0.7152, 0.0722);
    let ratio = dot(sunLight(sunPoint(h, 0), frame.uSunDirection), LUMINANCE) / max(dot(sunLight(sunPoint(0.0, 0), frame.uSunDirection), LUMINANCE), 1e-9);
    return vec4f(ratio, 0.0, 0.0, 1.0);
  }
  var worst: f32;
  if (answer == 0) {
    worst = aerialMiss(0);
  } else if (answer == 1) {
    worst = skyViewMiss();
  } else if (answer == 2) {
    worst = skyLightMiss(1.0);
  } else if (answer == 3) {
    worst = sunlightMiss(false);
  } else if (answer == 4) {
    worst = aerialMiss(1);
  } else if (answer == 5) {
    worst = aerialMiss(2);
  } else if (answer == 6) {
    worst = skyLightMiss(0.75);
  } else {
    worst = sunlightMiss(true);
  }
  return vec4f(worst, 0.0, 0.0, 1.0);
}
