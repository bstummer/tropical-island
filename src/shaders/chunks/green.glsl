// Soil and grass base (PLAN.md Stage 4): the ground inland that is neither
// sand nor rock. Living green covers a share of it and bare ground the rest,
// in patches: grasses and herbs where the ground is open, the dark leafy
// understory where it is lush; sandy soil behind the beach, dead leaves over
// dark soil further in. The shares follow the ground's band (the scrub, the
// palm belt, the jungle) and how lush it is (world/island.js lushOf), and
// greenAlbedo() is their average (world/albedo.js greenAlbedo is its twin).
// The patches lie where they lie, whatever the camera does, and JS knows them
// (world/green.js, the twin of greenCover and greenPatches). Over hundreds of
// metres the green turns a little drier or deeper, and in clumps of a metre
// or so lighter or darker, keeping that average. The patches show where a
// pixel is small enough to see them, and fade into the average where it
// isn't, so a far hill keeps it too. Seen at a slant, what grows hides the
// bare ground between it, as a canopy hides the ground from the side: the
// bare patches take on its green, the less the more upright, so from above
// the shares hold.
//
// Near the camera (GREEN_DETAIL, within uGreenRange) the tiles of
// textures/green.js (chunks/tiles.glsl) show what each is made of: blades of grass over the
// sward's dark depths, a few gone to straw; leaves, green ones over the grass
// as far as the ground is lush, dead ones over the soil as far as the bare
// ground is litter; and soil in crumbs (the sand's grain, larger). Each keeps
// its albedo on average, at every distance, and the tufts fray the patches'
// edges. Positions are world xz, with their derivatives (dpdx, dpdy) passed
// in, so a caller can branch around it.

#include "noise.glsl"
#include "patches.glsl"
#include "sand.glsl"

uniform vec3 uGrass; // linear albedos, as all here
uniform vec3 uLeafy;
uniform vec3 uSoil;
uniform vec3 uLitter;
uniform vec3 uGreenOpen; // the share that is green at the scrub, the palm belt and the jungle, on open ground
uniform vec3 uGreenLush; // and on lush ground
uniform vec3 uGreenLitter; // the share of the bare ground that is litter, at the same
uniform vec4 uGreenTone; // how the green turns over hundreds of metres: a factor's change, rgb, per unit; wavelength (m)
uniform vec3 uGrassMean; // the grass tile's colour factor on average (its rgb x 4)
uniform float uGrassCover; // how much of its tile the blades cover, on average
uniform float uLitterCover; // how much of its tile the leaves cover, on average
uniform vec3 uGreenTiles; // the grass's and the litter's tiles (m); how much larger soil's crumbs are than the sand's grains
uniform vec3 uLeafLight; // a leaf's factor at tone 0, and at 1
uniform vec3 uLeafDark;
uniform float uGreenRange; // m from the camera: beyond it the green is its patches alone
uniform vec2 uGreenClumps; // how much the clumps lighten or darken it, and their size (m)
uniform float uGreenStand; // how much the green hides the bare ground when seen at a slant

struct Green {
  vec3 albedo;
  vec3 normal;
  float height; // how high the green stands, spread evenly over 0 to 1: highest in its patches' hearts
  float detail; // how much a pixel sees of its patches, 0 to 1
  float width; // how much its height changes across the pixel
};

// A value per band, from the scrub's (x) through the palm belt's to the
// jungle's (z), blended as world/island.js blends the bands.
float greenByBand(vec3 v, float band) {
  float palm = smoothstep(0.5, 1.5, band);
  float jungle = smoothstep(1.67, 2.33, band);
  return mix(mix(v.x, v.y, palm), v.z, jungle);
}

float greenCover(float band, float lush) {
  return mix(greenByBand(uGreenOpen, band), greenByBand(uGreenLush, band), lush);
}

vec3 greenLiving(float lush) {
  return mix(uGrass, uLeafy, lush);
}

// sandy: how sandy the soil is; sand: dry sand's albedo.
vec3 greenBare(float band, float sandy, vec3 sand) {
  return mix(mix(uSoil, sand, sandy), uLitter, greenByBand(uGreenLitter, band));
}

// The green's albedo on average: what a far pixel sees, and what lights shade from below.
vec3 greenAlbedo(float band, float lush, float sandy, vec3 sand) {
  return mix(greenBare(band, sandy, sand), greenLiving(lush), greenCover(band, lush));
}

