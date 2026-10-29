// Fixture: see shadows.js. A caster, moved by uShift in its vertex shader, lit
// by the shared lighting; with uHoles, a card with round holes, which its
// shadow material's cutOut leaves out of the shadow maps too.

#include "/chunks/frame.wgsl"
#include "/chunks/object.wgsl"
#include "/chunks/planet.wgsl"
#include "chunks/scene-output.wgsl"
#include "chunks/lighting.wgsl"

struct Caster {
  uShift: vec3f, // m, world
  uHoles: f32, // 1: a card with holes (shadows.js inHole)
  uAlbedo: vec3f, // linear
}

@group(1) @binding(0) var<uniform> caster: Caster;

struct VertexIn {
  @location(0) position: vec3f,
  @location(1) normal: vec3f,
}

struct Varyings {
  @builtin(position) position: vec4f,
  @location(0) @interpolate(perspective, centroid) vWorldPos: vec3f,
  @location(1) vNormal: vec3f,
  @location(2) vLocal: vec3f,
}

@vertex
fn vertexMain(in: VertexIn) -> Varyings {
  var world = object.modelMatrix * vec4f(in.position, 1.0);
  world = vec4f(world.xyz + caster.uShift, 1.0);
  world.y -= planetDrop(world.xz);
  var out: Varyings;
  out.vWorldPos = world.xyz;
  out.vNormal = mat3x3f(object.modelMatrix[0].xyz, object.modelMatrix[1].xyz, object.modelMatrix[2].xyz) * in.normal;
  out.vLocal = in.position;
  out.position = frame.projectionMatrix * frame.viewMatrix * world;
  return out;
}

// A hole every 0.6 m across the card, 0.24 m in radius (shadows.js inHole).
fn inHole(local: vec3f) -> bool {
  let cell = local.xy / 0.6;
  return caster.uHoles > 0.5 && length(cell - round(cell)) < 0.4;
}

@fragment
fn fragmentMain(in: Varyings) -> @location(0) vec4f {
  if (inHole(in.vLocal)) {
    discard;
  }
  let n = normalize(in.vNormal);
  let radiance = caster.uAlbedo / PI * (sunLight(in.vWorldPos, n) + skyIrradiance(in.vWorldPos, n));
  return sceneOutput(aerialPerspective(radiance, in.vWorldPos), 1.0);
}

// Into the shadow maps: nothing where the card has holes.
@fragment
fn cutOut(in: Varyings) {
  if (inHole(in.vLocal)) {
    discard;
  }
}
