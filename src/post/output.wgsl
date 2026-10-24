// The output pass: the HDR scene to the screen. Reads the HDR target, whose
// compression it undoes (chunks/scene-output.wgsl), or the linear result of
// the composite and post chain (frame.js); tonemaps, converts to sRGB and dithers.

#include "chunks/fullscreen.wgsl"
#include "chunks/scene-output.wgsl"
#include "tonemap.wgsl"

struct Output {
  uCompressed: u32,
  uHeight: f32, // of the target, in pixels
}

@group(1) @binding(0) var<uniform> output: Output;
@group(1) @binding(1) var uScene: texture_2d<f32>;

// Per-channel hash in [0, 1) ("Hash without Sine", Dave Hoskins).
fn hash32(p: vec2f) -> vec3f {
  var p3 = fract(vec3f(p.xyx) * vec3f(0.1031, 0.1030, 0.0973));
  p3 += dot(p3, p3.yxz + 33.33);
  return fract((p3.xxy + p3.yzz) * p3.zyx);
}

// sRGB encoding, as three.js's sRGBTransferOETF.
fn sRGBTransferOETF(value: vec4f) -> vec4f {
  return vec4f(mix(pow(value.rgb, vec3f(0.41666)) * 1.055 - vec3f(0.055), value.rgb * 12.92, vec3f(value.rgb <= vec3f(0.0031308))), value.a);
}

@fragment
fn fragmentMain(in: Fullscreen) -> @location(0) vec4f {
  let stored = textureLoad(uScene, vec2i(in.position.xy), 0).rgb;
  var radiance = stored;
  if (output.uCompressed != 0u) {
    radiance = sceneRadiance(stored);
  }
  var color = sRGBTransferOETF(vec4f(tonemap(radiance), 1.0));

  // Triangular noise of +-1 step in the 8-bit output hides banding in smooth
  // gradients. Fixed per pixel, so a capture renders the same every time; by
  // the pixel counted from the bottom, as WebGL counted.
  let at = vec2f(in.position.x, output.uHeight - in.position.y);
  let noise = hash32(at) + hash32(at + 71.3) - 1.0;
  color = vec4f(color.rgb + noise / 255.0, color.a);
  return color;
}
