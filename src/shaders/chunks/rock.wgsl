// Rock (PLAN.md Stage 4): its albedo, normal and gloss at a point, from a far
// cliff down to the cracks at your feet. Nothing is mapped along the
// heightmap's grid, which stretches down a cliff: every part is a field in
// world space. Relief from metres to decimetres is noise in 3D, sharp-crested
// or rounded, stretched along or across the vertical; the detail tile
// (textures/rock.js, chunks/tiles.wgsl) lies along the two axes the normal leans along most,
// blended by how much, and finer, turned, along the one it leans along most. All of it tilts the normal as a height would (the
// gradient of a height field in 3D, less its part along the normal), so it
// needs no tangents. Streaks run down steep faces, layers cross them, lichen
// grows on what faces the sky, and the sea darkens and wets the rock as far
// as the ground is wet (chunks/wet.wgsl), with a dark band above. Each part
// fades once a pixel covers it, so far rock keeps its albedo and nothing
// sparkles; lichen keeps its share at any distance, as a tint. The tile comes
// with ROCK_DETAIL, within
// uRockRange of the camera and fading out before it: world/terrain.js draws
// rock beyond it with a cheaper shader. Textures are read with the pixel's
// derivatives, passed in (dpdx, dpdy: of the world position), so a caller can
// branch around it.

#include "noise.wgsl"
#include "lighting.wgsl"
#include "wet.wgsl"
#include "tiles.wgsl"

override ROCK_DETAIL: bool = false;

struct RockUniforms {
  uRockMean: vec4f, // the tile's average colour factor, which the albedo keeps; its factor's without the minerals' tints
  uRockTints: array<vec3f, 2>, // the two minerals' colour factors, over the tile's factor
  uRockScales: vec2f, // the tile, m; the finer read's share of it
  uRockRelief: vec4f, // the largest relief's scale (m); its height, of the scale; how sharp its crests, 0 to 1; how stretched along the vertical (below 1) or across it
  uRockTone: f32, // how much the albedo varies with the relief
  uRockEdge: vec4f, // where it meets sand or soil (rockEdge): the rim's width (m) and its slope at the edge; the drift's
  uRockStreaks: vec4f, // the colour factor of streaks down steep faces; their strength
  uRockStrata: vec4f, // layers: their spacing (m); how much their tone varies; how much they step out as ledges
  uRockLichen: vec4f, // the lichen's albedo; how much of the faces that face up it covers
  uRockLichenSecond: vec4f, // a second kind's albedo; its share of the lichen
  uRockWet: vec4f, // how much later its crests get wet than its hollows, in wetness; how dark wet rock is; a dark band from .z to .w m above the sea
  uRockBand: vec2f, // the band's darkness factor; how ragged its edges (m)
  uRockRoughness: vec2f, // dry and wet
  uRockRange: f32, // m from the camera: beyond it, no detail (ROCK_DETAIL)
}

@group(1) @binding(19) var<uniform> rockParams: RockUniforms;

struct Rock {
  albedo: vec3f,
  normal: vec3f,
  roughness: f32,
  f0: f32,
  height: f32, // how high the relief stands here, spread evenly over -1 to 1; 0 where none shows
  width: f32, // how much its height changes across the pixel
  relief: f32, // how much of the relief shows, 0 far away to 1
  rise: vec3f, // how fast its height changes, per metre: its gradient in world space
}

// How much of a pixel is rock, by its height: where rock gives way to sand or
// soil it stands out of them on its crests, and they fill its hollows, as much
// as `cover` says: the height is spread evenly, so on average exactly that,
// however soft the edge. The edge is a couple of centimetres wide, never
// sharper than a pixel, and once the height changes by much of its range
// across one, the pixel shows `cover`.
fn rockShare(cover: f32, r: Rock) -> f32 {
  if (cover >= 1.0) {
    return 1.0;
  }
  let threshold = 1.0 - 2.0 * cover;
  let edge = rockEdgeWidth(r);
  let seen = r.relief * (1.0 - smoothstep(0.3, 0.8, r.width));
  return mix(cover, smoothstep(threshold - edge, threshold + edge, r.height), seen);
}

// Half the width of rockShare's edge, in the height's units: a couple of
// centimetres and the pixel; never 0 (smoothstep() of an empty range is
// undefined), as where every octave has faded.
fn rockEdgeWidth(r: Rock) -> f32 {
  return max(0.02 * length(r.rise) + r.width, 1e-3);
}

