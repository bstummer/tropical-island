// Tool fixture: at each point of uPoints (world x, z and the level to read
// from per texel), one per output texel, by uRead: 0 the drawn height, 1 the
// ground at its finest (sand, rock, band, reef's offset), 2 how lush the green
// is there and how sandy the soil. uOffset shifts every point, a deliberate mistake.

#include "chunks/terrain.glsl"

uniform sampler2D uPoints;
uniform float uOffset;
uniform int uRead;

void main() {
  vec3 point = texelFetch(uPoints, ivec2(gl_FragCoord.xy), 0).xyz;
  vec2 ao = terrainCove(point.xy + uOffset);
  if (uRead > 0) {
    vec4 info;
    vec4 cover;
    terrainGround(ao, vec2(0.0), vec2(0.0), info, cover);
    gl_FragColor = uRead == 1 ? vec4(cover.xy, info.zw) : vec4(cover.zw, 0.0, 1.0);
  } else {
    gl_FragColor = vec4(terrainHeight(ao, int(point.z)), 0.0, 0.0, 1.0);
  }
}
