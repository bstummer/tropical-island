// Tool fixtures: the vertex stage of a card that stands in the view (tonecard,
// gradient, blend, shimmer, silhouette, heavy): placed by its mesh, with its uv.

#include "/chunks/frame.wgsl"
#include "/chunks/object.wgsl"

struct VertexIn {
  @location(0) position: vec3f,
  @location(1) uv: vec2f,
}

struct Varyings {
  @builtin(position) position: vec4f,
  @location(0) vUv: vec2f,
}

@vertex
fn vertexMain(in: VertexIn) -> Varyings {
  var out: Varyings;
  out.vUv = in.uv;
  out.position = frame.projectionMatrix * object.modelViewMatrix * vec4f(in.position, 1.0);
  return out;
}
