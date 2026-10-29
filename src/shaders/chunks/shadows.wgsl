// The sun's shadows (sky/shadows.js): how much of the sun reaches a point, for
// sunVisibility() (lighting.wgsl), and the share of the ground around in it,
// for the light from below. Two kinds, multiplied:
//
// The island's own shade (world/shade.js, uploaded per time of day): per
// sample of a grid over the island, the ground's share of the sun (r), the
// shade's top (g, m), its reach (b, m) and the share of the ground around in
// the sun (a). The ground itself reads its share, filtered over the pixel's
// footprint; what stands on it (a rock, a palm's crown), how far it stands
// under the shade's top, which a ridge `reach` off softens by the sun's disk,
// going there from the ground's share at its foot over a few metres up:
// shadeAt(), shadeAbove() and shadeAround() are their twins.
//
// The shadow maps round the camera (sky/cascades.js), of what stands on the
// ground (rocks; later plants): read a little off the surface along its
// normal, so a surface doesn't shade itself, and as soft as the sun's disk
// makes a shadow there, from how far its caster is (shadowMap).
//
// A material that lights a pixel more than once (the sun's light, then each
// surface's glint) reads them once, before it lights (shadeOnce), with
// SHADE_ONCE: every read costs on SwiftShader, branch or not (PLAN.md,
// Principles). The terrain also sets SHADE_GROUND.

#include "frame.wgsl"
#include "pi.wgsl"
#include "terrain.wgsl"
#include "planet.wgsl"

// The material reads its shadows once a pixel, in shadeOnce(), before it lights.
override SHADE_ONCE: bool = false;
// The terrain: the ground reads its own share of the sun rather than the share
// at its height, which far out, where the mesh strays from the heights it was
// worked out on, would be off. Needs SHADE_ONCE, which brings the pixel's footprint.
override SHADE_GROUND: bool = false;
// false: no shadow maps (the far terrain, past their reach: world/terrain.js).
override SHADOW_MAP: bool = true;

// How far a point is read off its surface along its normal, in texels of the
// cascade it reads: what keeps a surface from shading itself. Overrides for
// the shadows fixture's deliberate mistakes (src/fixtures/shadows.js).
override SHADOW_NORMAL_OFFSET: f32 = 1.5;
// And towards the sun, in texels and in metres.
override SHADOW_SUN_OFFSET: f32 = 1.0;
override SHADOW_SUN_METRES: f32 = 0.0;
// When 0 or more, the penumbra's half-width (m) everywhere, however far the
// caster: the fixture's mistakes of a shadow as sharp far out as at its foot,
// and as soft at its foot as far out.
override SHADOW_PENUMBRA: f32 = -1.0;

// With SHADE_ONCE, the pixel's shadows (shadeOnce): its share of the sun, and
// the share of the ground around in it. 0 until read: a material that forgot shows black.
var<private> pixelShade: vec2f;

fn shadeUv(position: vec3f) -> vec2f {
  return (terrainCove(position.xz) - frame.uShadeLayout.xy) * frame.uShadeLayout.z;
}

// The share of the sun's disk above a horizon x of its radii above its centre.
fn sunDisk(x: f32) -> f32 {
  let c = clamp(x, -1.0, 1.0);
  return (acos(c) - c * sqrt(1.0 - c * c)) / PI;
}

// What stands on the ground but doesn't know how high: as high as the shade's
// top tells alone.
const SHADE_HIGH: f32 = 1e6;

// The island's shade at position, `above` metres over the ground under it: the
// share of the sun, and around. The ground's filtered over its footprint,
// whose position in the cove's frame changes by dx and dy across the pixel:
// the level by hand, as the GPU picks it from the longer of the two (on
// SwiftShader a read with derivatives costs twice one at a level).
fn islandShadeAt(position: vec3f, dx: vec2f, dy: vec2f, above: f32) -> vec2f {
  var level = 0.0;
  if (SHADE_GROUND) {
    level = 0.5 * log2(max(max(dot(dx, dx), dot(dy, dy)), 1e-12)) + log2(max(frame.uShadeLayout.w, 1e-6));
  }
  let s = textureSampleLevel(uShade, uShadeSampler, shadeUv(position), level);
  var visible = s.r;
  if (!SHADE_GROUND) {
    // How far under the shade's top, at its height above the sea before the
    // planet's bend; the horizon's angle over the sun's centre,
    // atan(tan e + below / reach) - e, as the angle between the two directions.
    let below = s.g - (position.y + planetDrop(position.xz));
    let sinE = frame.uSunDirection.y;
    let cos2 = 1.0 - sinE * sinE;
    let high = sunDisk(atan2(below * cos2, s.b + below * sinE * sqrt(cos2)) * frame.uShadeParams.x);
    visible = mix(s.r, high, smoothstep(0.0, 1.0, above * frame.uShadeParams.y));
  }
  return select(vec2f(visible, s.a), vec2f(1.0), frame.uShadeLayout.z == 0.0);
}

