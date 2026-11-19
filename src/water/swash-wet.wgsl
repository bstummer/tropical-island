// How wet the waves leave the ground (chunks/wet.wgsl's Wet), for the terrain and the
// rocks: what the sets did over minutes, as high as the highest wave runs up this beach
// (groundDamp), with what the last waves did on top (swash.wgsl). Needs terrainCove().

#include "/chunks/wet.wgsl"
#include "swash.wgsl"

// How wet the ground is at world xz, aboveSea m above the still sea; its film, how much
// of it the sheet or the glassy film it leaves covers, which the water draws. width: how
// much aboveSea changes across the pixel.
fn groundWet(xz: vec2f, aboveSea: f32, width: f32) -> Wet {
  if (groundDry(aboveSea, width)) {
    return wetAt(0.0);
  }
  if (groundUnder(aboveSea, width)) {
    return groundAlwaysUnder();
  }
  return groundWetFrom(swashAt(xz, aboveSea, seaAt(xz).x, seaShoreAt(xz).xy, width), xz, aboveSea, width);
}

// The same where the beach's water's place is known (swashPlace: the terrain's vertices work it
// out, as it changes only over metres), but for the edge's fray, finer than they lie apart.
fn groundWetAt(place: SwashPlace, xz: vec2f, aboveSea: f32, width: f32) -> Wet {
  if (groundDry(aboveSea, width)) {
    return wetAt(0.0);
  }
  if (groundUnder(aboveSea, width)) {
    return groundAlwaysUnder();
  }
  var here = place;
  here.fray = seededNoise(terrainCove(xz) / swash.uSwashSheet.w, SWASH_FRAY_SEED);
  return groundWetFrom(swashFrom(here, aboveSea, width, 0.0, 0.0), xz, aboveSea, width);
}

// Higher than the sets wet any beach, with the lobes of their reach, it is dry.
fn groundDry(aboveSea: f32, width: f32) -> bool {
  return aboveSea - width > (wetParams.uWet.z + WET_REACH) * swash.uSwashRun.x * swash.uSwashLook.z / wetParams.uWet.z;
}

// Lower than any wave draws the sea down it is always under water.
fn groundUnder(aboveSea: f32, width: f32) -> bool {
  return aboveSea + width < -swash.uSwashTime.z * swash.uSwashRun.x;
}

fn groundAlwaysUnder() -> Wet {
  var under = wetAt(1.0);
  under.film = 1.0;
  return under;
}

// How wet the beach's water `s` (swash.wgsl) leaves the ground at world xz.
fn groundWetFrom(s: Swash, xz: vec2f, aboveSea: f32, width: f32) -> Wet {
  // The sets have wetted the beach as high as its highest wave runs: so high is the sets' wetness's dry top.
  let scale = max(s.runs * swash.uSwashLook.z / wetParams.uWet.z, 0.01);
  var w = groundDamp(xz, aboveSea / scale, width / scale);
  w.wetness = max(w.wetness, s.soaked);
  w.film = s.film;
  // The sets' reach on this beach, m above the sea, as chunks/sand.wgsl reads it.
  w.reach = (wetParams.uWet.y + w.reach) * scale - wetParams.uWet.y;
  return w;
}
