// The ground's surface tiles (textures/surfaces.js): one texture array, so a
// shader reads them all through one texture unit. Its layers:
#define TILE_GRAIN 0.0
#define TILE_RIPPLES 1.0
#define TILE_ROCK 2.0
#define TILE_GRASS 3.0
#define TILE_LITTER 4.0

uniform mediump sampler2DArray uSurfaceTiles;

// A layer's texel at uv (in tiles), filtered over the pixel's footprint (the derivatives of uv).
vec4 surfaceTile(float layer, vec2 uv, vec2 dx, vec2 dy) {
  return textureGrad(uSurfaceTiles, vec3(uv, layer), dx, dy);
}
