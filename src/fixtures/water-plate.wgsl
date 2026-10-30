// Tool fixture (water.js): what stands in for the opaque scene. The seabed, bent
// to its slope, its colour holding where it lies (x, z); or with uMark set, a
// block, which reads as no point of the seabed where it stands well above the
// water, past what the water takes in (water-seen.wgsl).

#include "/chunks/frame.wgsl"
#include "/chunks/object.wgsl"

struct Plate {
  uSeabed: vec3f, // how deep it starts, how fast it deepens along -z, how far it reaches
  uMark: f32,
}

@group(1) @binding(0) var<uniform> plate: Plate;

struct Varyings {
  @builtin(position) position: vec4f,
  @location(0) vWorld: vec3f,
}

@vertex
fn vertexMain(@location(0) position: vec3f) -> Varyings {
  var world = object.modelMatrix * vec4f(position, 1.0);
  if (plate.uMark == 0.0) {
    world.y = -(plate.uSeabed.x + plate.uSeabed.y * -world.z);
  }
  var out: Varyings;
  out.vWorld = world.xyz;
  out.position = frame.projectionMatrix * frame.viewMatrix * world;
  return out;
}

@fragment
fn fragmentMain(in: Varyings) -> @location(0) vec4f {
  if (plate.uMark != 0.0 && in.vWorld.y > 0.3) {
    return vec4f(vec3f(plate.uMark), 1.0);
  }
  return vec4f(in.vWorld.x, in.vWorld.z, 0.5, 1.0);
}
