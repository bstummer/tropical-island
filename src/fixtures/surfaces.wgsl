// Fixture: see surfaces.js. Sand at one wetness, or with SURFACE_ROCK rock,
// or with SURFACE_GREEN the green at one band and lush, lit as the terrain
// lights them (world/terrain.wgsl). The sand's height above
// the sea, for the swash marks, rises a metre in ten across the fixture; the
// rock's is its height above the fixture's ground, plus uAboveSea.

#include "world-mesh.wgsl"
#include "chunks/scene-output.wgsl"
#include "chunks/lighting.wgsl"
#include "chunks/wet.wgsl"
#include "chunks/sand.wgsl"
#include "chunks/rock.wgsl"
#include "chunks/green.wgsl"

override SURFACE_ROCK: bool = false;
override SURFACE_GREEN: bool = false;

struct Surfaces {
  uWetness: f32,
  uDrySand: vec3f, // linear albedos
  uWetSand: vec3f,
  uAboveSea: f32, // m, where the fixture's sideways coordinate is 0
  uAcross: vec2f, // world xz, unit: which way it rises
  uRock: vec3f,
  uGround: f32, // world y
  uGreen: vec3f, // band, lush, sandy
}

@group(1) @binding(0) var<uniform> surface: Surfaces;

@fragment
fn fragmentMain(in: Varyings) -> @location(0) vec4f {
  let vWorldPos = in.vWorldPos;
  let dPdx = dpdx(vWorldPos);
  let dPdy = -dpdy(vWorldPos);
  let view = normalize(frame.cameraPosition - vWorldPos);
  var radiance: vec3f;
  if (SURFACE_ROCK) {
    let aboveSea = surface.uAboveSea + vWorldPos.y - surface.uGround;
    let r = rock(vWorldPos, aboveSea, groundWet(vWorldPos.xz, aboveSea, fwidth(aboveSea)), normalize(in.vNormal), view, surface.uRock, dPdx, dPdy);
    let kernel = specularKernel(r.normal);
    radiance = r.albedo / PI * (sunLight(vWorldPos, r.normal) + skyIrradiance(vWorldPos, r.normal));
    radiance += rockShine(r, vWorldPos, r.normal, view, kernel);
  } else if (SURFACE_GREEN) {
    let g = green(vWorldPos, normalize(in.vNormal), surface.uGreen.x, surface.uGreen.y, surface.uGreen.z, surface.uDrySand, dPdx.xz, dPdy.xz);
    radiance = g.albedo / PI * (sunLight(vWorldPos, g.normal) + skyIrradiance(vWorldPos, g.normal));
  } else {
    let aboveSea = surface.uAboveSea + 0.1 * dot(vWorldPos.xz, surface.uAcross);
    let s = sand(vWorldPos, aboveSea, normalize(in.vNormal), wetAt(surface.uWetness), surface.uDrySand, surface.uWetSand, dPdx.xz, dPdy.xz);
    let kernel = specularKernel(s.normal);
    radiance = sandDiffuse(s, s.normal, view) / PI * (sunLight(vWorldPos, s.normal) + skyIrradiance(vWorldPos, s.normal));
    radiance += sandShine(s, vWorldPos, s.normal, view, kernel);
  }
  return sceneOutput(aerialPerspective(radiance, vWorldPos), 1.0);
}
