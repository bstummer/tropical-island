// The island as drawn: the nested grids of world/heightmap.js, which
// world/terrain.js uploads. terrainHeight() samples them exactly as
// heightmap.js heightAtCove() does, and terrainGround() as groundAtCove(), so
// the drawn ground is where and what JS thinks it is (the screenshot tool's
// terrain check compares them). Positions are in
// the cove's frame (world/island.js): a along the beach, o out to sea.

#define TERRAIN_LEVELS 4

uniform highp sampler2DArray uTerrainHeight; // per level: the height at each sample
uniform mediump sampler2DArray uTerrainInfo; // slope along a and o, the ground's band, the reef's offset
uniform lowp sampler2DArray uTerrainGround; // how much of the ground is sand, and rock; how lush the green; how sandy the soil
uniform vec4 uTerrainLevels[TERRAIN_LEVELS]; // per level: origin a, o; texel
uniform vec4 uTerrainFrame; // a = dot(xz, .xy), o = dot(xz, .zw)
uniform float uTerrainSamples;
uniform float uTerrainBlend;
uniform float uTerrainReady; // 0 until the grids are built: everything is deep sea

const float TERRAIN_DEEP = -1000.0;

vec2 terrainCove(vec2 xz) {
  return vec2(dot(xz, uTerrainFrame.xy), dot(xz, uTerrainFrame.zw));
}

// The frame is orthonormal: its inverse is its transpose.
vec2 terrainWorld(vec2 ao) {
  return ao.x * uTerrainFrame.xy + ao.y * uTerrainFrame.zw;
}

// A slope along a and o as one along world x and z.
vec2 terrainWorldSlope(vec2 slope) {
  return vec2(dot(slope, vec2(uTerrainFrame.x, uTerrainFrame.z)), dot(slope, vec2(uTerrainFrame.y, uTerrainFrame.w)));
}

// Position in level k's samples.
vec2 terrainGrid(int k, vec2 ao) {
  return (ao - uTerrainLevels[k].xy) / uTerrainLevels[k].z;
}

// How much level k has its say: 1 well inside it, 0 over the last
// uTerrainBlend samples before its edge.
float terrainWeight(int k, vec2 ao) {
  vec2 f = terrainGrid(k, ao);
  float last = uTerrainSamples - 1.0;
  float inside = min(min(f.x, f.y), min(last - f.x, last - f.y)) - 1.0;
  return clamp(inside / uTerrainBlend, 0.0, 1.0);
}

float terrainBilinear(int k, vec2 ao) {
  float last = uTerrainSamples - 1.0;
  vec2 f = clamp(terrainGrid(k, ao), 0.0, last);
  vec2 i = min(floor(f), last - 1.0);
  vec2 t = f - i;
  ivec3 p = ivec3(int(i.x), int(i.y), k);
  float h00 = texelFetch(uTerrainHeight, p, 0).r;
  float h10 = texelFetch(uTerrainHeight, p + ivec3(1, 0, 0), 0).r;
  float h01 = texelFetch(uTerrainHeight, p + ivec3(0, 1, 0), 0).r;
  float h11 = texelFetch(uTerrainHeight, p + ivec3(1, 1, 0), 0).r;
  return mix(mix(h00, h10, t.x), mix(h01, h11, t.x), t.y);
}

// The drawn height at ao, from level `from` or coarser.
float terrainHeight(vec2 ao, int from) {
  if (uTerrainReady < 0.5) return TERRAIN_DEEP;
  for (int k = from; k < TERRAIN_LEVELS - 1; k++) {
    float w = terrainWeight(k, ao);
    if (w <= 0.0) continue;
    float h = terrainBilinear(k, ao);
    if (w >= 1.0) return h;
    return mix(terrainBilinear(k + 1, ao), h, w);
  }
  return terrainBilinear(TERRAIN_LEVELS - 1, ao);
}

// The slopes and the ground at ao (heightmap.js groundAtCove, world/island.js
// groundOf and lushOf), filtered over a pixel's footprint (dx, dy: the
// derivatives of ao), from the finest level there. info: slope along a and o,
// band, reef's offset; cover: sand, rock, how lush the green is, how sandy the soil.
void terrainGround(vec2 ao, vec2 dx, vec2 dy, out vec4 info, out vec4 cover) {
  info = vec4(0.0);
  cover = vec4(0.0);
  if (uTerrainReady < 0.5) return;
  float footprint = sqrt(max(dot(dx, dx), dot(dy, dy)));
  float left = 1.0; // the share still to fill, finest level first
  for (int k = 0; k < TERRAIN_LEVELS; k++) {
    float w = k == TERRAIN_LEVELS - 1 ? 1.0 : terrainWeight(k, ao);
    if (w <= 0.0) continue;
    vec3 uvw = vec3((terrainGrid(k, ao) + 0.5) / uTerrainSamples, float(k));
    float lod = log2(max(footprint / uTerrainLevels[k].z, 1e-6));
    info += left * w * textureLod(uTerrainInfo, uvw, lod);
    cover += left * w * textureLod(uTerrainGround, uvw, lod);
    left *= 1.0 - w;
    if (left <= 0.0) break;
  }
}
