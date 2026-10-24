// Fixture: see surfaces.js. Sand at one wetness, or with SURFACE_ROCK rock,
// or with SURFACE_GREEN the green at one band and lush, lit as the terrain
// lights them (world/terrain.frag). The sand's height above
// the sea, for the swash marks, rises a metre in ten across the fixture; the
// rock's is its height above the fixture's ground, plus uAboveSea.

#include "chunks/scene-output.glsl"
#include "chunks/lighting.glsl"
#include "chunks/wet.glsl"
#include "chunks/sand.glsl"
#include "chunks/rock.glsl"
#include "chunks/green.glsl"

uniform float uWetness;
uniform vec3 uDrySand; // linear albedos
uniform vec3 uWetSand;
uniform float uAboveSea; // m, where the fixture's sideways coordinate is 0
uniform vec2 uAcross; // world xz, unit: which way it rises
uniform vec3 uRock;
uniform float uGround; // world y
uniform vec3 uGreen; // band, lush, sandy

centroid varying vec3 vWorldPos;
varying vec3 vNormal;

void main() {
  vec3 dPdx = dFdx(vWorldPos);
  vec3 dPdy = dFdy(vWorldPos);
  vec3 view = normalize(cameraPosition - vWorldPos);
#ifdef SURFACE_ROCK
  float aboveSea = uAboveSea + vWorldPos.y - uGround;
  Rock r = rock(vWorldPos, aboveSea, groundWet(vWorldPos.xz, aboveSea, fwidth(aboveSea)), normalize(vNormal), view, uRock, dPdx, dPdy);
  float kernel = specularKernel(r.normal);
  vec3 radiance = r.albedo / PI * (sunLight(vWorldPos, r.normal) + skyIrradiance(vWorldPos, r.normal));
  radiance += rockShine(r, vWorldPos, r.normal, view, kernel);
#elif defined(SURFACE_GREEN)
  Green g = green(vWorldPos, normalize(vNormal), uGreen.x, uGreen.y, uGreen.z, uDrySand, dPdx.xz, dPdy.xz);
  vec3 radiance = g.albedo / PI * (sunLight(vWorldPos, g.normal) + skyIrradiance(vWorldPos, g.normal));
#else
  float aboveSea = uAboveSea + 0.1 * dot(vWorldPos.xz, uAcross);
  Sand s = sand(vWorldPos, aboveSea, normalize(vNormal), wetAt(uWetness), uDrySand, uWetSand, dPdx.xz, dPdy.xz);
  float kernel = specularKernel(s.normal);
  vec3 radiance = sandDiffuse(s, s.normal, view) / PI * (sunLight(vWorldPos, s.normal) + skyIrradiance(vWorldPos, s.normal));
  radiance += sandShine(s, vWorldPos, s.normal, view, kernel);
#endif
  gl_FragColor = sceneOutput(aerialPerspective(radiance, vWorldPos), 1.0);
}
