// Tool fixture (water.js): the water's own code over a flat surface, into a float
// target. uMode 0: what it sees under the surface (the opaque scene's colour
// where the bent ray lands, how deep that is, and where it holds nothing there,
// where it landed as the fixture's seabed); 1: the light it works out from it.

#include "/chunks/frame.wgsl"
#include "/chunks/object.wgsl"
#include "/chunks/planet.wgsl"
#include "../water/water-optics.wgsl"

struct Check {
  uMode: i32,
  uSunCos: f32,
  uSunLight: vec3f,
  uSkyLight: vec3f,
  uSeabed: vec3f, // how deep it starts, how fast it deepens along -z, how far it reaches
}

@group(1) @binding(0) var<uniform> optics: WaterOptics;
@group(1) @binding(1) var<uniform> check: Check;
@group(1) @binding(2) var uOpaque: texture_2d<f32>;
@group(1) @binding(4) var uOpaqueDepth: texture_depth_2d;

#include "../water/water-seen.wgsl"

// The depth of the water at world xz, as water/sea-map.js would say it.
fn seaDepthAt(xz: vec2f, footprint: f32) -> f32 {
  return check.uSeabed.x + check.uSeabed.y * -xz.y;
}

fn seabedDepthAt(xz: vec2f, footprint: f32) -> f32 {
  return seaDepthAt(xz, footprint);
}

struct Varyings {
  @builtin(position) position: vec4f,
  @location(0) vWorld: vec3f,
}

@vertex
fn vertexMain(@location(0) position: vec3f) -> Varyings {
  let world = object.modelMatrix * vec4f(position, 1.0);
  var out: Varyings;
  out.vWorld = world.xyz;
  out.position = frame.projectionMatrix * frame.viewMatrix * world;
  return out;
}

@fragment
fn fragmentMain(in: Varyings) -> @location(0) vec4f {
  let view = normalize(frame.cameraPosition - in.vWorld);
  let size = vec2f(textureDimensions(uOpaqueDepth));
  let bent = refract(-view, vec3f(0.0, 1.0, 0.0), 1.0 / optics.uIor);
  let below = seenBelow(in.vWorld, bent, size, optics.uSeabedFade.y, seaDepthAt(in.vWorld.xz, 0.0), 0.0);
  let seabed = mix(vec3f(below.xz, 0.5), below.on.rgb, below.on.a);
  if (check.uMode == 0) {
    return vec4f(seabed, below.depth);
  }
  return vec4f(waterLeaving(optics, seabed, below.depth, view.y, check.uSunCos, check.uSunLight, check.uSkyLight), 1.0);
}
