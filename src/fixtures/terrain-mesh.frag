// Tool fixture (terrain.js): for each case of uCases, one per output texel (a
// point's a, o and a camera's a, o, in the cove's frame), the terrain mesh's
// own height at the point as drawn for that camera.

#include "chunks/terrain-mesh.glsl"

uniform highp sampler2D uCases;

void main() {
  vec4 c = texelFetch(uCases, ivec2(gl_FragCoord.xy), 0);
  gl_FragColor = vec4(terrainMeshHeight(c.xy, c.zw), 0.0, 0.0, 1.0);
}
