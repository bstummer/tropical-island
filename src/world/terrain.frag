// The terrain, lit by the shared lighting. Its normal comes from the finest
// grid's slopes, filtered over the pixel's footprint, so distant slopes keep
// their detail without sparkling. Its ground (world/island.js groundOf) is
// sand (chunks/sand.glsl) and rock (chunks/rock.glsl), as wet as the ground
// is (chunks/wet.glsl), and green inland (chunks/green.glsl), mixed as
// world/albedo.js mixes them; where sand meets green, the green's patches
// decide which is where. Pieces with no sand or no rock (world/terrain.js)
// leave out TERRAIN_SAND or TERRAIN_ROCK and draw what a far, filtered pixel
// still sees of it as its plain albedo, with wet sand's sheen where they
// reach down to it (TERRAIN_WET); pieces far from the camera leave out the
// sand's detail and the green's (GREEN_DETAIL).

#include "chunks/scene-output.glsl"
#include "chunks/lighting.glsl"
#include "chunks/terrain.glsl"
#include "chunks/wet.glsl"
#include "chunks/sand.glsl"
#include "chunks/rock.glsl"
#include "chunks/green.glsl"
#include "chunks/planet.glsl"

uniform vec3 uDrySand; // linear albedos, as all here
uniform vec3 uWetSand;
uniform vec3 uRock;

centroid varying vec3 vWorldPos;
varying vec3 vCentre; // for derivatives (terrain.vert)

void main() {
  vec2 ao = terrainCove(vWorldPos.xz);
  // Before any branch: derivatives need every pixel around.
  vec2 dx = dFdx(terrainCove(vCentre.xz));
  vec2 dy = dFdy(terrainCove(vCentre.xz));
  vec3 dPdx = dFdx(vCentre);
  vec3 dPdy = dFdy(vCentre);
  vec2 dpdx = dPdx.xz;
  vec2 dpdy = dPdy.xz;

  float aboveSea = vWorldPos.y + planetDrop(vWorldPos.xz);
  float tall = fwidth(vCentre.y + planetDrop(vCentre.xz)); // how much aboveSea changes across the pixel
  // TEMPORARY, with world/placeholder.js: its opaque water hides the seabed, so
  // seabed wholly under it across the pixel needn't be shaded (a fifth of a
  // SwiftShader frame). Stage 6's water shows the seabed: remove this then.
  bool hidden = aboveSea + 2.0 * tall < -0.1;

  vec4 info = vec4(0.0);
  vec4 cover = vec4(0.0);
  vec3 n = vec3(0.0, 1.0, 0.0);
  Sand s;
  s.albedo = vec3(0.0);
  s.roughness = 1.0;
  s.f0 = 0.02;
  s.film = 0.0;
  Rock r;
  r.albedo = vec3(0.0);
  r.roughness = 1.0;
  r.f0 = 0.04;
  r.height = 0.0;
  r.width = 0.0;
  r.relief = 0.0;
  Green gr;
  gr.albedo = vec3(0.0);
  gr.height = 0.5;
  gr.detail = 0.0;
  gr.width = 0.0;
  Wet w = wetAt(0.0);
  vec3 view = normalize(cameraPosition - vWorldPos);
  if (!hidden) {
    w = groundWet(vWorldPos.xz, aboveSea, tall);
    terrainGround(ao, dx, dy, info, cover);
    vec2 slope = terrainWorldSlope(info.xy);
    n = normalize(vec3(-slope.x, 1.0, -slope.y));
  }
  s.normal = n;
  r.normal = n;
  gr.normal = n;
  if (!hidden) {
    gr = green(vWorldPos, n, info.z, cover.z, cover.w, uDrySand, dpdx, dpdy);
    s = sandPlain(w, n, uDrySand, uWetSand);
#ifdef TERRAIN_SAND
    if (cover.x > 0.0) s = sand(vWorldPos, aboveSea, n, w, uDrySand, uWetSand, dpdx, dpdy);
#endif
#ifdef TERRAIN_ROCK
    if (cover.y > 0.0) r = rock(vWorldPos, aboveSea, w, n, view, uRock, dPdx, dPdy);
#else
    r.albedo = rockAlbedo(uRock, w);
#endif
  }
  float soft = 1.0 - cover.y; // sand and green
  if (cover.x > 0.0 && soft > cover.x) cover.x = soft * greenSandShare(cover.x / soft, gr);
#ifdef TERRAIN_ROCK
  // Where rock meets sand or green, the rest of the pixel keeps their proportions.
  if (cover.y > 0.0) {
    float share = rockShare(cover.y, r);
    float rest = 1.0 - cover.y;
    cover.x *= rest > 0.001 ? (1.0 - share) / rest : 0.0;
    cover.y = share;
  }
#endif
  // Each surface's own normal tilts its share of the pixel, where they meet.
  float rest = max(1.0 - cover.x - cover.y, 0.0);
  n = normalize(n + cover.x * (s.normal - n) + cover.y * (r.normal - n) + rest * (gr.normal - n));
  float kernel = specularKernel(n); // every pixel: it takes derivatives
  if (hidden) {
    gl_FragColor = sceneOutput(vec3(0.0), 1.0);
    return;
  }

  vec3 diffuse = cover.y * r.albedo + rest * gr.albedo;
  diffuse += cover.x * sandDiffuse(s, n, view);
  vec3 radiance = diffuse / PI * (sunLight(vWorldPos, n) + skyIrradiance(vWorldPos, n));
#if defined(TERRAIN_SAND) || defined(TERRAIN_WET)
  if (cover.x > 0.0) radiance += cover.x * sandShine(s, vWorldPos, n, view, kernel);
#endif
#ifdef TERRAIN_ROCK
  if (cover.y > 0.0) radiance += cover.y * rockShine(r, vWorldPos, n, view, kernel);
#endif
  gl_FragColor = sceneOutput(aerialPerspective(radiance, vWorldPos), 1.0);
}
