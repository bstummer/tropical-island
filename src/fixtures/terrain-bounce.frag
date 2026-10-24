// Tool fixture (terrain.js): at each point of uPoints (world x, z), one per
// output texel, the ground's albedo the light from below reads there
// (chunks/lighting.glsl groundAlbedo).

#include "chunks/lighting.glsl"

uniform highp sampler2D uPoints;

void main() {
  vec2 xz = texelFetch(uPoints, ivec2(gl_FragCoord.xy), 0).xy;
  gl_FragColor = vec4(groundAlbedo(vec3(xz.x, 0.0, xz.y)), 1.0);
}