// A cascade's texels, in metres.
fn mapTexel(k: i32) -> f32 {
  return 2.0 * frame.uShadowCascades[k].w * frame.uShadowParams.z;
}

// Where q, on a surface facing n (both in the sun's frame), lands in cascade
// k's map, read a little off its surface: its uv and its depth.
fn mapPoint(q: vec3f, n: vec3f, k: i32) -> vec3f {
  let c = frame.uShadowCascades[k];
  let reach = frame.uShadowParams.y;
  let texel = mapTexel(k);
  let p = q + (SHADOW_NORMAL_OFFSET * texel) * n + vec3f(0.0, 0.0, SHADOW_SUN_OFFSET * texel + SHADOW_SUN_METRES);
  let uv = vec2f(0.5 + (p.x - c.x) / (2.0 * c.w), 0.5 - (p.y - c.y) / (2.0 * c.w));
  // Past the map's far end, away from the sun, as at its far end: shaded by
  // whatever it holds in the way, lit where it holds nothing (cleared to 0).
  return vec3f(uv, max(1.0 + (p.z - c.z - c.w - reach) / (2.0 * c.w + reach), 0.0));
}

// The share of the sun cascade k lets reach a point that lands at m in it
// (mapPoint): 3 x 3 bilinear reads `spread` texels apart, half a texel to
// one, whose edge is as steep as a penumbra mapPenumbra(spread) texels each
// way. A filter so many texels wide keeps a long edge's steps through the
// map's texels small beside its penumbra, and gaps a few texels across open.
fn mapLit(m: vec3f, k: i32, spread: f32) -> f32 {
  let d = spread * frame.uShadowParams.z;
  var lit = 0.0;
  for (var j = -1; j <= 1; j++) {
    for (var i = -1; i <= 1; i++) {
      lit += textureSampleCompareLevel(uShadowMap, uShadowMapSampler, m.xy + vec2f(f32(i), f32(j)) * d, k, m.z);
    }
  }
  return lit / 9.0;
}

// The half-width (texels) of the penumbra whose steepest slope mapLit's edge
// has at `spread` (its filter's peak, (3 - 2 spread) / 3 a texel, against
// the sun's disk's 2 / pi over the half-width): 0.96 at half a texel, 1.92 at one.
fn mapPenumbra(spread: f32) -> f32 {
  return 1.92 / (3.0 - 2.0 * spread);
}

// How far, towards the sun, what casts on a point that lands at m in cascade k
// is from it (m): over the 4 x 4 texels round it, the average of those that
// cast on it, each weighted by a tent two texels each way, so it changes
// smoothly as the point moves. Its reach, at least one and a half texels,
// takes in all that a tent of the same map reads. 0 if nothing casts.
fn casterDistance(m: vec3f, k: i32) -> f32 {
  let size = 1.0 / frame.uShadowParams.z;
  let at = m.xy * size - 0.5; // in texels, their centres on whole numbers
  let f = at - floor(at);
  var sum = 0.0;
  var weight = 0.0;
  for (var j = 0; j < 4; j++) {
    let s = vec2f(f32(j & 1), f32(j >> 1u)) * 2.0 - 1.0; // -1 or 1 texel each way
    let depths = textureGather(uShadowMap, uShadowMapTexels, m.xy + s / size, k);
    // Its texels' offsets from the point: (x0, y1), (x1, y1), (x1, y0), (x0, y0).
    let x = max(1.0 - abs(vec2f(s.x, s.x + 1.0) - f.x) * 0.5, vec2f(0.0));
    let y = max(1.0 - abs(vec2f(s.y, s.y + 1.0) - f.y) * 0.5, vec2f(0.0));
    let w = vec4f(x.x * y.y, x.y * y.y, x.y * y.x, x.x * y.x) * select(vec4f(0.0), vec4f(1.0), depths > vec4f(m.z));
    sum += dot(w, depths - m.z);
    weight += dot(w, vec4f(1.0));
  }
  let span = 2.0 * frame.uShadowCascades[k].w + frame.uShadowParams.y; // m of depth
  return sum / max(weight, 1e-6) * span;
}

