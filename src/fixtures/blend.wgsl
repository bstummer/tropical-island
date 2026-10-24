// Tool fixture: see blend.js. One shader for the bands, the cards, their
// references and the bar, so all of them agree on the bands.

#include "card.wgsl"
#include "chunks/scene-output.wgsl"

struct Blend {
  uHeight: f32, // of the drawing buffer, in pixels
  uBands: f32,
  uMode: i32, // 0: the bands, 1: a translucent card, 2: a reference, 3: an after-opaque card, 4: the bar
  uColor: vec3f,
  uAlpha: f32,
}

@group(1) @binding(0) var<uniform> blend: Blend;
@group(1) @binding(1) var uOpaque: texture_2d<f32>; // the opaque scene, for the after-opaque card

// Bands by screen height, the same behind a card as beside it: from 0.02 to
// 1300, a factor of 4 apart. Counted from the bottom, as in WebGL.
fn band(at: vec4f) -> vec3f {
  let k = floor((blend.uHeight - at.y) / blend.uHeight * blend.uBands);
  return vec3f(1.0, 0.92, 0.85) * 0.02 * pow(4.0, k);
}

@fragment
fn fragmentMain(in: Varyings) -> @location(0) vec4f {
  if (blend.uMode == 0) {
    return sceneOutput(band(in.position), 1.0);
  } else if (blend.uMode == 1) {
    return sceneOutput(blend.uColor, blend.uAlpha);
  } else if (blend.uMode == 2) {
    return sceneOutput(band(in.position) * (1.0 - blend.uAlpha) + blend.uColor * blend.uAlpha, 1.0);
  } else if (blend.uMode == 3) {
    let behind = sceneRadiance(textureLoad(uOpaque, vec2i(in.position.xy), 0).rgb) / frame.uExposure;
    return sceneOutput(behind * (1.0 - blend.uAlpha) + blend.uColor * blend.uAlpha, 1.0);
  }
  return sceneOutput(blend.uColor, 1.0);
}
