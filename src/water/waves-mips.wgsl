// One mip level of the waves' texture from the level above it: each texel the
// mean of the four over it. Done here and not in render passes, as a render
// pass per layer and level, every frame, would be dear; the fields repeat, and
// their levels halve exactly, so nothing wraps.

@group(0) @binding(0) var source: texture_2d_array<f32>;
@group(0) @binding(1) var output: texture_storage_2d_array<rgba16float, write>;

@compute @workgroup_size(8, 8)
fn main(@builtin(global_invocation_id) id: vec3u) {
  let size = textureDimensions(output);
  if (id.x >= size.x || id.y >= size.y) {
    return;
  }
  let at = vec2i(id.xy) * 2;
  for (var layer = 0u; layer < textureNumLayers(output); layer++) {
    let sum = textureLoad(source, at, layer, 0) + textureLoad(source, at + vec2i(1, 0), layer, 0) + textureLoad(source, at + vec2i(0, 1), layer, 0) + textureLoad(source, at + vec2i(1, 1), layer, 0);
    textureStore(output, vec2i(id.xy), layer, 0.25 * sum);
  }
}
