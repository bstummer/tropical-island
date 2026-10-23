// Rock (PLAN.md Stage 4): its albedo, normal and gloss at a point, from a far
// cliff down to the cracks at your feet. Nothing is mapped along the
// heightmap's grid, which stretches down a cliff: every part is a field in
// world space. Relief from metres to decimetres is noise in 3D, sharp-crested
// or rounded, stretched along or across the vertical; the detail tile
// (textures/rock.js) lies along the two axes the normal leans along most,
// blended by how much, and finer, turned, along the one it leans along most. All of it tilts the normal as a height would (the
// gradient of a height field in 3D, less its part along the normal), so it
// needs no tangents. Streaks run down steep faces, layers cross them, lichen
// grows on what faces the sky, and the sea darkens and wets the rock it
// reaches, with a dark band above. Each part fades once a pixel covers it,
// so far rock keeps its albedo and nothing sparkles. The tile and the lichen
// come with ROCK_DETAIL, within uRockRange of the camera and fading out before
// it: world/terrain.js draws rock beyond it with a cheaper shader. Textures are
// read with the pixel's derivatives, passed in (dpdx, dpdy: of the world
// position), so a caller can branch around it.

#include "noise.glsl"
#include "lighting.glsl"

uniform sampler2D uRockTile;
uniform vec3 uRockMean; // the tile's average colour factor, which the albedo keeps
uniform vec3 uRockTints[2]; // the two minerals' colour factors
uniform vec2 uRockScales; // the tile, m; the finer read's share of it
uniform vec4 uRockRelief; // the largest relief's scale (m); its height, of the scale; how sharp its crests, 0 to 1; how stretched along the vertical (below 1) or across it
uniform float uRockTone; // how much the albedo varies with the relief
uniform vec4 uRockStreaks; // the colour factor of streaks down steep faces; their strength
uniform vec4 uRockStrata; // layers: their spacing (m); how much their tone varies; how much they step out as ledges
uniform vec4 uRockLichen; // the lichen's albedo; how much of the faces that face up it covers
uniform vec4 uRockLichenSecond; // a second kind's albedo; the share of patches it takes
uniform vec4 uRockWet; // the sea wets the rock up to .x m above it, darkening it by .y; a dark band from .z to .w m
uniform float uRockBand; // the band's darkness factor
uniform vec2 uRockRoughness; // dry and wet
uniform float uRockRange; // m from the camera: beyond it, no detail (ROCK_DETAIL)

struct Rock {
  vec3 albedo;
  vec3 normal;
  float roughness;
  float f0;
  float height; // how high the relief stands here, about -1 to 1; 0 where none shows
  float relief; // how much of the relief shows, 0 far away to 1
};

// How much of a pixel is rock, by its height: where rock gives way to sand or
// soil it stands out of them on its crests, and they fill its hollows, as much
// as `cover` says on average. Far away, where its relief fades, `cover` itself.
// width: how much the height changes across the pixel (fwidth), so the edge
// never gets sharper than a pixel.
float rockShare(float cover, Rock r, float width) {
  if (cover >= 1.0) return 1.0;
  float threshold = 1.0 - 2.0 * cover;
  float edge = 0.15 + width;
  return mix(cover, smoothstep(threshold - edge, threshold + edge, r.height), r.relief);
}

// The rock's albedo from afar, before its detail: what the terrain draws where
// it leaves the detail out.
vec3 rockAlbedo(vec3 albedo, float aboveSea) {
  return albedo * mix(1.0, uRockWet.y, 1.0 - smoothstep(0.5 * uRockWet.x, uRockWet.x, aboveSea));
}

// A relief's shape, from noise's value and gradient: `ridged` 0 leaves it
// smooth, 1 folds it about zero into sharp crests.
vec4 rockCrest(vec4 noise, float ridged) {
  vec4 folded = vec4(1.0 - 2.0 * abs(noise.x), -2.0 * sign(noise.x) * noise.yzw);
  return mix(noise, folded, ridged);
}

// The tile read along one axis: the slope of its height across the plane
// (du, dv) and its colour factor.
void rockTile(vec2 uv, vec2 dx, vec2 dy, float scale, out vec2 slope, out vec3 colour) {
  vec4 t = textureGrad(uRockTile, uv / scale, dx / scale, dy / scale);
  vec2 xy = t.xy * 2.0 - 1.0;
  float z = sqrt(max(1.0 - dot(xy, xy), 0.04));
  slope = -xy / z;
  colour = mix(uRockTints[0], uRockTints[1], t.a) * (2.0 * t.b);
}

