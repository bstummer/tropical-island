// The vertex stage of passes over a whole target (gpu/renderer.js fullscreen()):
// one triangle that covers it, made from the vertex index. vUv is (0, 0) at
// the target's first texel and (1, 1) at its last, as it was in WebGL; WebGPU
// stores the top row first, so v grows downwards here.

struct Fullscreen {
  @builtin(position) position: vec4f,
  @location(0) vUv: vec2f,
}

@vertex
fn vertexMain(@builtin(vertex_index) i: u32) -> Fullscreen {
  let corner = vec2f(f32(i == 1u) * 4.0 - 1.0, f32(i == 2u) * 4.0 - 1.0);
  var out: Fullscreen;
  out.position = vec4f(corner, 0.0, 1.0);
  out.vUv = vec2f(corner.x * 0.5 + 0.5, 0.5 - corner.y * 0.5);
  return out;
}
