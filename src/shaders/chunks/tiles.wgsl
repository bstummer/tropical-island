// The ground's surface tiles (textures/surfaces.js): one texture array, so a
// shader reads them all through one binding. Its layers:
const TILE_GRAIN: f32 = 0.0;
const TILE_RIPPLES: f32 = 1.0;
const TILE_ROCK: f32 = 2.0;
const TILE_GRASS: f32 = 3.0;
const TILE_LITTER: f32 = 4.0;
const TILE_LEAVES: f32 = 5.0;
const TILE_SEABED: f32 = 6.0;
const TILE_GLINTS: f32 = 7.0;

@group(1) @binding(16) var uSurfaceTiles: texture_2d_array<f32>;
@group(1) @binding(17) var uSurfaceTilesSampler: sampler;

// A layer's texel at uv (in tiles), filtered over the pixel's footprint (the derivatives of uv).
// The layers are whole numbers, which GLSL rounded to and WGSL takes as an integer.
fn surfaceTile(layer: f32, uv: vec2f, dx: vec2f, dy: vec2f) -> vec4f {
  return textureSampleGrad(uSurfaceTiles, uSurfaceTilesSampler, uv, i32(layer), dx, dy);
}