// Things covering a share of the ground (`share`) over `under`, from a texel
// of their tile with how much of it they cover (`covers`) and their tone (0 to
// 1), and `cover`, how much they cover on average: of their albedo `on`, and
// once they cover all they can, the ground between them takes it too. As many
// of them as the share needs, the lightest first; `soft` blurs that choice,
// for a pixel too large to see one from another, where it keeps the share.
// present: how much of the point they cover.
vec3 greenOver(float covers, float tone, float cover, float share, float soft, vec3 on, vec3 under, out float present) {
  float shown = min(share / cover, 1.0);
  present = covers * mix(1.0 - smoothstep(shown - 0.02, shown + 0.02, tone), shown, soft);
  return mix(mix(under, on, max(share - cover, 0.0) / (1.0 - cover)), on, present);
}

// The tone of the things greenOver shows, on average: the lightest `shown`
// of them where a pixel tells them apart, all of them (0.5) where `soft`.
float greenShownTone(float shown, float soft) {
  return mix(0.5 * min(shown, 1.0), 0.5, soft);
}

// Two reads of a tile, the second turned and smaller, so the repeats never
// line up: each texel takes the one standing higher by `key` (weights of its
// channels), leaning one way or the other in patches; `soft` blurs the choice.
// The second's normal (rg) is turned back.
vec4 greenTile(float layer, vec2 xz, vec2 dpdx, vec2 dpdy, float size, vec4 key, float lean, float soft, bool normal) {
  const float C = 0.6;
  const float S = 0.8;
  const float SMALLER = 0.71;
  vec4 a = surfaceTile(layer, xz / size, dpdx / size, dpdy / size);
  float second = SMALLER * size;
  vec4 b = surfaceTile(layer, sandRotate(xz, C, S) / second + 0.43, sandRotate(dpdx, C, S) / second, sandRotate(dpdy, C, S) / second);
  if (normal) b.rg = sandRotate(b.rg * 2.0 - 1.0, C, -S) * 0.5 + 0.5;
  float w = 0.05 + soft;
  return mix(b, a, smoothstep(-w, w, dot(a - b, key) + lean));
}

