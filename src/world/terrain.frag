// The terrain, lit by the shared lighting. Its normal comes from the finest
// grid's slopes, filtered over the pixel's footprint, so distant slopes keep
// their detail without sparkling. Until Stage 4's ground surfaces it is
// plain colours by zone, blended softly: sand by the water, rock where it is
// steep or the shore is rocky, greens inland.

#include "chunks/scene-output.glsl"
#include "chunks/lighting.glsl"
#include "chunks/terrain.glsl"
#include "chunks/planet.glsl"

uniform vec3 uDrySand; // linear, as all the colours here
uniform vec3 uWetSand;
uniform vec3 uSeabed;
uniform vec3 uScrub;
uniform vec3 uGreen;
uniform vec3 uJungle;
uniform vec3 uRock;
uniform vec4 uBands; // metres inland: wet sand, the shore's band, scrub, the palm belt's end
uniform vec2 uRockSlope; // slopes over which ground turns to rock

centroid varying vec3 vWorldPos;

void main() {
  vec2 ao = terrainCove(vWorldPos.xz);
  vec2 dx = dFdx(ao); // before any branch: derivatives need every pixel around
  vec2 dy = dFdy(ao);

  // TEMPORARY, with world/placeholder.js: its opaque water hides the seabed, so
  // seabed wholly under it across the pixel needn't be shaded (a fifth of a
  // SwiftShader frame). Stage 6's water shows the seabed: remove this then.
  float aboveSea = vWorldPos.y + planetDrop(vWorldPos.xz);
  if (aboveSea + 2.0 * fwidth(aboveSea) < -0.1) {
    gl_FragColor = sceneOutput(vec3(0.0), 1.0);
    return;
  }

  vec4 info = terrainInfo(ao, dx, dy);
  vec2 slope = terrainWorldSlope(info.xy);
  vec3 n = normalize(vec3(-slope.x, 1.0, -slope.y));
  float coast = info.z;
  float sandy = smoothstep(0.4, 0.6, info.w);

  float inland = smoothstep(uBands.y - 4.0, uBands.y + 4.0, coast);
  vec3 sand = mix(uWetSand, uDrySand, smoothstep(uBands.x - 3.0, uBands.x + 3.0, coast));
  vec3 green = mix(uScrub, uGreen, smoothstep(uBands.z - 5.0, uBands.z + 5.0, coast));
  green = mix(green, uJungle, smoothstep(uBands.w - 15.0, uBands.w + 15.0, coast));
  vec3 shore = mix(uRock, sand, sandy);
  vec3 albedo = mix(shore, green, inland);
  albedo = mix(albedo, uRock, smoothstep(uRockSlope.x, uRockSlope.y, length(slope)));
  albedo = mix(albedo, uSeabed, (1.0 - smoothstep(-0.5, 0.5, coast)) * sandy);

  vec3 radiance = albedo / PI * (sunLight(vWorldPos, n) + skyIrradiance(vWorldPos, n));
  gl_FragColor = sceneOutput(aerialPerspective(radiance, vWorldPos), 1.0);
}