// The share of the sun the shadow maps let reach position on a surface facing
// normal: 1 past them. Soft as the sun's disk makes a shadow (times
// config.shadows.softness): its penumbra as wide as it is far from what casts
// it, sharp where it touches its caster. How far that is comes from the
// coarsest map that holds the point (casterDistance); then the finest map,
// its filter spread as far as that takes, or past that the maps whose filters
// at their widest are about that soft, a finer one and the next, mixed.
fn shadowMap(position: vec3f, normal: vec3f) -> f32 {
  if (!SHADOW_MAP) {
    return 1.0;
  }
  let params = frame.uShadowParams;
  let count = i32(params.x);
  let f = frame.uShadowFrame;
  let q = vec3f(dot(position, f[0].xyz), dot(position, f[1].xyz), dot(position, f[2].xyz));
  // The finest cascade that holds it and the coarsest, with room for the
  // offset, the filter and the search.
  var fine = count;
  var coarse = -1;
  for (var i = 3; i >= 0; i--) {
    let c = frame.uShadowCascades[i];
    if (i < count && max(abs(q.x - c.x), abs(q.y - c.y)) < c.w * (1.0 - 8.0 * params.z)) {
      fine = i;
      coarse = max(coarse, i);
    }
  }
  if (fine >= count) {
    return 1.0;
  }
  let n = vec3f(dot(normal, f[0].xyz), dot(normal, f[1].xyz), dot(normal, f[2].xyz));

  let away = casterDistance(mapPoint(q, n, coarse), coarse); // m
  let half = select(away * frame.uShadowSoftness.x, SHADOW_PENUMBRA, SHADOW_PENUMBRA >= 0.0); // the penumbra's half-width, m

  // The pair of maps whose filters at their widest are about as soft, mixed
  // by how steep each one's edge is: the finest alone for a sharp one, its
  // filter as spread as that takes, the coarsest for a soft.
  var a = fine;
  var b = fine;
  var mixed = 0.0;
  let widest = mapPenumbra(1.0);
  let spread = clamp((3.0 - 1.92 * mapTexel(fine) / max(half, 1e-6)) * 0.5, 0.5, 1.0);
  for (var i = 0; i < 3; i++) {
    if (i >= fine && i < coarse) {
      let h0 = widest * mapTexel(i);
      let h1 = widest * mapTexel(i + 1);
      if (half > h0) {
        a = i;
        b = i + 1;
        mixed = clamp((1.0 / h0 - 1.0 / half) / (1.0 / h0 - 1.0 / h1), 0.0, 1.0);
      }
    }
  }
  var lit = 0.0;
  if (mixed < 1.0) {
    lit += (1.0 - mixed) * mapLit(mapPoint(q, n, a), a, select(1.0, spread, a == fine));
  }
  if (mixed > 0.0) {
    lit += mixed * mapLit(mapPoint(q, n, b), b, 1.0);
  }
  // The last cascade fades out towards its edge, so the maps end softly.
  if (fine == count - 1) {
    let c = frame.uShadowCascades[fine];
    let edge = max(abs(q.x - c.x), abs(q.y - c.y)) / c.w;
    lit = mix(lit, 1.0, smoothstep(1.0 - params.w, 1.0 - 8.0 * params.z, edge));
  }
  return lit;
}

// Both at a pixel `above` metres over the ground: the share of the sun, and of the ground around in it.
fn shadeAt(position: vec3f, normal: vec3f, dx: vec2f, dy: vec2f, above: f32) -> vec2f {
  let island = islandShadeAt(position, dx, dy, above);
  return vec2f(island.x * shadowMap(position, normal), island.y);
}

// For SHADE_ONCE: the pixel's shadows, before it lights; `above`: how high
// over the ground under it (the ground itself: SHADE_GROUND, any).
fn shadeOnce(position: vec3f, normal: vec3f, dx: vec2f, dy: vec2f, above: f32) {
  pixelShade = shadeAt(position, normal, dx, dy, above);
}

// The share of the sun that reaches position, on a surface facing normal.
fn sunShadow(position: vec3f, normal: vec3f) -> f32 {
  if (SHADE_ONCE) {
    return pixelShade.x;
  }
  return shadeAt(position, normal, vec2f(0.0), vec2f(0.0), SHADE_HIGH).x;
}

// The share of level ground in the sun around position, about
// config.world.terrain.bounceReach across: the light from below.
fn shadeAround(position: vec3f) -> f32 {
  if (SHADE_ONCE) {
    return pixelShade.y;
  }
  return islandShadeAt(position, vec2f(0.0), vec2f(0.0), SHADE_HIGH).y;
}