// The tile on the plane of world axes u and v: the height's gradient in world
// space, and the colour factor. Each plane reads its own part of the tile.
void rockPlane(vec3 p, vec3 dpdx, vec3 dpdy, int u, int v, float scale, out vec3 gradient, out vec3 colour) {
  vec2 slope;
  float offset = 0.37 * float(u + 2 * v);
  rockTile(vec2(p[u], p[v]) + offset, vec2(dpdx[u], dpdx[v]), vec2(dpdy[u], dpdy[v]), scale, slope, colour);
  gradient = vec3(0.0);
  gradient[u] = slope.x;
  gradient[v] = slope.y;
}

// The axis along which n leans most, with the two that follow it.
ivec3 rockMost(vec3 a) {
  return a.x > a.y && a.x > a.z ? ivec3(0, 1, 2) : a.y > a.z ? ivec3(1, 2, 0) : ivec3(2, 0, 1);
}

// The tile along the two axes the normal n leans along most, blended by how
// much (biplanar, after Quilez: two reads where three would show little more):
// the height's gradient in world space, and the colour factor.
void rockBiplanar(vec3 p, vec3 dpdx, vec3 dpdy, vec3 n, float scale, out vec3 gradient, out vec3 colour) {
  vec3 a = abs(n);
  ivec3 most = rockMost(a);
  ivec3 least = a.x < a.y && a.x < a.z ? ivec3(0, 1, 2) : a.y < a.z ? ivec3(1, 2, 0) : ivec3(2, 0, 1);
  ivec3 next = ivec3(3) - most - least;
  vec3 g1;
  vec3 g2;
  vec3 c1;
  vec3 c2;
  rockPlane(p, dpdx, dpdy, most.y, most.z, scale, g1, c1);
  rockPlane(p, dpdx, dpdy, next.y, next.z, scale, g2, c2);
  vec2 w = clamp((vec2(a[most.x], a[next.x]) - 0.5773) / (1.0 - 0.5773), 0.0, 1.0);
  w *= w;
  w /= w.x + w.y + 1e-4;
  gradient = w.x * g1 + w.y * g2;
  colour = w.x * c1 + w.y * c2;
}

