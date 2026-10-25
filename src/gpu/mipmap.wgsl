// One mip level from the one above it (texture.js): each texel the average of
// the four under it, as WebGL's generateMipmap made them (every mipmapped
// texture here is a power of two across, or for world/heightmap.js's grids a
// multiple of 2^(mips - 1), whose mips all halve it exactly). An 8-bit target gets the average of
// their 8-bit levels rounded half to even, WebGL's rounding: the GPU's own
// conversion rounds halves up, and each level would come out brighter.

override UNORM8: bool = false;

@group(0) @binding(0) var source: texture_2d<f32>;

@vertex
fn vertexMain(@builtin(vertex_index) i: u32) -> @builtin(position) vec4f {
  let corner = vec2f(f32(i == 1u) * 4.0 - 1.0, f32(i == 2u) * 4.0 - 1.0);
  return vec4f(corner, 0.0, 1.0);
}

@fragment
fn fragmentMain(@builtin(position) at: vec4f) -> @location(0) vec4f {
  let p = vec2i(at.xy) * 2;
  let last = vec2i(textureDimensions(source)) - 1;
  let a = textureLoad(source, min(p, last), 0);
  let b = textureLoad(source, min(p + vec2i(1, 0), last), 0);
  let c = textureLoad(source, min(p + vec2i(0, 1), last), 0);
  let d = textureLoad(source, min(p + vec2i(1, 1), last), 0);
  if (UNORM8) {
    // Whole levels, summed exactly; WGSL's round() takes halves to even.
    let levels = round(a * 255.0) + round(b * 255.0) + round(c * 255.0) + round(d * 255.0);
    return round(levels * 0.25) / 255.0;
  }
  return (a + b + c + d) * 0.25;
}
