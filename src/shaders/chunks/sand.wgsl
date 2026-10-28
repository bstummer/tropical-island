// Sand (PLAN.md Stage 4): its albedo, normal and gloss at a point, for any
// wetness from dry to the mirror of a film of water just after a wave drains
// (chunks/wet.wgsl, which Stage 7's waves will drive). Far away it keeps its
// albedo and its sheen at that wetness (sandPlain); near the camera it has
// detail too (sand).
//
// The detail comes from the tiles of textures/sand.js (chunks/tiles.wgsl), which repeat: the grain
// is read at two scales that never line up, and the ripples through a slow
// warp in world space that bends their field and hides the tile, patchy as
// sand is. Drifts of lighter and darker sand span metres, and the wind combs
// streaks along itself; bits of shell gather in patches; arcs of fine grit
// mark where waves ran out. Each fades once a pixel covers it, so far sand
// keeps its albedo and nothing sparkles, and all of it by uSandRange from the
// camera, beyond which world/terrain.js draws sand as its albedo alone.
// Textures are read with the pixel's derivatives, passed in (dpdx, dpdy: of
// world xz), so a caller can branch around it.

#include "noise.wgsl"
#include "lighting.wgsl"
#include "wet.wgsl"
#include "tiles.wgsl"

struct SandUniforms {
  uSandGrainMean: vec3f, // the grain's average factor, which the albedo keeps
  uSandTiles: vec3f, // the grain's and the ripples' tiles, m; how strong the ripples stand
  uSandWind: vec2f, // which way the wind blows the sand: world xz, unit
  uSandRoughness: vec4f, // dry, wet, soaked, and a film of water's
  uSandRange: f32, // m from the camera: beyond it sand is its albedo alone (sandAlbedo)
  uSandRumples: vec2f, // the backwash's rumples: their largest wavelength (m) and slope
}

@group(1) @binding(18) var<uniform> sandParams: SandUniforms;

struct Sand {
  albedo: vec3f,
  normal: vec3f,
  roughness: f32, // the sand's; where a film covers it, the film's (uSandRoughness.w)
  f0: f32,
  film: f32, // how much of it a film of water covers, 0 to 1
  spread: f32, // what rumples too small for the pixel add to its roughness (as GGX's alpha squared)
  rumple: vec2f, // the slope of the rumples the pixel holds, which tilt what the sand mirrors
}

// Sand's diffuse albedo once a film of water has mirrored its share.
fn sandDiffuse(s: Sand, n: vec3f, view: vec3f) -> vec3f {
  return s.albedo * (1.0 - fresnel(s.f0, dot(n, view)) * s.film);
}

// The light sand mirrors towards the eye, beyond its diffuse share: a little
// from wet sand, a mirror's worth from a film of water; dry sand is too rough
// to show any. kernel: specularKernel() of n.
fn sandShine(s: Sand, position: vec3f, normal: vec3f, view: vec3f, kernel: f32) -> vec3f {
  let glossy = 1.0 - smoothstep(0.7, 0.85, s.roughness);
  var shine = vec3f(0.0);
  if (glossy + s.film > 0.0) {
    let n = normalize(normal - vec3f(s.rumple.x, 0.0, s.rumple.y));
    shine = glossy * specularLight(position, n, view, filteredRoughness(s.roughness, kernel + s.spread), s.f0);
    if (s.film > 0.0) {
      shine = mix(shine, specularLight(position, n, view, filteredRoughness(sandParams.uSandRoughness.w, kernel + s.spread), s.f0), s.film);
    }
  }
  return shine;
}

// How far wet sand has darkened, 0 dry to 1 as dark as wet sand: a little
// where damp, most of the way where wet (world/albedo.js sandDark).
fn sandDark(wetness: f32) -> f32 {
  return smoothstep(0.05, 0.6, wetness);
}

// Sand's albedo at this wetness, before its detail.
fn sandAlbedo(wetness: f32, dry: vec3f, wet: vec3f) -> vec3f {
  return mix(dry, wet, sandDark(wetness));
}

// How much of the sand the backwash has rumpled, by how wet it is.
fn sandRumpled(wetness: f32) -> f32 {
  return smoothstep(0.35, 0.7, wetness);
}

// The rumples' slope at scale k of 3, largest first: the smaller, the steeper.
fn sandRumpleSlope(k: i32) -> f32 {
  return sandParams.uSandRumples.y * (0.3 + 0.5 * f32(k));
}

// What all the rumples add to the roughness where a pixel holds none of them:
// their slopes' variance, as GGX's alpha squared.
fn sandRumpleSpread() -> f32 {
  let s = sandParams.uSandRumples.y;
  return 2.0 * s * s * (0.09 + 0.64 + 1.69);
}

fn sandRotate(v: vec2f, c: f32, s: f32) -> vec2f {
  return vec2f(c * v.x - s * v.y, s * v.x + c * v.y);
}