// n: the ground's normal; view: towards the eye; albedo: the rock's
// (config.world.terrain.albedo).
Rock rock(vec3 position, float aboveSea, vec3 n, vec3 view, vec3 albedo, vec3 dpdx, vec3 dpdy) {
  float footprint = max(length(dpdx), length(dpdy)); // metres a pixel spans on the rock
  Rock r;
  r.albedo = albedo;
  r.f0 = 0.04;
  r.relief = 0.0;
  vec3 gradient = vec3(0.0);

  // Relief: three octaves, each a third the size, as tall for its size; the
  // tile takes over below them.
  vec3 stretch = vec3(1.0, uRockRelief.w, 1.0);
  float scale = uRockRelief.x;
  float tone = 0.0;
  float middle = 0.0; // the octaves' values, which more than the relief follows
  float smallest = 0.0;
  for (int k = 0; k < 3; k++) {
    float fade = 1.0 - smoothstep(0.1, 0.3, footprint / scale); // creases alias early
    vec4 noise = gradientNoise3D(position * stretch / scale + float(k) * 17.1);
    gradient += fade * uRockRelief.y * rockCrest(noise, uRockRelief.z).yzw * stretch;
    tone += fade * noise.x / float(k + 1);
    if (k == 1) {
      r.relief = fade;
      middle = noise.x;
    }
    smallest = noise.x;
    scale /= 3.0;
  }
  r.albedo *= 1.0 + uRockTone * tone;

  // Layers across steep faces, thicker and thinner, each its own tone and
  // blending into the next; the top of each steps out as a ledge, in stretches.
  float steep = smoothstep(0.3, 0.7, 1.0 - n.y);
  float layered = position.y / uRockStrata.x + 0.8 * gradientNoise(position.xz / 50.0) + 0.25 * middle;
  float fadeLayers = steep * (1.0 - smoothstep(0.05, 0.15, footprint / uRockStrata.x));
  float layer = floor(layered);
  float within = layered - layer;
  float layerTone = mix(noiseHash22(vec2(layer, 3.7)).x, noiseHash22(vec2(layer + 1.0, 3.7)).x, smoothstep(0.6, 1.0, within));
  r.albedo *= 1.0 + uRockStrata.y * layerTone * fadeLayers;
  float ledge = smoothstep(0.6, 0.9, within) * (1.0 - smoothstep(0.9, 1.0, within));
  float broken = smoothstep(-0.2, 0.3, smallest);
  gradient.y -= 4.0 * uRockStrata.z * fadeLayers * ledge * broken;

  // Streaks down steep faces where water runs, a hand or two wide and metres long.
  float streak = gradientNoise3(position * vec3(1.0 / 0.9, 1.0 / 9.0, 1.0 / 0.9) + 5.3);
  float streaked = steep * uRockStreaks.w * smoothstep(-0.1, 0.5, streak) * (1.0 - smoothstep(0.2, 0.6, footprint));
  r.albedo *= mix(vec3(1.0), uRockStreaks.rgb, streaked);

  vec3 grainy = vec3(1.0);
  float lichen = 0.0;
  vec3 lichenAlbedo = vec3(0.0);
#ifdef ROCK_DETAIL
  float near = 1.0 - smoothstep(0.75 * uRockRange, uRockRange, length(position - cameraPosition));
  if (near > 0.0) {
    // The tile at two scales.
    float tile = uRockScales.x;
    vec3 g;
    vec3 colour;
    rockBiplanar(position, dpdx, dpdy, n, tile, g, colour);
    grainy = mix(vec3(1.0), colour / uRockMean, near);
    gradient += near * g;
    float fine = near * (1.0 - smoothstep(0.004, 0.012, footprint / (tile * uRockScales.y)));
    if (fine > 0.0) {
      // Grain this fine needs one read only: the tile across the axis the
      // normal leans along most, turned (transposed) so it doesn't line up
      // with the coarser read; where that axis changes, no seam shows in it.
      ivec3 most = rockMost(abs(n));
      rockPlane(position, dpdx, dpdy, most.z, most.y, tile * uRockScales.y, g, colour);
      gradient += fine * g;
      grainy *= mix(vec3(1.0), colour / uRockMean, fine);
    }

    // Lichen in patches on what faces up (so laid out across the ground), out
    // of the cracks; far away the patches blur into a tint rather than
    // speckle. Of two kinds, by the relief's smallest octave.
    float patches = gradientNoise(position.xz / 0.9 + 9.1) + 0.4 * (grainy.g - 1.0);
    float edge = 0.05 + 2.0 * footprint;
    lichen = near * smoothstep(-edge, edge, patches - 1.0 + 1.6 * uRockLichen.w) * smoothstep(0.7, 1.0, grainy.g);
    float kind = smoothstep(-0.1, 0.1, smallest + 1.0 - 2.0 * uRockLichenSecond.w);
    // A crust: the rock's grain shows through it.
    lichenAlbedo = mix(uRockLichen.rgb, uRockLichenSecond.rgb, kind) * (0.75 + 0.25 * grainy);
  }
#endif
  r.albedo *= grainy;
  r.height = clamp(2.0 * tone + 0.5 * (grainy.g - 1.0), -1.0, 1.0);

  // Bumps facing away from the eye would show their dark side: along a face,
  // the eye sees the sides of them that face it.
  r.normal = normalize(n - (gradient - n * dot(n, gradient)));
  r.normal = normalize(r.normal + max(0.1 - dot(r.normal, view), 0.0) * view);
  lichen *= smoothstep(0.0, 0.6, r.normal.y);
  r.albedo = mix(r.albedo, lichenAlbedo, 0.8 * lichen);

  // The sea: rock it reaches is wet and dark, its crests drying first; above
  // it, a dark band where spray keeps algae alive.
  float ragged = uRockWet.x * (0.25 * smallest + 0.4 * r.height);
  float wet = 1.0 - smoothstep(0.5 * uRockWet.x, uRockWet.x, aboveSea + ragged);
  float band = smoothstep(uRockWet.z - 0.3, uRockWet.z, aboveSea + ragged) * (1.0 - smoothstep(uRockWet.w - 0.4, uRockWet.w, aboveSea + 2.0 * ragged));
  r.albedo *= mix(1.0, uRockBand, band * (1.0 - lichen));
  r.albedo *= mix(1.0, uRockWet.y, wet);
  r.roughness = mix(uRockRoughness.x, uRockRoughness.y, wet);
  return r;
}

// The light rock mirrors towards the eye: wet rock's sheen, and only that.
// kernel: specularKernel() of n.
vec3 rockShine(Rock r, vec3 position, vec3 n, vec3 view, float kernel) {
  float glossy = 1.0 - smoothstep(0.6, 0.8, r.roughness);
  return glossy > 0.0 ? glossy * specularLight(position, n, view, filteredRoughness(r.roughness, kernel), r.f0) : vec3(0.0);
}
