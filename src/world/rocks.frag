// A rock (world/rocks.js): the cliffs' surface (chunks/rock.glsl) on its
// facets, lit by the shared lighting. Where it meets the ground, what the
// ground is made of drifts against its foot (sand, or soil inland), and low
// down the rock and the ground hide each other from the sky. Wet rock far away
// is rougher: a facet a few pixels wide would flash in the sun.

#include "chunks/scene-output.glsl"
#include "chunks/lighting.glsl"
#include "chunks/terrain.glsl"
#include "chunks/wet.glsl"
#include "chunks/sand.glsl"
#include "chunks/rock.glsl"
#include "chunks/green.glsl"
#include "chunks/planet.glsl"

uniform vec3 uRock; // linear albedos
uniform vec3 uDrySand;
uniform vec3 uWetSand;

centroid varying vec3 vWorldPos;
varying vec3 vNormal;
varying float vOffset; // how far the rock moved to stay on the mesh (rock-offsets.frag)
varying float vSize; // m, how tall it is

void main() {
  vec3 dPdx = dFdx(vWorldPos);
  vec3 dPdy = dFdy(vWorldPos);
  vec2 ao = terrainCove(vWorldPos.xz);
  vec2 dx = dFdx(ao);
  vec2 dy = dFdy(ao);
  float footprint = max(length(dPdx), length(dPdy));
  vec3 view = normalize(cameraPosition - vWorldPos);
  float aboveSea = vWorldPos.y + planetDrop(vWorldPos.xz);
  // Its surface where it was placed, so it doesn't slide over the rock as its
  // offset changes, and as wet as the ground at that height.
  Wet w = groundWet(vWorldPos.xz, aboveSea - vOffset, fwidth(aboveSea));
  Rock r = rock(vWorldPos - vec3(0.0, vOffset, 0.0), aboveSea - vOffset, w, normalize(vNormal), view, uRock, dPdx, dPdy);

  // The ground under this point of the rock, as drawn, and what it is.
  float above = aboveSea - terrainHeight(ao, 0) - vOffset;
  vec4 info;
  vec4 cover;
  terrainGround(ao, dx, dy, info, cover);
  vec3 green = greenAlbedo(info.z, cover.z, cover.w, uDrySand);
  vec3 sand = sandAlbedo(w.wetness, uDrySand, uWetSand);
  float rest = max(1.0 - cover.x - cover.y, 0.0);
  // Sand drifts higher than soil, raggedly round the rock, and less high on a small one.
  float drift = min(0.03 + 0.06 * cover.x, 0.1 * vSize) * (1.0 + 0.6 * gradientNoise(vWorldPos.xz * 4.0 + vWorldPos.y));
  float against = (1.0 - smoothstep(drift - footprint, drift + footprint, above)) * (cover.x + rest);
  vec3 lying = (cover.x * sand + rest * green) / max(cover.x + rest, 1e-3);
  r.albedo = mix(r.albedo, lying, against);
  r.normal = normalize(mix(r.normal, vec3(0.0, 1.0, 0.0), 0.6 * against));
  // Right at the ground, half the sky is ground and rock.
  float low = 1.0 - smoothstep(0.0, 0.15 * vSize, above);

  r.roughness = mix(r.roughness, max(r.roughness, 0.8), smoothstep(0.01, 0.04, footprint));
  float kernel = specularKernel(r.normal);
  vec3 radiance = r.albedo / PI * (sunLight(vWorldPos, r.normal) + (1.0 - 0.4 * low) * skyIrradiance(vWorldPos, r.normal));
  radiance += (1.0 - against) * rockShine(r, vWorldPos, r.normal, view, kernel);
  gl_FragColor = sceneOutput(aerialPerspective(radiance, vWorldPos), 1.0);
}
