// How wet the ground is (PLAN.md Stage 4): the one input for every surface
// the sea wets (sand, rock, the rocks), which Stage 7's waves will drive.
// Until then it follows the height above the sea (world/albedo.js
// sandWetness is its twin), and so does `washed`, where the waves reach,
// which shapes the sand (ripples above it, swash marks in it) however wet the
// sand is now: sand drying in the sun doesn't grow ripples. Its edges are as
// soft as a pixel is tall (width: how much the height above the sea changes
// across it), so far away wet meets dry without stair-steps.

#include "noise.wgsl"

struct WetUniforms {
  // m above the sea: a film below .x, wet and then damp up to the last
  // waves' reach at .y, where it steps down by .w, dry above .z
  uWet: vec4f,
}

@group(1) @binding(22) var<uniform> wetParams: WetUniforms;

struct Wet {
  wetness: f32, // 0 dry to 1 soaked, under water or a film of it
  film: f32, // how much of it a film of water covers: above the sea only
  washed: f32, // how much the waves wash over it, 1 at the sea to 0 above their reach
  reach: f32, // m: how much further up than elsewhere the waves reach here (wetReach), as its edge has it
}

// How much further up the beach than elsewhere the waves reach here, as a
// height above the sea (m): further over stretches of a hundred metres or so,
// so the wet band widens and narrows along the beach, and in lobes tens of
// metres across and tongues of a few, rounded at their tips and notched
// between, where single waves ran further; their edges fray. `width` (as
// groundWet's) leaves out the tongues and fraying once a pixel is too tall to
// hold them: far away, where the beach is seen at a slant, they would squeeze
// into streaks smeared sideways.
// m: the most wetReach can be, with room (tests/terrain-nodes.test.js REACH).
const WET_REACH: f32 = 0.35;

fn wetReach(xz: vec2f, width: f32) -> f32 {
  let stretch = 0.16 * gradientNoise(xz * 0.022 + vec2f(5.3, -5.3));
  let lobes = 0.06 * abs(gradientNoise(xz * 0.04 - 4.3)) - 0.02;
  let tongues = (0.07 * abs(gradientNoise(xz * 0.13 + 1.7)) - 0.02) * (1.0 - smoothstep(0.01, 0.04, width));
  let fray = 0.025 * gradientNoise(xz * 0.7 - 2.3) * (1.0 - smoothstep(0.004, 0.012, width));
  return stretch + lobes + tongues + fray;
}

// The ground at this wetness, as Stage 7 will set it: under a film of water
// from 0.75, washed as far as it is wet.
fn wetAt(wetness: f32) -> Wet {
  var w: Wet;
  w.wetness = wetness;
  w.film = smoothstep(0.75, 1.0, wetness);
  w.washed = wetness;
  w.reach = 0.0;
  return w;
}

fn wetLinear(a: f32, b: f32, x: f32) -> f32 {
  return clamp((x - a) / (b - a), 0.0, 1.0);
}

// The ground's wetness h m above the sea, the waves' reach taken out, its
// edges `width` soft: soaked under the film, wet, then damp up to the last
// waves' reach, where it steps down to a faint damp that dries away above.
fn wetProfile(h: f32, width: f32) -> f32 {
  let u = wetParams.uWet;
  let mid = mix(u.x, u.y, 0.6);
  let sharp = max(width, 0.004);
  return max(1.0 - 0.55 * wetLinear(u.x - width, mid + width, h) - (0.3 - u.w) * smoothstep(mid - width, u.y + width, h) - u.w * smoothstep(u.y - sharp, u.y + sharp, h) - 0.15 * smoothstep(u.y - width, u.z + width, h), 0.0);
}

// The ground's wetness at xz, aboveSea m above the sea. The waves washed
// further up than they reach now, at high tide: the beach's face is smooth a
// little way above the wet sand.
fn groundWet(xz: vec2f, aboveSea: f32, width: f32) -> Wet {
  // Above the waves' furthest reach the ground is dry: no need for its noise.
  if (aboveSea - width > wetParams.uWet.z + WET_REACH) {
    return wetAt(0.0);
  }
  let reach = wetReach(xz, width);
  let h = aboveSea - reach;
  let edge = max(width, 0.005);
  let overSea = smoothstep(-edge, edge, aboveSea);
  // Under the sea it is soaked, however tall a pixel far off is.
  var w = wetAt(max(wetProfile(h, width), 1.0 - overSea));
  w.reach = reach;
  w.washed = 1.0 - smoothstep(wetParams.uWet.y - 0.03 - width, wetParams.uWet.y + 0.06 + width, h);
  // Under the sea, the water's surface mirrors the sky, not the sand's.
  w.film *= overSea;
  return w;
}
