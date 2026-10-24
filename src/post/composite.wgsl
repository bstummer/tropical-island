// The composite (frame.js): the translucent layer over the scene, in linear
// light. The scene is compressed (chunks/scene-output.wgsl); the layer holds
// premultiplied linear colour and, in alpha, the share of the scene that still
// shows through it. Writes linear, exposed radiance for the post chain.

#include "chunks/fullscreen.wgsl"
#include "chunks/scene-output.wgsl"

struct Composite {
  uHasLayer: u32,
}

@group(1) @binding(0) var<uniform> composite: Composite;
@group(1) @binding(1) var uScene: texture_2d<f32>;
@group(1) @binding(2) var uLayer: texture_2d<f32>;

@fragment
fn fragmentMain(in: Fullscreen) -> @location(0) vec4f {
  let at = vec2i(in.position.xy);
  let scene = sceneRadiance(textureLoad(uScene, at, 0).rgb);
  var layer = vec4f(0.0, 0.0, 0.0, 1.0);
  if (composite.uHasLayer != 0u) {
    layer = textureLoad(uLayer, at, 0);
  }
  return vec4f(scene * layer.a + layer.rgb, 1.0);
}
