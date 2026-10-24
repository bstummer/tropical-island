// How wet the ground is (PLAN.md Stage 4): the one input for every surface
// the sea wets (sand, rock, the rocks), which Stage 7's waves will drive.
// Until then it follows the height above the sea (world/albedo.js
// sandWetness is its twin), and so does `washed`, where the waves reach,
// which shapes the sand (ripples above it, swash marks in it) however wet the
// sand is now: sand drying in the sun doesn't grow ripples. Its edges are as
// soft as a pixel is tall (width: how much the height above the sea changes
// across it), so far away wet meets dry without stair-steps.

#include "noise.glsl"

uniform vec3 uWet; // m above the sea: a film below .x, half wet at .y, dry above .z

struct Wet {
  float wetness; // 0 dry to 1 soaked, under water or a film of it
  float film; // how much of it a film of water covers: above the sea only
  float washed; // how much the waves wash over it, 1 at the sea to 0 above their reach
};

// How much further up the beach than elsewhere the waves reach here, as a
// height above the sea (m): in arcs tens of metres across, and raggedly, so
// the wet sand's edge wanders.
float wetReach(vec2 xz) {
  return 0.07 * (1.0 - 2.0 * abs(gradientNoise(xz * 0.06 + 1.7))) + 0.03 * gradientNoise(xz * 0.4 - 2.3);
}

// The ground at this wetness, as Stage 7 will set it: under a film of water
// from 0.75, washed as far as it is wet.
Wet wetAt(float wetness) {
  Wet w;
  w.wetness = wetness;
  w.film = smoothstep(0.75, 1.0, wetness);
  w.washed = wetness;
  return w;
}

float wetLinear(float a, float b, float x) {
  return clamp((x - a) / (b - a), 0.0, 1.0);
}

// The ground's wetness at xz, aboveSea m above the sea.
Wet groundWet(vec2 xz, float aboveSea, float width) {
  float h = aboveSea - wetReach(xz);
  Wet w = wetAt(1.0 - 0.65 * wetLinear(uWet.x - width, uWet.y + width, h) - 0.35 * smoothstep(uWet.y - width, uWet.z + width, h));
  // Under the sea, the water's surface mirrors the sky, not the sand's.
  float edge = max(width, 0.005);
  w.film *= smoothstep(-edge, edge, aboveSea);
  return w;
}
