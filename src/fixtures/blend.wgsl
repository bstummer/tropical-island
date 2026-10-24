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
@group(1) @binding(2) var uOpaqueDepth: texture_depth_2d; // and its depth

const BANDS_DISTANCE: f32 = 20.0; // m, blend.js's
const MISSED = vec3f(1000.0, 0.0, 1000.0); // bright magenta: far off any reference

// How far the opaque scene lies at this pixel, along the view (m), from its
// reversed depth: z = d / w - c, with c and d from the projection.
fn opaqueDistance(at: vec4f) -> f32 {
  let z = textureLoad(uOpaqueDepth, vec2i(at.xy), 0);
  return frame.projectionMatrix[3][2] / (z + frame.projectionMatrix[2][2]);
}

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
    // Where the opaque scene's depth puts it beyond the bands, where nothing
    // stands (a depth never resolved reads as the far plane), the card shows it.
    // Nearer is the bar's edge, whose first sample may be the bar.
    if (opaqueDistance(in.position) > BANDS_DISTANCE + 0.1) {
      return sceneOutput(MISSED, 1.0);
    }
    let behind = sceneRadiance(textureLoad(uOpaque, vec2i(in.position.xy), 0).rgb) / frame.uExposure;
    return sceneOutput(behind * (1.0 - blend.uAlpha) + blend.uColor * blend.uAlpha, 1.0);
  }
  return sceneOutput(blend.uColor, 1.0);
}
