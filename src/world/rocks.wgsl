// A rock (world/rocks.js): its prototype scaled, turned and placed by its
// instance, moved by its offset to stay sunk in the terrain's mesh as drawn
// (rock-offsets.wgsl: the least of its block of 3 x 3), and bent down with the
// planet as the ground under it is, all of it by the drop at its place, so it
// keeps its shape.
//
// Its surface is the cliffs' (chunks/rock.wgsl) on its facets, lit by the
// shared lighting. Where it meets the ground, what the ground is made of drifts
// against its foot (sand, or soil inland), and low down the rock and the
// ground hide each other from the sky. Wet rock far away is rougher: a facet a
// few pixels wide would flash in the sun.

#include "chunks/scene-output.wgsl"
#include "chunks/lighting.wgsl"
#include "chunks/terrain.wgsl"
#include "chunks/wet.wgsl"
#include "chunks/sand.wgsl"
#include "chunks/rock.wgsl"
#include "chunks/green.wgsl"
#include "chunks/planet.wgsl"

struct Rocks {
  uRock: vec3f, // linear albedos
  uDrySand: vec3f,
  uWetSand: vec3f,
}

@group(1) @binding(0) var<uniform> rocks: Rocks;
@group(1) @binding(1) var uRockOffsets: texture_2d<f32>;

struct VertexIn {
  @location(0) position: vec3f,
  @location(1) normal: vec3f,
  @location(2) aPlace: vec4f, // world position of its base; its texel of the offsets, counted row by row
  @location(3) aTurn: vec4f, // rotation, a quaternion
  @location(4) aScale: vec4f, // and how tall it is, m
  @location(5) aTop: f32, // how far its highest point stands above its base, m
}

struct Varyings {
  @builtin(position) position: vec4f,
  @location(0) @interpolate(perspective, centroid) vWorldPos: vec3f,
  @location(1) vNormal: vec3f,
  @location(2) vOffset: f32, // how far the rock moved to stay on the mesh (rock-offsets.wgsl)
  @location(3) vSize: f32, // m, how tall it is
}

fn turn(q: vec4f, v: vec3f) -> vec3f {
  return v + 2.0 * cross(q.xyz, cross(q.xyz, v) + q.w * v);
}

@vertex
fn vertexMain(in: VertexIn) -> Varyings {
  var out: Varyings;
  let id = i32(in.aPlace.w + 0.5);
  let side = i32(textureDimensions(uRockOffsets, 0).x) / 3;
  let block = 3 * vec2i(id % side, id / side);
  var offset = 1e9;
  for (var j = 0; j < 3; j++) {
    for (var i = 0; i < 3; i++) {
      offset = min(offset, textureLoad(uRockOffsets, block + vec2i(i, j), 0).r);
    }
  }
  // TEMPORARY, with world/placeholder.js: its opaque water hides a rock wholly
  // under it, so such a rock isn't drawn: all its corners lie outside the
  // view. Stage 6's water shows the seabed: remove this then.
  if (in.aPlace.y + in.aTop + offset < -0.1) {
    out.position = vec4f(2.0, 2.0, 2.0, 1.0);
    return out;
  }
  var world = in.aPlace.xyz + turn(in.aTurn, in.position * in.aScale.xyz);
  world.y += offset - planetDrop(in.aPlace.xz);
  out.vWorldPos = world;
  out.vOffset = offset;
  out.vSize = in.aScale.w;
  out.vNormal = turn(in.aTurn, in.normal / in.aScale.xyz); // scaled unevenly, normals take the inverse
  out.position = frame.projectionMatrix * frame.viewMatrix * vec4f(world, 1.0);
  return out;
}

@fragment
fn fragmentMain(in: Varyings) -> @location(0) vec4f {
  let vWorldPos = in.vWorldPos;
  let vOffset = in.vOffset;
  let dPdx = dpdx(vWorldPos);
  let dPdy = -dpdy(vWorldPos);
  let ao = terrainCove(vWorldPos.xz);
  let dx = dpdx(ao);
  let dy = -dpdy(ao);
  let footprint = max(length(dPdx), length(dPdy));
  let view = normalize(frame.cameraPosition - vWorldPos);
  let aboveSea = vWorldPos.y + planetDrop(vWorldPos.xz);
  // Its surface where it was placed, so it doesn't slide over the rock as its
  // offset changes, and as wet as the ground at that height.
  let w = groundWet(vWorldPos.xz, aboveSea - vOffset, fwidth(aboveSea));
  var r = rock(vWorldPos - vec3f(0.0, vOffset, 0.0), aboveSea - vOffset, w, normalize(in.vNormal), view, rocks.uRock, dPdx, dPdy);

  // The ground under this point of the rock, as drawn, and what it is.
  let above = aboveSea - terrainHeight(ao, 0) - vOffset;
  var info: vec4f;
  var cover: vec4f;
  terrainGround(ao, dx, dy, &info, &cover);
  let green = greenAlbedo(info.z, cover.z, cover.w, rocks.uDrySand);
  let sand = sandAlbedo(w.wetness, rocks.uDrySand, rocks.uWetSand);
  let rest = max(1.0 - cover.x - cover.y, 0.0);
  // Sand drifts higher than soil, raggedly round the rock, and less high on a small one.
  let drift = min(0.03 + 0.06 * cover.x, 0.1 * in.vSize) * (1.0 + 0.6 * gradientNoise(vWorldPos.xz * 4.0 + vWorldPos.y));
  let against = (1.0 - smoothstep(drift - footprint, drift + footprint, above)) * (cover.x + rest);
  let lying = (cover.x * sand + rest * green) / max(cover.x + rest, 1e-3);
  r.albedo = mix(r.albedo, lying, against);
  r.normal = normalize(mix(r.normal, vec3f(0.0, 1.0, 0.0), 0.6 * against));
  // Right at the ground, half the sky is ground and rock.
  let low = 1.0 - smoothstep(0.0, 0.15 * in.vSize, above);

  r.roughness = mix(r.roughness, max(r.roughness, 0.8), smoothstep(0.01, 0.04, footprint));
  let kernel = specularKernel(r.normal);
  shadeOnce(vWorldPos, normalize(in.vNormal), dx, dy, above); // its shadows, before it lights (chunks/shadows.wgsl)
  var radiance = r.albedo / PI * (sunLight(vWorldPos, r.normal) + (1.0 - 0.4 * low) * skyIrradiance(vWorldPos, r.normal));
  radiance += (1.0 - against) * rockShine(r, vWorldPos, r.normal, view, kernel);
  return sceneOutput(aerialPerspective(radiance, vWorldPos), 1.0);
}
