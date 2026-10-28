// The terrain, lit by the shared lighting. Its normal comes from the finest
// grid's slopes, filtered over the pixel's footprint, so distant slopes keep
// their detail without sparkling. Its ground (world/island.js groundOf) is
// sand (chunks/sand.wgsl) and rock (chunks/rock.wgsl), as wet as the ground
// is (chunks/wet.wgsl), and green inland (chunks/green.wgsl), mixed as
// world/albedo.js mixes them; where sand meets green, the green's patches
// decide which is where. Pieces with no sand or no rock (world/terrain.js)
// leave out TERRAIN_SAND or TERRAIN_ROCK and draw what a far, filtered pixel
// still sees of it as its plain albedo, with wet sand's sheen where they
// reach down to it (TERRAIN_WET); pieces far from the camera leave out the
// sand's detail and the green's (GREEN_DETAIL).
//
// The mesh: world/lod.js's level-of-detail mesh, each instance a node, a grid
// of quads `spacing` metres apart from its corner, its vertices morphed for
// the camera (chunks/terrain-mesh.wgsl). Ranges are measured across the
// ground, as lod.js picks the nodes.

#include "chunks/scene-output.wgsl"
#include "chunks/lighting.wgsl"
#include "chunks/terrain.wgsl"
#include "chunks/terrain-mesh.wgsl"
#include "chunks/wet.wgsl"
#include "chunks/sand.wgsl"
#include "chunks/rock.wgsl"
#include "chunks/green.wgsl"
#include "chunks/planet.wgsl"

override TERRAIN_SAND: bool = false;
override TERRAIN_ROCK: bool = false;
override TERRAIN_WET: bool = false;

struct Terrain {
  uDrySand: vec3f, // linear albedos, as all here
  uWetSand: vec3f,
  uRock: vec3f,
}

@group(1) @binding(0) var<uniform> terrain: Terrain;

struct VertexIn {
  @location(0) position: vec3f,
  @location(1) aNode: vec4f, // the node's corner a, o; its spacing; its level
}

struct Varyings {
  @builtin(position) position: vec4f,
  @location(0) @interpolate(perspective, centroid) vWorldPos: vec3f,
  // The same at the pixel's centre, for derivatives: a centroid varying's are
  // off wherever a triangle's edge crosses the pixels they are taken over.
  @location(1) vCentre: vec3f,
}

@vertex
fn vertexMain(in: VertexIn) -> Varyings {
  let level = i32(in.aNode.w);
  let morph = terrainMorph(in.aNode.xy, in.position.xz, in.aNode.z, level, terrainCove(frame.cameraPosition.xz));
  var world = vec3f(0.0, terrainMorphHeight(morph, level), 0.0);
  let xz = terrainWorld(morph.xy);
  world.x = xz.x;
  world.z = xz.y;
  // The ground bends down with the planet as the sea does, so the shoreline
  // stays where it is at any distance.
  world.y -= planetDrop(world.xz);
  var out: Varyings;
  out.vWorldPos = world;
  out.vCentre = world;
  out.position = frame.projectionMatrix * frame.viewMatrix * vec4f(world, 1.0);
  return out;
}

