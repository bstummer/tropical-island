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
  uWet: vec3f, // m above the sea: a film below .x, half wet at .y, dry above .z
}

@group(1) @binding(22) var<uniform> wetParams: WetUniforms;

struct Wet {
  wetness: f32, // 0 dry to 1 soaked, under water or a film of it
  film: f32, // how much of it a film of water covers: above the sea only
  washed: f32, // how much the waves wash over it, 1 at the sea to 0 above their reach
}

// How much further up the beach than elsewhere the waves reach here, as a
// height above the sea (m): in arcs tens of metres across, and raggedly, so
// the wet sand's edge wanders.
fn wetReach(xz: vec2f) -> f32 {
  return 0.07 * (1.0 - 2.0 * abs(gradientNoise(xz * 0.06 + 1.7))) + 0.03 * gradientNoise(xz * 0.4 - 2.3);
}

// The ground at this wetness, as Stage 7 will set it: under a film of water
// from 0.75, washed as far as it is wet.
fn wetAt(wetness: f32) -> Wet {
  var w: Wet;
  w.wetness = wetness;
  w.film = smoothstep(0.75, 1.0, wetness);
  w.washed = wetness;
  return w;
}

fn wetLinear(a: f32, b: f32, x: f32) -> f32 {
  return clamp((x - a) / (b - a), 0.0, 1.0);
}

// The ground's wetness at xz, aboveSea m above the sea.
fn groundWet(xz: vec2f, aboveSea: f32, width: f32) -> Wet {
  let h = aboveSea - wetReach(xz);
  var w = wetAt(1.0 - 0.65 * wetLinear(wetParams.uWet.x - width, wetParams.uWet.y + width, h) - 0.35 * smoothstep(wetParams.uWet.y - width, wetParams.uWet.z + width, h));
  // Under the sea, the water's surface mirrors the sky, not the sand's.
  let edge = max(width, 0.005);
  w.film *= smoothstep(-edge, edge, aboveSea);
  return w;
}
