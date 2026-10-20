// The output pass: the HDR scene to the screen. Undoes the scene's compression
// (chunks/scene-output.glsl), tonemaps, converts to sRGB and dithers.

#include "chunks/scene-output.glsl"
#include "tonemap.glsl"

uniform sampler2D uScene;

varying vec2 vUv;

// Per-channel hash in [0, 1) ("Hash without Sine", Dave Hoskins).
vec3 hash32(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * vec3(0.1031, 0.1030, 0.0973));
  p3 += dot(p3, p3.yxz + 33.33);
  return fract((p3.xxy + p3.yzz) * p3.zyx);
}

void main() {
  gl_FragColor = vec4(tonemap(sceneRadiance(texture2D(uScene, vUv).rgb)), 1.0);
  #include <colorspace_fragment>

  // Triangular noise of +-1 step in the 8-bit output hides banding in smooth
  // gradients. Fixed per pixel, so a capture renders the same every time.
  vec3 noise = hash32(gl_FragCoord.xy) + hash32(gl_FragCoord.xy + 71.3) - 1.0;
  gl_FragColor.rgb += noise / 255.0;
}
