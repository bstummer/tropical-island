// A cascade's summed fields (waves-fft.wgsl) into the two layers of the waves'
// texture that water.wgsl reads, filtered, and the mip levels below them.
//   layer 2 c:     Dx, h, Dz, Dxz    (sideways, height, sideways, how Dx changes along z)
//   layer 2 c + 1: hx, hz, Dxx, Dzz  (slopes, and how the sideways moves pile up)

struct Store {
  uSize: u32,
  uLayer: u32, // the cascade's first layer
  uPad0: u32,
  uPad1: u32,
}

struct Cell {
  first: vec4f,
  second: vec4f,
}

@group(0) @binding(0) var<uniform> store: Store;
@group(0) @binding(1) var<storage, read> cells: array<Cell>;
@group(0) @binding(2) var output: texture_storage_2d_array<rgba16float, write>;

@compute @workgroup_size(16, 16)
fn main(@builtin(global_invocation_id) id: vec3u) {
  if (id.x >= store.uSize || id.y >= store.uSize) {
    return;
  }
  let cell = cells[id.y * store.uSize + id.x];
  let at = vec2i(id.xy);
  // Each field is a + i b (waves-evolve.wgsl).
  textureStore(output, at, store.uLayer, vec4f(cell.first.x, cell.first.y, cell.first.z, cell.first.w));
  textureStore(output, at, store.uLayer + 1u, vec4f(cell.second.x, cell.second.y, cell.second.z, cell.second.w));
}
