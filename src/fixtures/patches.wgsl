// Fixture: see patches.js. The green's patches (chunks/patches.wgsl) at each
// point of uPoints (world x, z), one per output texel, shifted by uOffset (m),
// a deliberate mistake.

#include "chunks/fullscreen.wgsl"
#include "chunks/patches.wgsl"

struct PatchesCheck {
  uOffset: f32,
}

@group(1) @binding(0) var<uniform> check: PatchesCheck;
@group(1) @binding(1) var uPoints: texture_2d<f32>;

@fragment
fn fragmentMain(in: Fullscreen) -> @location(0) vec4f {
  let xz = textureLoad(uPoints, vec2i(in.position.xy), 0).xy;
  return vec4f(greenPatches(xz + check.uOffset).x, 0.0, 0.0, 1.0);
}
