// How far each rock (world/rocks.js) moves up or down to stay sunk in the
// terrain's mesh as drawn this frame: as far as the mesh lies furthest below
// the finest height, which placement sank it into, at its place and round it
// as far as it spreads. A block of 3 x 3 texels per rock, one point each (the
// first its place, the rest round it), whose least is its offset: one call of
// the mesh's height per texel keeps the shader small.

#include "chunks/terrain-mesh.glsl"

uniform highp sampler2D uRockPlaces; // per rock: its place, a and o in the cove's frame; how far it spreads (m)
uniform vec2 uCamera; // the camera, a and o in the cove's frame

void main() {
  ivec2 texel = ivec2(gl_FragCoord.xy);
  int k = texel.x % 3 + 3 * (texel.y % 3);
  vec3 place = texelFetch(uRockPlaces, texel / 3, 0).xyz;
  float angle = float(k) * 0.7853982;
  vec2 ao = place.xy + (k == 0 ? 0.0 : place.z) * vec2(cos(angle), sin(angle));
  gl_FragColor = vec4(terrainMeshHeight(ao, uCamera) - terrainHeight(ao, 0), 0.0, 0.0, 1.0);
}
