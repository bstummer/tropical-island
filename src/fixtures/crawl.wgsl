// Tool fixture: stripes that crawl only as the camera moves, on the left half.
// See crawl.js.

#include "chunks/scene-output.wgsl"
#include "chunks/object.wgsl"

const PERIOD = 0.3; // m

struct Crawl {
  uOrigin: vec3f, // m, world: where the camera stood at the start
  uRight: vec3f, // world: its right then
}

@group(1) @binding(0) var<uniform> crawl: Crawl;

struct VertexIn {
  @location(0) position: vec3f,
  @location(1) uv: vec2f,
}

struct Varyings {
  @builtin(position) position: vec4f,
  @location(0) vWorld: vec3f,
}

@vertex
fn vertexMain(in: VertexIn) -> Varyings {
  var out: Varyings;
  out.vWorld = (object.modelMatrix * vec4f(in.position, 1.0)).xyz;
  out.position = frame.projectionMatrix * object.modelViewMatrix * vec4f(in.position, 1.0);
  return out;
}

// How much of [0, x] the stripes cover: half of each period.
fn covered(x: f32) -> f32 {
  let n = floor(x / PERIOD);
  return 0.5 * PERIOD * n + max(x - PERIOD * (n + 0.5), 0.0);
}

// The stripes averaged over a pixel `w` wide at s: filtered, so they don't
// shimmer as the camera turns.
fn stripes(s: f32, w: f32) -> f32 {
  let half = 0.5 * max(w, 1e-4);
  return (covered(s + half) - covered(s - half)) / (2.0 * half);
}

@fragment
fn fragmentMain(in: Varyings) -> @location(0) vec4f {
  // Across the start view, from where the camera stood then (the world's), and
  // from where it stands now.
  let world = dot(in.vWorld - crawl.uOrigin, crawl.uRight);
  let follows = dot(in.vWorld - frame.cameraPosition, crawl.uRight);
  let widths = vec2f(fwidth(world), fwidth(follows));
  let value = select(stripes(world, widths.x), stripes(follows, widths.y), world < 0.0);
  return sceneOutput(vec3f(mix(0.12, 0.7, value)), 1.0);
}
