// Tool fixture: the drawn height at each point of uPoints (world x, z and the
// level to read from per texel), one per output texel. uOffset shifts every
// point, a deliberate mistake.

#include "chunks/terrain.glsl"

uniform sampler2D uPoints;
uniform float uOffset;

void main() {
  vec3 point = texelFetch(uPoints, ivec2(gl_FragCoord.xy), 0).xyz;
  gl_FragColor = vec4(terrainHeight(terrainCove(point.xy + uOffset), int(point.z)), 0.0, 0.0, 1.0);
}
