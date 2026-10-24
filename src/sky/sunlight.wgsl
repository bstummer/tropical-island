// The sunlight table (atmosphere.js; chunks/sunlight.wgsl has the mapping): the
// sun's illuminance on a surface facing it, by the height above the sea, for
// the current sun. Rendered when the time changes.

#include "chunks/fullscreen.wgsl"
#include "chunks/frame-values.wgsl"
#include "atmosphere.wgsl"
#include "chunks/sunlight.wgsl"

struct SunlightTable {
  uSunMu: f32,
}

@group(1) @binding(0) var<uniform> table: SunlightTable;

override STEPS: i32 = 64; // config.sky.samples

@fragment
fn fragmentMain(in: Fullscreen) -> @location(0) vec4f {
  return vec4f(sunAtHeight(sunlightHeight(in.position.x / frame.uSunlightSize), table.uSunMu, STEPS), 1.0);
}
