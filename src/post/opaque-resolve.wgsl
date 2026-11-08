// The opaque scene resolved for after-opaque materials to read (frame.js
// `opaque`): its colour as the mean of each pixel's samples, each weighted by
// its alpha, and their alpha; and its depth as depth-resolve.wgsl takes it, the
// first sample. Weighted, as a sample's alpha says how much of it counts (the
// ground just under the sea draws its colour with none, world/terrain.wgsl):
// colour / alpha is then what the counting samples hold, whatever lay beside them.

#include "chunks/fullscreen.wgsl"

@group(1) @binding(0) var uDepth: texture_depth_multisampled_2d;
@group(1) @binding(1) var uSamples: texture_multisampled_2d<f32>;

struct Resolved {
  @location(0) color: vec4f,
  @builtin(frag_depth) depth: f32,
}

@fragment
fn fragmentMain(in: Fullscreen) -> Resolved {
  let at = vec2i(in.position.xy);
  let count = textureNumSamples(uSamples);
  var sum = vec4f(0.0);
  for (var i = 0u; i < count; i++) {
    let c = textureLoad(uSamples, at, i);
    sum += vec4f(c.rgb * c.a, c.a);
  }
  return Resolved(sum / f32(count), textureLoad(uDepth, at, 0));
}
