// One mip level from the one above it (texture.js): each texel the bilinear
// sample at its centre, which for a level half the size is the average of the
// four texels under it.

@group(0) @binding(0) var source: texture_2d<f32>;
@group(0) @binding(1) var bilinear: sampler;

@vertex
fn vertexMain(@builtin(vertex_index) i: u32) -> @builtin(position) vec4f {
  let corner = vec2f(f32(i == 1u) * 4.0 - 1.0, f32(i == 2u) * 4.0 - 1.0);
  return vec4f(corner, 0.0, 1.0);
}

@fragment
fn fragmentMain(@builtin(position) at: vec4f) -> @location(0) vec4f {
  let size = vec2f(max(textureDimensions(source) / 2u, vec2u(1u)));
  return textureSampleLevel(source, bilinear, at.xy / size, 0.0);
}
