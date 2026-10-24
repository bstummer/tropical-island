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
  uSandRoughness: vec3f, // dry, wet, and a film of water's
  uSandRange: f32, // m from the camera: beyond it sand is its albedo alone (sandAlbedo)
}

@group(1) @binding(18) var<uniform> sandParams: SandUniforms;

struct Sand {
  albedo: vec3f,
  normal: vec3f,
  roughness: f32, // the sand's; where a film covers it, the film's (uSandRoughness.z)
  f0: f32,
  film: f32, // how much of it a film of water covers, 0 to 1
}

// Sand's diffuse albedo once a film of water has mirrored its share.
fn sandDiffuse(s: Sand, n: vec3f, view: vec3f) -> vec3f {
  return s.albedo * (1.0 - fresnel(s.f0, dot(n, view)) * s.film);
}

// The light sand mirrors towards the eye, beyond its diffuse share: a little
// from wet sand, a mirror's worth from a film of water; dry sand is too rough
// to show any. kernel: specularKernel() of n.
fn sandShine(s: Sand, position: vec3f, n: vec3f, view: vec3f, kernel: f32) -> vec3f {
  let glossy = 1.0 - smoothstep(0.7, 0.85, s.roughness);
  var shine = vec3f(0.0);
  if (glossy + s.film > 0.0) {
    shine = glossy * specularLight(position, n, view, filteredRoughness(s.roughness, kernel), s.f0);
    if (s.film > 0.0) {
      shine = mix(shine, specularLight(position, n, view, filteredRoughness(sandParams.uSandRoughness.z, kernel), s.f0), s.film);
    }
  }
  return shine;
}

// Sand's albedo at this wetness, before its detail: wet sand darkens fast.
fn sandAlbedo(wetness: f32, dry: vec3f, wet: vec3f) -> vec3f {
  return mix(dry, wet, smoothstep(0.2, 0.5, wetness));
}

fn sandRotate(v: vec2f, c: f32, s: f32) -> vec2f {
  return vec2f(c * v.x - s * v.y, s * v.x + c * v.y);
}

// Sand without its detail, as far away: its albedo at this wetness, and its
// gloss, from all but matte when damp to a sheen where water fills it to the
// surface, and a mirror under a film. n: the ground's normal; dry, wet: the
// albedos (config.world.terrain.albedo).
fn sandPlain(w: Wet, n: vec3f, dry: vec3f, wet: vec3f) -> Sand {
  let dark = smoothstep(0.2, 0.5, w.wetness);
  let soaked = smoothstep(0.45, 0.7, w.wetness);
  var s: Sand;
  s.albedo = sandAlbedo(w.wetness, dry, wet);
  s.normal = n;
  s.roughness = mix(mix(sandParams.uSandRoughness.x, sandParams.uSandRoughness.y, dark), 0.4, soaked);
  s.f0 = 0.02; // water's, and near enough dry sand's, which is too rough to show it
  s.film = w.film;
  return s;
}

// The same with its detail near the camera; aboveSea: m, for the swash marks.
fn sand(position: vec3f, aboveSea: f32, n: vec3f, w: Wet, dry: vec3f, wet: vec3f, dpdx: vec2f, dpdy: vec2f) -> Sand {
  let xz = position.xz;
  let footprint = max(length(dpdx), length(dpdy)); // metres a pixel spans on the ground
  let near = 1.0 - smoothstep(0.75 * sandParams.uSandRange, sandParams.uSandRange, length(position - frame.cameraPosition));
  let soaked = smoothstep(0.45, 0.7, w.wetness);
  let dryness = 1.0 - smoothstep(0.4, 0.7, w.washed); // ripples stand where the waves don't reach

  var s = sandPlain(w, n, dry, wet);

  // Drifts of lighter and darker sand over metres, and streaks the wind combs
  // along itself, metres long and a hand or two wide.
  let across = vec2f(-sandParams.uSandWind.y, sandParams.uSandWind.x);
  let broad = gradientNoise(xz * 0.13);
  let drift = 0.6 * broad + 0.4 * gradientNoise(xz * 0.47 + 7.1);
  let streak = gradientNoise(vec2f(dot(xz, sandParams.uSandWind) * 0.08, dot(xz, across) * 1.2) + 9.0);
  s.albedo *= 1.0 + (0.1 * drift + 0.05 * streak * (1.0 - smoothstep(0.15, 0.5, footprint))) * near;

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
      let inside = (1.0 - smoothstep(1.0 - soft, 1.0 + soft, r)) * (1.0 - smoothstep(0.004, 0.01, footprint));
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
    s.normal = normalize(n - vec3f(g.x, 0.0, g.y));
    // The wind sorts the grains: dark heavy ones from the volcano settle in the
    // troughs, pale shell gathers on the crests; it shows when the sun is too
    // high for the ripples' shading to.
    // The tile's height averages out, so this keeps the sand's albedo.
    let sorted = rippled * patchy * (4.0 * r.a - 2.0); // -1 in the deepest trough, 1 on the highest crest
    s.albedo *= 1.0 + sorted * vec3f(0.13, 0.13, 0.12);
  }

  // Swash marks: thin lines of fine grit where waves ran out, short arcs that
  // bulge up the beach and overlap, a few across the band they wash.
  let marks = smoothstep(0.35, 0.6, w.washed) * near * (1.0 - smoothstep(0.02, 0.08, footprint));
  if (marks > 0.0) {
    // A line every 7 cm of height, about 0.7 m up the beach, each a couple of
    // centimetres wide, wider as the pixel grows so it never aliases.
    let lobes = 1.0 - abs(gradientNoise(xz * 0.35 - 6.0));
    let reach = (aboveSea - wetParams.uWet.x) * 14.0 - 0.6 * lobes;
    let line = 1.0 - smoothstep(0.012, 0.03 + 1.4 * footprint, abs(fract(reach) - 0.5));
    let broken = smoothstep(0.0, 0.4, gradientNoise(xz * 0.9 + 4.0));
    s.albedo *= 1.0 - 0.08 * line * broken * marks;
  }

  // Wet sand isn't quite flat: the backwash leaves it gently rumpled, which
  // breaks a mirrored sun into a streak of glints; under a film, less so.
  let rumpled = smoothstep(0.45, 0.75, w.wetness) * (1.0 - 0.6 * w.film) * near * (1.0 - smoothstep(0.05, 0.3, footprint));
  if (rumpled > 0.0) {
    let q = xz * 1.7;
    let slope = gradientNoiseD(q).yz + 0.5f * 2.7f * gradientNoiseD(q * 2.7 + 5.0).yz; // literals folded in f32, as GLSL did
    let g = 0.0007f * 1.7f * slope * rumpled; // under a millimetre over decimetres: half a degree or so
    s.normal = normalize(s.normal - vec3f(g.x, 0.0, g.y));
  }
  return s;
}