// Where rock meets sand or soil (rockShare's edge), the slope that edge gives
// the ground, as the gradient of a height in world space: the rock rounds down
// under them over the rim, and they drift up against it, so an outcrop stands
// out of what lies round it, lit on one side and shaded on the other. Both
// widen to a few pixels far away, so its edge keeps its relief there too.
// Each side's slope runs on across the edge, and the two blend over the width
// rockShare() blends rock with what lies round it, so the slope doesn't step
// within a pixel there. footprint: metres a pixel spans; cover under 1.
fn rockEdge(cover: f32, r: Rock, footprint: f32) -> vec3f {
  let rise = length(r.rise);
  if (rise < 1e-4) {
    return vec3f(0.0);
  }
  let inside = (r.height - (1.0 - 2.0 * cover)) / rise; // m from the edge into the rock
  let rim = max(rockParams.uRockEdge.x, 2.5 * footprint);
  let drift = max(rockParams.uRockEdge.z, 4.0 * footprint);
  let rimSide = rockParams.uRockEdge.y * clamp(1.0 - inside / rim, 0.0, 1.0);
  let driftSide = rockParams.uRockEdge.w * clamp(1.0 + inside / drift, 0.0, 1.0);
  let blend = rockEdgeWidth(r) / rise; // m
  let slope = mix(driftSide, rimSide, smoothstep(-blend, blend, inside));
  let seen = r.relief * (1.0 - smoothstep(0.3, 0.8, r.width));
  return seen * slope * r.rise / rise;
}

// A normal tilted by a height's gradient (in world space).
fn rockTilt(n: vec3f, gradient: vec3f) -> vec3f {
  return normalize(n - (gradient - n * dot(n, gradient)));
}

// The rock's albedo from afar, before its detail: what the terrain draws where
// it leaves the detail out.
fn rockAlbedo(albedo: vec3f, w: Wet) -> vec3f {
  return albedo * mix(1.0, rockParams.uRockWet.y, smoothstep(0.2, 0.5, w.wetness));
}

// A relief's shape, from noise's value and gradient: `ridged` 0 leaves it
// smooth, 1 folds it about zero into sharp crests, no sharper than `soft`, how
// much the noise changes across the pixel: a crest sharper than a pixel turns
// the normal within it, and its shading steps from pixel to pixel.
fn rockCrest(noise: vec4f, ridged: f32, soft: f32) -> vec4f {
  let fold = max(sqrt(noise.x * noise.x + soft * soft), 1e-6);
  let folded = vec4f(1.0 - 2.0 * fold, -2.0 * noise.x / fold * noise.yzw);
  return mix(noise, folded, ridged);
}

// Where a value of the relief falls among all its values, from its
// standardized value z: 0 the lowest to 1 the highest, and how fast that
// changes with z. The relief's crests make it lopsided, so its quantiles are
// a table: measured with a JS port of noise.wgsl over 120,000 points, at a
// sharpness of 0.8 and rock()'s weights (as the octaves fade far away, they
// stray by 0.2 at most, at the top).
// Written out piece by piece: a loop over arrays in function memory costs
// SwiftShader loads and stores at every pixel.
fn rockRank(zIn: f32) -> vec2f {
  let z = clamp(zIn, -4.0, 2.1);
  var rank = vec2f(0.0);
  rank = rockRankPiece(z, -4.0, -2.38, 0.0, 0.02, rank);
  rank = rockRankPiece(z, -2.38, -1.84, 0.02, 0.05, rank);
  rank = rockRankPiece(z, -1.84, -1.35, 0.05, 0.1, rank);
  rank = rockRankPiece(z, -1.35, -0.8, 0.1, 0.2, rank);
  rank = rockRankPiece(z, -0.8, -0.43, 0.2, 0.3, rank);
  rank = rockRankPiece(z, -0.43, -0.14, 0.3, 0.4, rank);
  rank = rockRankPiece(z, -0.14, 0.13, 0.4, 0.5, rank);
  rank = rockRankPiece(z, 0.13, 0.38, 0.5, 0.6, rank);
  rank = rockRankPiece(z, 0.38, 0.62, 0.6, 0.7, rank);
  rank = rockRankPiece(z, 0.62, 0.88, 0.7, 0.8, rank);
  rank = rockRankPiece(z, 0.88, 1.2, 0.8, 0.9, rank);
  rank = rockRankPiece(z, 1.2, 1.41, 0.9, 0.95, rank);
  rank = rockRankPiece(z, 1.41, 1.61, 0.95, 0.98, rank);
  return rockRankPiece(z, 1.61, 2.1, 0.98, 1.0, rank);
}

