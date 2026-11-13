// Light on the floor under shallow water: water/caustics.js's twin, which says what it is.
// causticLight() is how much of the sun's light reaches the floor at a point as drawn: around 1,
// coarsening into even light where a pixel can't hold its net, and deeper than it reaches.
// Needs `frame` (the waves' time).

struct CausticSettings {
  uCausticWaves: array<vec4f, 8>, // per ripple, shortest first: its wave numbers along world x and z (rad/m), its amplitude (m), how fast it turns (rad/s)
  uCausticPhases: array<vec4f, 2>, // where each starts, rad
  uCausticMeans: array<vec4f, 36>, // its light's mean at each of 16 depths, evenly from 0 to the deepest, for each whole number of ripples dropped, 0 to 8
  uCaustic: vec4f, // how soft its net is, and how much softer per m of depth; how many times as deep as a ripple gathers the light it blurs out; the deepest of the depths, m
  uCausticWander: vec4f, // how far the longer waves carry the ripples to and fro, m, and 2 pi over how far; how much of its net shows; how much the water bends the light (1 - 1 / ior)
  uCausticFade: vec4f, // how wide a pixel (m) starts to drop the shortest ripple; log2 of the ratio from one ripple's length to the next; about how much brighter than even light its brightest lines are
}

@group(1) @binding(24) var<uniform> caustic: CausticSettings;

const CAUSTIC_WAVES: i32 = 8; // water/caustics.js holds the counts to these
const CAUSTIC_DEPTHS: i32 = 16;

// How many of the shortest ripples a pixel `footprint` m wide drops (water/caustics.js droppedBy).
fn causticDropped(footprint: f32) -> f32 {
  return clamp(log2(max(footprint, 1e-9) / caustic.uCausticFade.x) / caustic.uCausticFade.y, 0.0, f32(CAUSTIC_WAVES));
}

// One mean of the table: `dropped` ripples left out, at the j-th depth.
fn causticMeanOf(dropped: i32, j: i32) -> f32 {
  let n = dropped * CAUSTIC_DEPTHS + j;
  return caustic.uCausticMeans[n / 4][n % 4];
}

// Its light's mean at `depth` with `dropped` ripples left out, between the table's entries.
fn causticMean(depth: f32, dropped: f32) -> f32 {
  let at = clamp(depth, 0.0, caustic.uCaustic.w) / caustic.uCaustic.w * f32(CAUSTIC_DEPTHS - 1);
  let j = min(i32(floor(at)), CAUSTIC_DEPTHS - 2);
  let i = min(i32(floor(dropped)), CAUSTIC_WAVES - 1);
  let f = at - f32(j);
  let fewer = mix(causticMeanOf(i, j), causticMeanOf(i, j + 1), f);
  let more = mix(causticMeanOf(i + 1, j), causticMeanOf(i + 1, j + 1), f);
  return mix(fewer, more, dropped - f32(i));
}

// The light reaching the floor `depth` m down where it went in at world xz, at the waves' time t,
// with `dropped` of the shortest ripples left out, per its mean (water/caustics.js at()).
fn causticAt(xz: vec2f, depth: f32, t: f32, dropped: f32) -> f32 {
  let d = caustic.uCausticWander.w * depth;
  // Carried to and fro by the longer waves.
  let turn = caustic.uCausticWander.y;
  let carried = xz + caustic.uCausticWander.x * vec2f(sin(turn * dot(xz, vec2f(0.8, 0.6)) + 1.3), sin(turn * dot(xz, vec2f(-0.6, 0.8)) - 0.7));
  // How much of each ripple's tilt reaches the floor this deep: it blurs out `beyond` times as
  // deep as it gathers the light; none of what the pixel drops. Where the light went in: a step
  // up the slope from straight above.
  var reach: array<f32, CAUSTIC_WAVES>;
  var g = vec2f(0.0);
  for (var i = 0; i < CAUSTIC_WAVES; i++) {
    let w = caustic.uCausticWaves[i];
    let focus = d * w.z * dot(w.xy, w.xy) / caustic.uCaustic.z;
    reach[i] = exp(-focus * focus) * clamp(f32(i + 1) - dropped, 0.0, 1.0);
    g += reach[i] * w.z * cos(dot(w.xy, carried) - w.w * t + caustic.uCausticPhases[i / 4][i % 4]) * w.xy;
  }
  let p = carried + d * g;
  var h = vec3f(0.0); // xx, xz, zz
  for (var i = 0; i < CAUSTIC_WAVES; i++) {
    let w = caustic.uCausticWaves[i];
    let s = -reach[i] * w.z * sin(dot(w.xy, p) - w.w * t + caustic.uCausticPhases[i / 4][i % 4]);
    h += s * vec3f(w.x * w.x, w.x * w.y, w.y * w.y);
  }
  let det = (1.0 - d * h.x) * (1.0 - d * h.z) - d * d * h.y * h.y;
  let soft = caustic.uCaustic.x + caustic.uCaustic.y * depth;
  // Its brightest lines held to about uCausticFade.z times as bright as even light.
  let gathered = inverseSqrt(det * det + soft * soft);
  return gathered / (1.0 + gathered / caustic.uCausticFade.z) / causticMean(depth, dropped);
}

// How much of the sun's light reaches the floor at world xz, `depth` m under the surface,
// for a pixel `footprint` m wide, the sun's way under the water `sunBelow` (up, unit): around 1.
fn causticLight(xz: vec2f, depth: f32, footprint: f32, sunBelow: vec3f) -> f32 {
  let deepest = caustic.uCaustic.w;
  let dropped = causticDropped(footprint);
  let shows = caustic.uCausticWander.z * (1.0 - smoothstep(0.75 * deepest, deepest, depth)) * step(0.0, depth);
  var light = 1.0;
  if (shows > 0.0 && dropped < f32(CAUSTIC_WAVES)) {
    // Where the light that lights it went in.
    let entered = xz + depth * sunBelow.xz / max(sunBelow.y, 0.1);
    light = 1.0 + shows * (causticAt(entered, depth, frame.uWaveSeconds, dropped) - 1.0);
  }
  return light;
}
