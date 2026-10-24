// Tool fixtures: a plain colour, or a texture times it, unlit, with an optional
// fog to black by view depth, as three.js's MeshBasicMaterial drew it (basic.js).

#include "chunks/scene-output.wgsl"
#include "chunks/object.wgsl"

struct Basic {
  uColor: vec3f, // linear
  uOpacity: f32,
  uFog: vec2f, // where the fog starts and where it is complete, m; none when equal
  uHasMap: u32,
}

@group(1) @binding(0) var<uniform> basic: Basic;
@group(1) @binding(1) var uMap: texture_2d<f32>;
@group(1) @binding(2) var uMapSampler: sampler;

struct VertexIn {
  @location(0) position: vec3f,
  @location(1) uv: vec2f,
}

struct Varyings {
  @builtin(position) position: vec4f,
  @location(0) vUv: vec2f,
  @location(1) vFogDepth: f32,
}

@vertex
fn vertexMain(in: VertexIn) -> Varyings {
  var out: Varyings;
  let mvPosition = object.modelViewMatrix * vec4f(in.position, 1.0);
  out.vUv = in.uv;
  out.vFogDepth = -mvPosition.z;
  out.position = frame.projectionMatrix * mvPosition;
  return out;
}

fn basicColor(in: Varyings) -> vec4f {
  var color = vec4f(basic.uColor, basic.uOpacity);
  if (basic.uHasMap != 0u) {
    color *= textureSample(uMap, uMapSampler, in.vUv);
  }
  if (basic.uFog.y > basic.uFog.x) {
    color = vec4f(mix(color.rgb, vec3f(0.0), smoothstep(basic.uFog.x, basic.uFog.y, in.vFogDepth)), color.a);
  }
  return color;
}

@fragment
fn fragmentMain(in: Varyings) -> @location(0) vec4f {
  let color = basicColor(in);
  return sceneOutput(color.rgb, color.a);
}

// For the broken fixture: the same without sceneOutput(), which capture mode must catch.
@fragment
fn rawFragment(in: Varyings) -> @location(0) vec4f {
  return basicColor(in);
}