// One piece of rockRank's table, from z0 at q0 to z1 at q1: where z falls on
// it, or `rank` if z lies elsewhere (a later piece wins where two meet).
fn rockRankPiece(z: f32, z0: f32, z1: f32, q0: f32, q1: f32, rank: vec2f) -> vec2f {
  let slope = (q1 - q0) / (z1 - z0);
  return select(rank, vec2f(q0 + (z - z0) * slope, slope), z >= z0 && z <= z1);
}

// The tile read along one axis: the slope of its height across the plane
// (du, dv) and its colour factor (rgb), and its factor without the minerals'
// tints (w), which follows the weathering: lighter on crests, darker in hollows.
fn rockTile(uv: vec2f, dx: vec2f, dy: vec2f, scale: f32, slope: ptr<function, vec2f>, colour: ptr<function, vec4f>) {
  let t = surfaceTile(TILE_ROCK, uv / scale, dx / scale, dy / scale);
  let xy = t.xy * 2.0 - 1.0;
  let z = sqrt(max(1.0 - dot(xy, xy), 0.04));
  *slope = -xy / z;
  let factor = 2.0 * t.b;
  *colour = vec4f(mix(rockParams.uRockTints[0], rockParams.uRockTints[1], t.a) * factor, factor);
}

// The tile on the plane of world axes u and v: the height's gradient in world
// space, and the colour factor (rockTile's). Each plane reads its own part of the tile.
fn rockPlane(p: vec3f, dpdx: vec3f, dpdy: vec3f, u: i32, v: i32, scale: f32, gradient: ptr<function, vec3f>, colour: ptr<function, vec4f>) {
  var slope: vec2f;
  let offset = 0.37 * f32(u + 2 * v);
  rockTile(vec2f(p[u], p[v]) + offset, vec2f(dpdx[u], dpdx[v]), vec2f(dpdy[u], dpdy[v]), scale, &slope, colour);
  // Set by index in a local: FXC fails on Tint's HLSL for an index written through the pointer.
  var g = vec3f(0.0);
  g[u] = slope.x;
  g[v] = slope.y;
  *gradient = g;
}

// The axis along which n leans most, with the two that follow it.
fn rockMost(a: vec3f) -> vec3i {
  return select(select(vec3i(2, 0, 1), vec3i(1, 2, 0), a.y > a.z), vec3i(0, 1, 2), a.x > a.y && a.x > a.z);
}

// The tile along the two axes the normal n leans along most, blended by how
// much (biplanar, after Quilez: two reads where three would show little more):
// the height's gradient in world space, and the colour factor (rockTile's).
fn rockBiplanar(p: vec3f, dpdx: vec3f, dpdy: vec3f, n: vec3f, scale: f32, gradient: ptr<function, vec3f>, colour: ptr<function, vec4f>) {
  let a = abs(n);
  let most = rockMost(a);
  let least = select(select(vec3i(2, 0, 1), vec3i(1, 2, 0), a.y < a.z), vec3i(0, 1, 2), a.x < a.y && a.x < a.z);
  let next = vec3i(3) - most - least;
  var g1: vec3f;
  var g2: vec3f;
  var c1: vec4f;
  var c2: vec4f;
  rockPlane(p, dpdx, dpdy, most.y, most.z, scale, &g1, &c1);
  rockPlane(p, dpdx, dpdy, next.y, next.z, scale, &g2, &c2);
  var w = clamp((vec2f(a[most.x], a[next.x]) - 0.5773) / (1.0f - 0.5773f), vec2f(0.0), vec2f(1.0)); // literals folded in f32, as GLSL did
  w *= w;
  w /= w.x + w.y + 1e-4;
  *gradient = w.x * g1 + w.y * g2;
  *colour = w.x * c1 + w.y * c2;
}

