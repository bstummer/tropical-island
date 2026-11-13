// How wet the waves leave the ground (chunks/wet.wgsl's Wet), for the terrain and the
// rocks: what the sets did over minutes, as high as a full wave runs up this beach
// (groundDamp), with what the last waves did on top (swash.wgsl). Needs terrainCove().

#include "/chunks/wet.wgsl"
#include "swash.wgsl"

// How wet the ground is at world xz, aboveSea m above the still sea; its film, how much
// of it the sheet or the glassy film it leaves covers, which the water draws. width: how
// much aboveSea changes across the pixel.
fn groundWet(xz: vec2f, aboveSea: f32, width: f32) -> Wet {
  let s = swashAt(xz, aboveSea, seaAt(xz).x, seaShoreAt(xz).xy, width);
  // This beach's run-up per the one the sets' wetness is set for.
  let scale = max(s.runs / swash.uSwashRun.x, 0.05);
  var w = groundDamp(xz, aboveSea / scale, width / scale);
  w.wetness = max(w.wetness, s.soaked);
  w.film = s.film;
  // The sets' reach on this beach, m above the sea, as chunks/sand.wgsl reads it.
  w.reach = (wetParams.uWet.y + w.reach) * scale - wetParams.uWet.y;
  return w;
}