// Sand without its detail, as far away: its albedo at this wetness, and its
// gloss, from matte when damp to a soft sheen where wet and a glossy one where
// water fills it to the surface, and a mirror under a film. n: the ground's
// normal; dry, wet: the albedos (config.world.terrain.albedo).
fn sandPlain(w: Wet, n: vec3f, dry: vec3f, wet: vec3f) -> Sand {
  let r = sandParams.uSandRoughness;
  var s: Sand;
  s.albedo = sandAlbedo(w.wetness, dry, wet);
  s.normal = n;
  s.roughness = mix(mix(r.x, r.y, smoothstep(0.15, 0.45, w.wetness)), r.z, smoothstep(0.45, 0.8, w.wetness));
  s.f0 = 0.02; // water's, and near enough dry sand's, which is too rough to show it
  s.film = w.film;
  s.spread = sandRumpled(w.wetness) * sandRumpleSpread();
  return s;
}

// The same with its detail near the camera; aboveSea: m, for the swash marks.
fn sand(position: vec3f, aboveSea: f32, n: vec3f, w: Wet, dry: vec3f, wet: vec3f, dpdx: vec2f, dpdy: vec2f) -> Sand {
  let xz = position.xz;
  let footprint = max(length(dpdx), length(dpdy)); // metres a pixel spans on the ground
  let near = 1.0 - smoothstep(0.75 * sandParams.uSandRange, sandParams.uSandRange, length(position - frame.cameraPosition));
  let soaked = smoothstep(0.45, 0.7, w.wetness);
  let dryness = 1.0 - smoothstep(0.15, 0.45, w.washed); // ripples stand where the waves don't reach

  var s = sandPlain(w, n, dry, wet);

  // Drifts of lighter and darker sand over metres, and streaks the wind combs
  // along itself, metres long and a hand or two wide.
  let across = vec2f(-sandParams.uSandWind.y, sandParams.uSandWind.x);
  let broad = gradientNoise(xz * 0.13);
  let drift = 0.6 * broad + 0.4 * gradientNoise(xz * 0.47 + 7.1);
  let streak = gradientNoise(vec2f(dot(xz, sandParams.uSandWind) * 0.08, dot(xz, across) * 1.2) + 9.0);
  s.albedo *= 1.0 + (0.16 * drift + 0.07 * streak * (1.0 - smoothstep(0.15, 0.5, footprint))) * near;

  // Grain, near the camera: two reads of the tile, one turned and smaller.
  if (footprint < 0.02) {
    let tile = sandParams.uSandTiles.x;
    const C: f32 = 0.8;
    const S: f32 = 0.6;
    let uv2 = sandRotate(xz, C, S) / (0.37 * tile) + 0.31;
    let a = surfaceTile(TILE_GRAIN, xz / tile, dpdx / tile, dpdy / tile).rgb;
    let b = surfaceTile(TILE_GRAIN, uv2, sandRotate(dpdx, C, S) / (0.37 * tile), sandRotate(dpdy, C, S) / (0.37 * tile)).rgb;
    let grain = (a + b) / sandParams.uSandGrainMean;
    let fine = 1.0 - smoothstep(0.006, 0.02, footprint);
    s.albedo *= mix(vec3f(1.0), grain, fine);
    // Soaked sand's sheen is grainy: each grain sits a little higher or lower in the water.
    s.roughness *= max(1.0 + 0.6 * soaked * fine * (grain.g - 1.0) * 4.0, 0.25);
  }

  // Bits of bleached shell, the odd one pink or a dark pebble: one or none in
  // each cell of a grid, kept inside its cell so a pixel looks at one only.
  // Most are small, all angular and half buried, and they gather in patches.
  // Each shows only while it spans a few pixels: smaller, it would be a
  // speck of a pixel or two, and on wet sand its tilt a glint as small.
  if (footprint < 0.01) {
    const CELL: f32 = 0.17;
    let cell = floor(xz / CELL);
    let h = noiseHash22(cell + 71.3) * 0.5 + 0.5;
    if (h.x < 0.4 * smoothstep(-0.2, 0.6, drift)) {
      let k = noiseHash22(cell + 13.7) * 0.5 + 0.5;
      var d = xz - (cell + 0.3 + 0.4 * k) * CELL;
      let radius = mix(0.003, 0.016, h.y * h.y * h.y);
      let turn = 6.2832 * k.x;
      d = sandRotate(d, cos(turn), sin(turn)) * vec2f(1.0, 1.5);
      let angle = atan2(d.y, d.x);
      let edge = 1.0 + 0.25 * sin(5.0 * angle + 9.0 * k.y) + 0.15 * sin(3.0 * angle + 4.0 * h.y);
      let r = length(d) / (radius * edge);
      let soft = footprint / radius;
      let inside = (1.0 - smoothstep(1.0 - soft, 1.0 + soft, r)) * (1.0 - smoothstep(0.004, 0.01, footprint)) * smoothstep(1.5, 3.0, radius / footprint);
      let tint = select(select(vec3f(0.55, 0.52, 0.5), vec3f(1.18, 1.07, 1.03), k.y < 0.93), vec3f(1.22, 1.2, 1.14), k.y < 0.82);
      s.albedo *= mix(vec3f(1.0), tint, inside);
      let tilt = sandRotate(d / radius, cos(turn), -sin(turn));
      s.normal = normalize(s.normal - 0.3 * inside * vec3f(tilt.x, 0.0, tilt.y));
    }
  }

  // Ripples, where the sand is dry and level enough, until a pixel covers one.
  let rippled = dryness * near * (1.0 - smoothstep(0.025, 0.07, footprint)) * (1.0 - smoothstep(0.25, 0.45, 1.0 - n.y));
  if (rippled > 0.0) {
    let w = vec2f(dot(xz, sandParams.uSandWind), dot(xz, across)); // the wind's frame
    let warp = 0.9 * vec2f(gradientNoise(xz * 0.11 + 3.3), gradientNoise(xz * 0.11 - 5.1));
    let tile = sandParams.uSandTiles.y;
    let gx = vec2f(dot(dpdx, sandParams.uSandWind), dot(dpdx, across)) / tile;
    let gy = vec2f(dot(dpdy, sandParams.uSandWind), dot(dpdy, across)) / tile;
    let r = surfaceTile(TILE_RIPPLES, (w + warp) / tile, gx, gy);
    let t = r.xyz * 2.0 - 1.0;
    // Fields of stronger and fainter ripples.
    let patchy = 0.3 + 0.7 * smoothstep(-0.3, 0.4, broad);
    let slope = -t.xy / max(t.z, 0.25) * sandParams.uSandTiles.z * rippled * patchy;
    let g = slope.x * sandParams.uSandWind + slope.y * across; // dh/dx, dh/dz
    s.normal = normalize(s.normal - vec3f(g.x, 0.0, g.y));
    // The wind sorts the grains: dark heavy ones from the volcano settle in the
    // troughs, pale shell gathers on the crests; it shows when the sun is too
    // high for the ripples' shading to.
    // The tile's height averages out, so this keeps the sand's albedo.
    let sorted = rippled * patchy * (4.0 * r.a - 2.0); // -1 in the deepest trough, 1 on the highest crest
    s.albedo *= 1.0 + sorted * vec3f(0.2, 0.2, 0.19);
  }

  // Swash marks: a thin line of fine grit where the last waves ran out, along
  // the tongues of their reach, and a fainter, broken one above it where an
  // earlier wave reached.
  let marks = smoothstep(0.05, 0.3, w.washed) * near * (1.0 - smoothstep(0.02, 0.08, footprint));
  if (marks > 0.0) {
    let rise = max(length(n.xz) / max(n.y, 0.1), 0.02); // m up per m across the ground
    let last = aboveSea - w.reach - wetParams.uWet.y; // m above the last waves' reach, on the wet edge's
    let earlier = last - 0.03 - 0.02 * gradientNoise(xz * 0.25 + 9.1);
    let width = 0.024 + footprint;
    let line = 1.0 - smoothstep(0.012, width, abs(last / rise + 0.012));
    let older = (1.0 - smoothstep(0.01, width, abs(earlier / rise))) * smoothstep(0.0, 0.4, gradientNoise(xz * 0.8 + 4.0));
    s.albedo *= 1.0 - 0.12 * max(line, 0.45 * older) * marks;
  }

  // Wet sand isn't flat: the backwash leaves it rumpled, from swells half a
  // metre across to pits and crumbs of a few centimetres, too shallow to
  // shade but enough to tilt the water in and on it. A low sun mirrored in it
  // breaks into a streak of glints. Each scale drops out once a pixel can't
  // hold it, its slopes going to the roughness, so further away the glints
  // merge into a broad path of glitter rather than sparkle.
  let rumpled = sandRumpled(w.wetness);
  if (rumpled * near > 0.0) {
    var g = vec2f(0.0);
    var lost = 0.0; // the slopes' variance the pixel can't hold
    var wavelength = sandParams.uSandRumples.x;
    for (var k = 0; k < 3; k++) {
      let slope = sandRumpleSlope(k);
      let held = smoothstep(4.0, 10.0, wavelength / footprint);
      // The noise's slope is about 1.4 across a unit of it on average.
      g += held * slope / 1.4 * gradientNoiseD(xz / wavelength + 7.3 * f32(k)).yz;
      lost += (1.0 - held * held) * slope * slope;
      wavelength *= 0.3;
    }
    s.rumple = rumpled * near * g;
    s.spread = rumpled * mix(sandRumpleSpread(), 2.0 * lost, near);
  }
  return s;
}
