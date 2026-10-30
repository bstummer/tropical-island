// Fixtures light.wgsl and surfaces.wgsl: a mesh in world space, bent with the planet.

#include "/chunks/frame.wgsl"
#include "/chunks/object.wgsl"
#include "/chunks/planet.wgsl"

struct VertexIn {
  @location(0) position: vec3f,
  @location(1) normal: vec3f,
}

struct Varyings {
  @builtin(position) position: vec4f,
  @location(0) @interpolate(perspective, centroid) vWorldPos: vec3f, // see water/water.wgsl
  @location(1) vNormal: vec3f,
}

@vertex
fn vertexMain(in: VertexIn) -> Varyings {
  var world = object.modelMatrix * vec4f(in.position, 1.0);
  world.y -= planetDrop(world.xz); // with the planet, as the sea
  var out: Varyings;
  out.vWorldPos = world.xyz;
  out.vNormal = mat3x3f(object.modelMatrix[0].xyz, object.modelMatrix[1].xyz, object.modelMatrix[2].xyz) * in.normal;
  out.position = frame.projectionMatrix * frame.viewMatrix * world;
  return out;
}
