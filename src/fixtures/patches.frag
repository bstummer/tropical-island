// Fixture: see patches.js. The green's patches (chunks/patches.glsl) at each
// point of uPoints (world x, z), one per output texel, shifted by uOffset (m),
// a deliberate mistake.

#include "chunks/patches.glsl"

uniform sampler2D uPoints;
uniform float uOffset;

void main() {
  vec2 xz = texelFetch(uPoints, ivec2(gl_FragCoord.xy), 0).xy;
  gl_FragColor = vec4(greenPatches(xz + uOffset).x, 0.0, 0.0, 1.0);
}