// aboveSea: m above the sea; w: how wet the ground is there; n: the ground's
// normal; view: towards the eye; albedo: the rock's (config.world.terrain.albedo).
fn rock(position: vec3f, aboveSea: f32, w: Wet, n: vec3f, view: vec3f, albedo: vec3f, dpdx: vec3f, dpdy: vec3f) -> Rock {
  let footprint = max(length(dpdx), length(dpdy)); // metres a pixel spans on the rock
  var r: Rock;
  r.albedo = albedo;
  r.f0 = 0.04;
  r.relief = 0.0;
  var gradient = vec3f(0.0);

  // Relief: three octaves, each a third the size, as tall for its size; the
  // tile takes over below them. Its height, for where sand and soil fill its
  // hollows, follows its crests as its shading does, the larger octaves more.
  let sharp = rockParams.uRockRelief.z;
  const WEIGHTS = vec3f(1.0, 0.6, 0.4);
  let stretch = vec3f(1.0, rockParams.uRockRelief.w, 1.0);
  var scale = rockParams.uRockRelief.x;
  var tone = 0.0;
  var height = 0.0;
  var mean = 0.0;
  var variance = 0.0;
  var slope = vec3f(0.0); // the height's gradient
  var middle = 0.0; // the octaves' values, which more than the relief follows
  var smallest = 0.0;
  for (var k = 0; k < 3; k++) {
    let fade = 1.0 - smoothstep(0.1, 0.3, footprint / scale); // creases alias early
    let noise = gradientNoise3D(position * stretch / scale + f32(k) * 17.1);
    let soft = 0.5 * footprint / scale * length(noise.yzw);
    let crest = rockCrest(noise, sharp, soft);
    gradient += fade * rockParams.uRockRelief.y * crest.yzw * stretch;
    let weight = fade * WEIGHTS[k];
    height += weight * crest.x;
    slope += weight * crest.yzw * stretch / scale;
    // The crests' mean and deviation: noise's is 0.229, and its fold
    // sqrt(n² + soft²) averages 0.229 E[sqrt(z² + t²)], t = soft / 0.229, for
    // z standard normal (fitted, to within 0.75% of the deviation), so its
    // crests lie lower and spread less the softer they are.
    let t = soft / 0.229;
    let fold = 0.229 * (sqrt(0.6366 + t * t) + 0.148 * t / (1.0 + t * t));
    let foldVariance = max(0.229 * 0.229 + soft * soft - fold * fold, 0.0);
    mean += weight * sharp * (1.0 - 2.0 * fold);
    variance += weight * weight * ((1.0 - sharp) * (1.0 - sharp) * 0.229 * 0.229 + 4.0 * sharp * sharp * foldVariance);
    tone += fade * noise.x / f32(k + 1);
    if (k == 1) {
      r.relief = fade;
      middle = noise.x;
    }
    smallest = noise.x;
    scale /= 3.0;
  }
  r.albedo *= 1.0 + rockParams.uRockTone * tone;

  // Layers across steep faces, thicker and thinner, each its own tone and
  // blending into the next; the top of each steps out as a ledge, in stretches.
  let steep = smoothstep(0.3, 0.7, 1.0 - n.y);
  let layered = position.y / rockParams.uRockStrata.x + 0.8 * gradientNoise(position.xz / 50.0) + 0.25 * middle;
  let fadeLayers = steep * (1.0 - smoothstep(0.05, 0.15, footprint / rockParams.uRockStrata.x));
  let layer = floor(layered);
  let within = layered - layer;
  let layerTone = mix(noiseHash22(vec2f(layer, 3.7)).x, noiseHash22(vec2f(layer + 1.0, 3.7)).x, smoothstep(0.6, 1.0, within));
  r.albedo *= 1.0 + rockParams.uRockStrata.y * layerTone * fadeLayers;
  let ledge = smoothstep(0.6, 0.9, within) * (1.0 - smoothstep(0.9, 1.0, within));
  let broken = smoothstep(-0.2, 0.3, smallest);
  gradient.y -= 4.0 * rockParams.uRockStrata.z * fadeLayers * ledge * broken;

  // Streaks down steep faces where water runs, a hand or two wide and metres long.
  let streak = gradientNoise3(position * vec3f(1.0f / 0.9f, 1.0f / 9.0f, 1.0f / 0.9f) + 5.3); // literals folded in f32, as GLSL did
  let streaked = steep * rockParams.uRockStreaks.w * smoothstep(-0.1, 0.5, streak) * (1.0 - smoothstep(0.2, 0.6, footprint));
  r.albedo *= mix(vec3f(1.0), rockParams.uRockStreaks.rgb, streaked);

  // Lichen covers its share of what faces up as a thin crust, near and far
  // alike: a tint, in no patches of its own (the user's pick, 2026-10-28).
  var grainy = vec4f(1.0); // the tile's colour factor and its factor without the minerals' tints (w), relative to their means
  var lichen = rockParams.uRockLichen.w;
  if (ROCK_DETAIL) {
    let near = 1.0 - smoothstep(0.75 * rockParams.uRockRange, rockParams.uRockRange, length(position - frame.cameraPosition));
    if (near > 0.0) {
      // The tile at two scales.
      let tile = rockParams.uRockScales.x;
      var g: vec3f;
      var colour: vec4f;
      rockBiplanar(position, dpdx, dpdy, n, tile, &g, &colour);
      grainy = mix(vec4f(1.0), colour / rockParams.uRockMean, near);
      gradient += near * g;
      let fine = near * (1.0 - smoothstep(0.004, 0.012, footprint / (tile * rockParams.uRockScales.y)));
      if (fine > 0.0) {
        // Grain this fine needs one read only: the tile across the axis the
        // normal leans along most, turned (transposed) so it doesn't line up
        // with the coarser read; where that axis changes, no seam shows in it.
        let most = rockMost(abs(n));
        rockPlane(position, dpdx, dpdy, most.z, most.y, tile * rockParams.uRockScales.y, &g, &colour);
        gradient += fine * g;
        grainy *= mix(vec4f(1.0), colour / rockParams.uRockMean, fine);
      }
    }
  }
  r.albedo *= grainy.rgb;
  // The relief's height spread evenly (rockRank), how much it changes across
  // the pixel, and its gradient, from the octaves' gradient. The tile's grain
  // leaves it alone: where sand or soil meets the rock, the rock's edge
  // follows its relief, not its crystals.
  let deviation = sqrt(variance);
  // GLSL's ?: evaluated only the side it chose: an if, not select(), so rockRank's loop runs only where it counts.
  var rank = vec2f(0.5, 0.0);
  r.rise = vec3f(0.0);
  if (deviation > 1e-3) {
    rank = rockRank((height - mean) / deviation);
    r.rise = 2.0 * rank.y * slope / deviation;
  }
  r.height = 2.0 * rank.x - 1.0;
  r.width = abs(dot(r.rise, dpdx)) + abs(dot(r.rise, dpdy));

  // Bumps facing away from the eye would show their dark side: along a face,
  // the eye sees the sides of them that face it.
  r.normal = normalize(n - (gradient - n * dot(n, gradient)));
  r.normal = normalize(r.normal + max(0.1 - dot(r.normal, view), 0.0) * view);
  lichen *= smoothstep(0.0, 0.6, r.normal.y);
  // Of two kinds, the second in its share; a crust: the rock's grain shows through it.
  let kind = rockParams.uRockLichenSecond.w;
  let lichenAlbedo = mix(rockParams.uRockLichen.rgb, rockParams.uRockLichenSecond.rgb, kind) * (0.75 + 0.25 * grainy.rgb);
  r.albedo = mix(r.albedo, lichenAlbedo, 0.8 * lichen);

  // The sea: rock is as wet as the ground there, its crests drying first;
  // above it, a dark band where spray keeps algae alive.
  let ragged = 0.25 * smallest + 0.4 * r.height; // about -1 to 1
  let wet = smoothstep(0.2, 0.5, w.wetness - rockParams.uRockWet.x * ragged);
  let above = aboveSea + rockParams.uRockBand.y * ragged;
  let band = smoothstep(rockParams.uRockWet.z - 0.3, rockParams.uRockWet.z, above) * (1.0 - smoothstep(rockParams.uRockWet.w - 0.4, rockParams.uRockWet.w, aboveSea + 2.0 * rockParams.uRockBand.y * ragged));
  r.albedo *= mix(1.0, rockParams.uRockBand.x, band * (1.0 - lichen));
  r.albedo *= mix(1.0, rockParams.uRockWet.y, wet);
  r.roughness = mix(rockParams.uRockRoughness.x, rockParams.uRockRoughness.y, wet);
  return r;
}

// The light rock mirrors towards the eye: wet rock's sheen, and only that.
// kernel: specularKernel() of n.
fn rockShine(r: Rock, position: vec3f, n: vec3f, view: vec3f, kernel: f32) -> vec3f {
  let glossy = 1.0 - smoothstep(0.6, 0.8, r.roughness);
  // GLSL's ?: evaluated only the side it chose: an if, so dry rock skips specularLight().
  if (glossy > 0.0) {
    return glossy * specularLight(position, n, view, filteredRoughness(r.roughness, kernel), r.f0);
  }
  return vec3f(0.0);
}