// n: the ground's normal; band, lush and sandy: its ground
// (chunks/terrain.glsl terrainGround); sand: dry sand's albedo.
Green green(vec3 position, vec3 n, float band, float lush, float sandy, vec3 sand, vec2 dpdx, vec2 dpdy) {
  vec2 xz = position.xz;
  float footprint = max(length(dpdx), length(dpdy)); // metres a pixel spans on the ground
  float cover = greenCover(band, lush);
  float litter = greenByBand(uGreenLitter, band);
  // Seen at a slant, bare ground shows through the green as through layers
  // of it, as many more as the path through them is longer: of the bare
  // patches this much takes on the green.
  float slant = 1.0 / max(dot(n, normalize(cameraPosition - position)), 0.05);
  float hidden = 1.0 - pow(max(1.0 - cover, 1e-4), uGreenStand * (slant - 1.0));

  // Over hundreds of metres the green turns drier or deeper, on average neither.
  float tone = gradientNoise(xz / uGreenTone.w) / 0.24;
  vec3 living = greenLiving(lush) * max(vec3(0.0), 1.0 + clamp(tone, -1.5, 1.5) * uGreenTone.xyz);
  vec3 bare = greenBare(band, sandy, sand);
#ifdef GREEN_DETAIL
  // Clumps, taller and darker or shorter and lighter, and a little drier,
  // their edges as sharp as a pixel allows, until a pixel covers one. They
  // fade before the detail's range ends.
  float fine = 1.0 - smoothstep(0.5 * uGreenRange, 0.9 * uGreenRange, length(position - cameraPosition));
  vec2 q = xz / uGreenClumps.y;
  float clump = (0.6 * gradientNoise(q) + 0.4 * gradientNoise(q * 2.7 + vec2(1.9, -4.4))) / 0.18;
  float blur = 0.6 + 8.0 * footprint / uGreenClumps.y;
  clump = 1.3 * (2.0 * smoothstep(-blur, blur, clump) - 1.0);
  clump *= fine * (1.0 - smoothstep(0.1, 0.4, footprint / uGreenClumps.y));
  living *= max(vec3(0.0), (1.0 + uGreenClumps.x * clump) * (1.0 + 0.5 * clump * uGreenTone.xyz));
  bare *= 1.0 - 0.5 * uGreenClumps.x * clump;
#endif

  // Patches of green and bare, where the noise falls under the green's share;
  // their edges soften by as much as the noise changes across the pixel, and
  // once that is a good part of its range they give way to the share itself.
  vec3 patches = greenPatches(xz);
  float u = patches.x;
  float across = abs(dot(patches.yz, dpdx)) + abs(dot(patches.yz, dpdy));
  float seen = 1.0 - smoothstep(0.15, 0.4, across);
  float edge = mix(0.15, 0.02, uGreenPatches.y) + across;

  Green g;
  g.normal = n;
  g.detail = seen;
  g.width = across;
#ifdef GREEN_DETAIL
  float near = (1.0 - smoothstep(0.75 * uGreenRange, uGreenRange, length(position - cameraPosition))) * (1.0 - smoothstep(0.02, 0.05, footprint));
  if (near > 0.0) {
    // How far a pixel is from telling a leaf or a blade from the next.
    float soft = smoothstep(0.003, 0.02, footprint);
    float lean = 0.6 * gradientNoise(xz * 0.7 + 3.1);
    vec4 grass = greenTile(TILE_GRASS, xz, dpdx, dpdy, uGreenTiles.x, vec4(0.0, 0.5, 0.0, 1.0), lean, soft, false);
    vec4 leaves = greenTile(TILE_LITTER, xz, dpdx, dpdy, uGreenTiles.y, vec4(0.0, 0.0, 0.0, 1.0), lean, soft, true);

    // The bare ground: coarse sand and soil in crumbs, mottled where it holds
    // more or less humus, under as many dead leaves as its share of litter,
    // the lightest first.
    float crumbs = uGreenTiles.z * uSandTiles.x;
    vec3 grain = surfaceTile(TILE_GRAIN, xz / crumbs, dpdx / crumbs, dpdy / crumbs).rgb * 2.0 / uSandGrainMean;
    vec3 soil = mix(uSoil, sand, sandy) * mix(vec3(1.0), grain, 0.6) * (1.0 + 0.12 * gradientNoise(xz * 3.0 - 7.7));
    float dead;
    vec3 deadLeaf = uLitter * mix(uLeafLight, uLeafDark, leaves.b) / mix(uLeafLight, uLeafDark, greenShownTone(litter / uLitterCover, soft));
    vec3 ground = greenOver(leaves.a, leaves.b, uLitterCover, litter, soft, deadLeaf, soil, dead);
    // The green: blades over the sward's depths, their colour the tile's
    // (its average 1, at every mip level), and green leaves on them as far as
    // it is lush, the darkest first. Tufts reach out into the bare ground and
    // the gaps between them give way first: the patches' edges fray by a
    // blade or two, as much one way as the other.
    vec3 sward = living * grass.rgb * 4.0 / uGrassMean;
    float fresh;
    float share = 0.6 * lush;
    vec3 freshLeaf = living * mix(uLeafLight, uLeafDark, leaves.b) / mix(uLeafLight, uLeafDark, 1.0 - greenShownTone(share / uLitterCover, soft));
    vec3 green = greenOver(leaves.a, 1.0 - leaves.b, uLitterCover, share, soft, freshLeaf, sward, fresh);
    u = mix(u, clamp(u - 0.3 * (1.0 - soft) * (grass.a - uGrassCover), 0.0, 1.0), near);
    edge = mix(edge, 0.02 + across, near);
    living = mix(living, green, near);
    bare = mix(bare, ground, near);

    // Leaves lie tilted by their own curl, where they are.
    float inside = 1.0 - smoothstep(cover - edge, cover + edge, u);
    vec3 tilt = vec3(leaves.r * 2.0 - 1.0, 0.0, leaves.g * 2.0 - 1.0);
    g.normal = normalize(n + near * (1.0 - soft) * mix(dead, max(fresh, dead * (1.0 - grass.a)), inside) * tilt);
  }
#endif
  float inPatch = 1.0 - smoothstep(cover - edge, cover + edge, u);
  vec3 seenBare = mix(bare, living, hidden);
  g.albedo = mix(mix(seenBare, living, cover), mix(seenBare, living, inPatch), seen);
  g.height = 1.0 - u;
  return g;
}

// The sand's share of what is sand or green where the two meet, from its
// share there (sand): sand only where the green stands lower than that share,
// so the edge runs raggedly round the green's patches, and since its height
// is spread evenly, the sand keeps its share on average. As the patches fade
// from a far pixel, so does the edge's raggedness.
float greenSandShare(float sand, Green g) {
  float edge = 0.02 + g.width;
  return mix(sand, smoothstep(-edge, edge, sand - g.height), g.detail);
}
