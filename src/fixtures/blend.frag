// Tool fixture: see blend.js. One shader for the bands, the cards, their
// references and the bar, so all of them agree on the bands.

#include "chunks/scene-output.glsl"

uniform float uHeight; // of the drawing buffer, in pixels
uniform float uBands;
uniform int uMode; // 0: the bands, 1: a translucent card, 2: a reference, 3: an after-opaque card, 4: the bar
uniform vec3 uColor;
uniform float uAlpha;
uniform sampler2D uOpaque; // the opaque scene, for the after-opaque card

// Bands by screen height, the same behind a card as beside it: from 0.02 to 1300, a factor of 4 apart.
vec3 band() {
  float k = floor(gl_FragCoord.y / uHeight * uBands);
  return vec3(1.0, 0.92, 0.85) * 0.02 * pow(4.0, k);
}

void main() {
  if (uMode == 0) gl_FragColor = sceneOutput(band(), 1.0);
  else if (uMode == 1) gl_FragColor = sceneOutput(uColor, uAlpha);
  else if (uMode == 2) gl_FragColor = sceneOutput(band() * (1.0 - uAlpha) + uColor * uAlpha, 1.0);
  else if (uMode == 3) {
    vec3 behind = sceneRadiance(texelFetch(uOpaque, ivec2(gl_FragCoord.xy), 0).rgb) / uExposure;
    gl_FragColor = sceneOutput(behind * (1.0 - uAlpha) + uColor * uAlpha, 1.0);
  } else gl_FragColor = sceneOutput(uColor, 1.0);
}