@fragment
fn fragmentMain(in: Varyings) -> @location(0) vec4f {
  let vWorldPos = in.vWorldPos;
  let vCentre = in.vCentre;
  let ao = terrainCove(vWorldPos.xz);
  // Before any branch: derivatives need every pixel around.
  let dx = dpdx(terrainCove(vCentre.xz));
  let dy = -dpdy(terrainCove(vCentre.xz));
  let dPdx = dpdx(vCentre);
  let dPdy = -dpdy(vCentre);
  let pdx = dPdx.xz;
  let pdy = dPdy.xz;

  let aboveSea = vWorldPos.y + planetDrop(vWorldPos.xz);
  let tall = fwidth(vCentre.y + planetDrop(vCentre.xz)); // how much aboveSea changes across the pixel
  // TEMPORARY, with world/placeholder.js: its opaque water hides the seabed, so
  // seabed wholly under it across the pixel needn't be shaded (a fifth of a
  // SwiftShader frame). Stage 6's water shows the seabed: remove this then.
  let hidden = aboveSea + 2.0 * tall < -0.1;

  var info = vec4f(0.0);
  var cover = vec4f(0.0);
  var n = vec3f(0.0, 1.0, 0.0);
  var s: Sand;
  s.albedo = vec3f(0.0);
  s.roughness = 1.0;
  s.f0 = 0.02;
  s.film = 0.0;
  var r: Rock;
  r.albedo = vec3f(0.0);
  r.roughness = 1.0;
  r.f0 = 0.04;
  r.height = 0.0;
  r.width = 0.0;
  r.relief = 0.0;
  var gr: Green;
  gr.albedo = vec3f(0.0);
  gr.height = 0.5;
  gr.detail = 0.0;
  gr.width = 0.0;
  var w = wetAt(0.0);
  let view = normalize(frame.cameraPosition - vWorldPos);
  if (!hidden) {
    w = groundWet(vWorldPos.xz, aboveSea, tall);
    terrainGround(ao, dx, dy, &info, &cover);
    let slope = terrainWorldSlope(info.xy);
    n = normalize(vec3f(-slope.x, 1.0, -slope.y));
  }
  s.normal = n;
  r.normal = n;
  gr.normal = n;
  if (!hidden) {
    gr = green(vWorldPos, n, info.z, cover.z, cover.w, terrain.uDrySand, pdx, pdy);
    s = sandPlain(w, n, terrain.uDrySand, terrain.uWetSand);
    if (TERRAIN_SAND) {
      if (cover.x > 0.0) {
        s = sand(vWorldPos, aboveSea, n, w, terrain.uDrySand, terrain.uWetSand, pdx, pdy);
      }
    }
    if (TERRAIN_ROCK) {
      if (cover.y > 0.0) {
        r = rock(vWorldPos, aboveSea, w, n, view, terrain.uRock, dPdx, dPdy);
      }
    } else {
      r.albedo = rockAlbedo(terrain.uRock, w);
    }
  }
  let soft = 1.0 - cover.y; // sand and green
  if (cover.x > 0.0 && soft > cover.x) {
    cover.x = soft * greenSandShare(cover.x / soft, gr);
  }
  if (TERRAIN_ROCK) {
    // Where rock meets sand or green, the rest of the pixel keeps their proportions.
    if (cover.y > 0.0) {
      let share = rockShare(cover.y, r);
      // The rock's edge rounds down under what lies round it, which drifts up against it.
      if (cover.y < 1.0) {
        let edge = rockEdge(cover.y, r, max(length(dPdx), length(dPdy)));
        r.normal = rockTilt(r.normal, edge);
        s.normal = rockTilt(s.normal, edge);
        gr.normal = rockTilt(gr.normal, edge);
      }
      let rest = 1.0 - cover.y;
      cover.x *= select(0.0, (1.0 - share) / rest, rest > 0.001);
      cover.y = share;
    }
  }
  // Each surface's own normal tilts its share of the pixel, where they meet.
  let rest = max(1.0 - cover.x - cover.y, 0.0);
  n = normalize(n + cover.x * (s.normal - n) + cover.y * (r.normal - n) + rest * (gr.normal - n));
  let kernel = specularKernel(n); // every pixel: it takes derivatives
  if (hidden) {
    return sceneOutput(vec3f(0.0), 1.0);
  }

  var diffuse = cover.y * r.albedo + rest * gr.albedo;
  diffuse += cover.x * sandDiffuse(s, n, view);
  var radiance = diffuse / PI * (sunLight(vWorldPos, n) + skyIrradiance(vWorldPos, n));
  if (TERRAIN_SAND || TERRAIN_WET) {
    if (cover.x > 0.0) {
      radiance += cover.x * sandShine(s, vWorldPos, n, view, kernel);
    }
  }
  if (TERRAIN_ROCK) {
    if (cover.y > 0.0) {
      radiance += cover.y * rockShine(r, vWorldPos, n, view, kernel);
    }
  }
  return sceneOutput(aerialPerspective(radiance, vWorldPos), 1.0);
}
