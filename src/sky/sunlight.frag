// The sunlight table (atmosphere.js; chunks/sunlight.glsl has the mapping): the
// sun's illuminance on a surface facing it, by the height above the sea, for
// the current sun. Rendered when the time changes.

#include "atmosphere.glsl"
#include "chunks/sunlight.glsl"

uniform float uSunMu;

// STEPS: config.sky.samples

void main() {
  gl_FragColor = vec4(sunAtHeight(sunlightHeight(gl_FragCoord.x / uSunlightSize), uSunMu, STEPS), 1.0);
}
