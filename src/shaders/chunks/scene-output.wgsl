// The end of every scene material's fragment shader:
//
//   return sceneOutput(radiance, alpha);
//
// `radiance` is linear HDR colour. sceneOutput applies the frame's exposure and
// compresses the result into [0, 1) with c / (1 + max(c)). MSAA then averages
// each pixel's samples in this compressed space, which is close to how they
// look after tonemapping: a thin dark frond against a bright sky keeps its
// anti-aliased edge instead of being eaten by the sky's huge values.
// Passes that read the HDR target undo the compression with sceneRadiance().
//
// Translucent materials (frame.translucent(), which sets SCENE_TRANSLUCENT)
// draw into a layer of their own that blends in linear light: there sceneOutput
// returns exposed radiance premultiplied by alpha, the share of the pixel the
// material covers.

#include "frame.wgsl"

override SCENE_TRANSLUCENT: bool = false;

fn sceneOutput(radiance: vec3f, alpha: f32) -> vec4f {
  let c = max(radiance * frame.uExposure, vec3f(0.0));
  if (SCENE_TRANSLUCENT) {
    return vec4f(c * alpha, alpha);
  }
  return vec4f(c / (1.0 + max(c.r, max(c.g, c.b))), alpha);
}

// Exposed linear radiance from a value stored by sceneOutput(). Half floats
// can't get closer to 1 than this floor allows, so it caps at about 2048.
fn sceneRadiance(stored: vec3f) -> vec3f {
  return stored / max(1.0 - max(stored.r, max(stored.g, stored.b)), 1.0 / 2048.0);
}
