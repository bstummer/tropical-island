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
// textures/green.js (chunks/tiles.wgsl) show what each is made of: blades of grass over the
// sward's dark depths, a few gone to straw; leaves, green ones over the grass
// as far as the ground is lush, dead ones over the soil as far as the bare
// ground is litter; and soil in crumbs (the sand's grain, larger). Each keeps
// its albedo on average, at every distance, and the tufts fray the patches'
// edges. Positions are world xz, with their derivatives (dpdx, dpdy) passed
// in, so a caller can branch around it.

#include "noise.wgsl"
#include "patches.wgsl"
#include "sand.wgsl"

override GREEN_DETAIL: bool = false;

struct GreenUniforms {
  uGrass: vec3f, // linear albedos, as all here
  uLeafy: vec3f,
  uSoil: vec3f,
  uLitter: vec3f,
  uGreenOpen: vec3f, // the share that is green at the scrub, the palm belt and the jungle, on open ground
  uGreenLush: vec3f, // and on lush ground
  uGreenLitter: vec3f, // the share of the bare ground that is litter, at the same
  uGreenTone: vec4f, // how the green turns over hundreds of metres: a factor's change, rgb, per unit; wavelength (m)
  uGrassMean: vec3f, // the grass tile's colour factor on average (its rgb x 4)
  uGrassCover: f32, // how much of its tile the blades cover, on average
  uLitterCover: f32, // how much of its tile the leaves cover, on average
  uGreenTiles: vec3f, // the grass's and the litter's tiles (m); how much larger soil's crumbs are than the sand's grains
  uLeafLight: vec3f, // a leaf's factor at tone 0, and at 1
  uLeafDark: vec3f,
  uGreenRange: f32, // m from the camera: beyond it the green is its patches alone
  uGreenClumps: vec2f, // how much the clumps lighten or darken it, and their size (m)
  uGreenStand: f32, // how much the green hides the bare ground when seen at a slant
}

@group(1) @binding(20) var<uniform> greenParams: GreenUniforms;

struct Green {
  albedo: vec3f,
  normal: vec3f,
  height: f32, // how high the green stands, spread evenly over 0 to 1: highest in its patches' hearts
  detail: f32, // how much a pixel sees of its patches, 0 to 1
  width: f32, // how much its height changes across the pixel
}

// A value per band, from the scrub's (x) through the palm belt's to the
// jungle's (z), blended as world/island.js blends the bands.
fn greenByBand(v: vec3f, band: f32) -> f32 {
  let palm = smoothstep(0.5, 1.5, band);
  let jungle = smoothstep(1.67, 2.33, band);
  return mix(mix(v.x, v.y, palm), v.z, jungle);
}

fn greenCover(band: f32, lush: f32) -> f32 {
  return mix(greenByBand(greenParams.uGreenOpen, band), greenByBand(greenParams.uGreenLush, band), lush);
}

fn greenLiving(lush: f32) -> vec3f {
  return mix(greenParams.uGrass, greenParams.uLeafy, lush);
}

// sandy: how sandy the soil is; sand: dry sand's albedo.
fn greenBare(band: f32, sandy: f32, sand: vec3f) -> vec3f {
  return mix(mix(greenParams.uSoil, sand, sandy), greenParams.uLitter, greenByBand(greenParams.uGreenLitter, band));
}

// The green's albedo on average: what a far pixel sees, and what lights shade from below.
fn greenAlbedo(band: f32, lush: f32, sandy: f32, sand: vec3f) -> vec3f {
  return mix(greenBare(band, sandy, sand), greenLiving(lush), greenCover(band, lush));
}

// Things covering a share of the ground (`share`) over `under`, from a texel
// of their tile with how much of it they cover (`covers`) and their tone (0 to
// 1), and `cover`, how much they cover on average: of their albedo `on`, and
// once they cover all they can, the ground between them takes it too. As many
// of them as the share needs, the lightest first; `soft` blurs that choice,
// for a pixel too large to see one from another, where it keeps the share.
// present: how much of the point they cover.
fn greenOver(covers: f32, tone: f32, cover: f32, share: f32, soft: f32, on: vec3f, under: vec3f, present: ptr<function, f32>) -> vec3f {
  let shown = min(share / cover, 1.0);
  *present = covers * mix(1.0 - smoothstep(shown - 0.02, shown + 0.02, tone), shown, soft);
  return mix(mix(under, on, max(share - cover, 0.0) / (1.0 - cover)), on, *present);
}

// The tone of the things greenOver shows, on average: the lightest `shown`
// of them where a pixel tells them apart, all of them (0.5) where `soft`.
fn greenShownTone(shown: f32, soft: f32) -> f32 {
  return mix(0.5 * min(shown, 1.0), 0.5, soft);
}

// Two reads of a tile, the second turned and smaller, so the repeats never
// line up: each texel takes the one standing higher by `key` (weights of its
// channels), leaning one way or the other in patches; `soft` blurs the choice.
// The second's normal (rg) is turned back.
fn greenTile(layer: f32, xz: vec2f, dpdx: vec2f, dpdy: vec2f, size: f32, key: vec4f, lean: f32, soft: f32, normal: bool) -> vec4f {
  const C: f32 = 0.6;
  const S: f32 = 0.8;
  const SMALLER: f32 = 0.71;
  let a = surfaceTile(layer, xz / size, dpdx / size, dpdy / size);
  let second = SMALLER * size;
  var b = surfaceTile(layer, sandRotate(xz, C, S) / second + 0.43, sandRotate(dpdx, C, S) / second, sandRotate(dpdy, C, S) / second);
  if (normal) {
    b = vec4f(sandRotate(b.rg * 2.0 - 1.0, C, -S) * 0.5 + 0.5, b.ba); // GLSL: b.rg = ...
  }
  let w = 0.05 + soft;
  return mix(b, a, smoothstep(-w, w, dot(a - b, key) + lean));
}

// n: the ground's normal; band, lush and sandy: its ground
// (chunks/terrain.wgsl terrainGround); sand: dry sand's albedo.
fn green(position: vec3f, n: vec3f, band: f32, lush: f32, sandy: f32, sand: vec3f, dpdx: vec2f, dpdy: vec2f) -> Green {
  let xz = position.xz;
  let footprint = max(length(dpdx), length(dpdy)); // metres a pixel spans on the ground
  let cover = greenCover(band, lush);
  let litter = greenByBand(greenParams.uGreenLitter, band);
  // Seen at a slant, bare ground shows through the green as through layers
  // of it, as many more as the path through them is longer: of the bare
  // patches this much takes on the green.
  let slant = 1.0 / max(dot(n, normalize(frame.cameraPosition - position)), 0.05);
  let hidden = 1.0 - pow(max(1.0 - cover, 1e-4), greenParams.uGreenStand * (slant - 1.0));

  // Over hundreds of metres the green turns drier or deeper, on average neither.
  let tone = gradientNoise(xz / greenParams.uGreenTone.w) / 0.24;
  var living = greenLiving(lush) * max(vec3f(0.0), 1.0 + clamp(tone, -1.5, 1.5) * greenParams.uGreenTone.xyz);
  var bare = greenBare(band, sandy, sand);
  if (GREEN_DETAIL) {
    // Clumps, taller and darker or shorter and lighter, and a little drier,
    // their edges as sharp as a pixel allows, until a pixel covers one. They
    // fade before the detail's range ends.
    let fine = 1.0 - smoothstep(0.5 * greenParams.uGreenRange, 0.9 * greenParams.uGreenRange, length(position - frame.cameraPosition));
    let q = xz / greenParams.uGreenClumps.y;
    var clump = (0.6 * gradientNoise(q) + 0.4 * gradientNoise(q * 2.7 + vec2f(1.9, -4.4))) / 0.18;
    let blur = 0.6 + 8.0 * footprint / greenParams.uGreenClumps.y;
    clump = 1.3 * (2.0 * smoothstep(-blur, blur, clump) - 1.0);
    clump *= fine * (1.0 - smoothstep(0.1, 0.4, footprint / greenParams.uGreenClumps.y));
    living *= max(vec3f(0.0), (1.0 + greenParams.uGreenClumps.x * clump) * (1.0 + 0.5 * clump * greenParams.uGreenTone.xyz));
    bare *= 1.0 - 0.5 * greenParams.uGreenClumps.x * clump;
  }

  // Patches of green and bare, where the noise falls under the green's share;
  // their edges soften by as much as the noise changes across the pixel, and
  // once that is a good part of its range they give way to the share itself.
  let patches = greenPatches(xz);
  var u = patches.x;
  let across = abs(dot(patches.yz, dpdx)) + abs(dot(patches.yz, dpdy));
  let seen = 1.0 - smoothstep(0.15, 0.4, across);
  var edge = mix(0.15, 0.02, patchParams.uGreenPatches.y) + across;

  var g: Green;
  g.normal = n;
  g.detail = seen;
  g.width = across;
  if (GREEN_DETAIL) {
    let near = (1.0 - smoothstep(0.75 * greenParams.uGreenRange, greenParams.uGreenRange, length(position - frame.cameraPosition))) * (1.0 - smoothstep(0.02, 0.05, footprint));
    if (near > 0.0) {
      // How far a pixel is from telling a leaf or a blade from the next.
      let soft = smoothstep(0.003, 0.02, footprint);
      let lean = 0.6 * gradientNoise(xz * 0.7 + 3.1);
      let grass = greenTile(TILE_GRASS, xz, dpdx, dpdy, greenParams.uGreenTiles.x, vec4f(0.0, 0.5, 0.0, 1.0), lean, soft, false);
      let leaves = greenTile(TILE_LITTER, xz, dpdx, dpdy, greenParams.uGreenTiles.y, vec4f(0.0, 0.0, 0.0, 1.0), lean, soft, true);

      // The bare ground: coarse sand and soil in crumbs, mottled where it holds
      // more or less humus, under as many dead leaves as its share of litter,
      // the lightest first.
      let crumbs = greenParams.uGreenTiles.z * sandParams.uSandTiles.x;
      let grain = surfaceTile(TILE_GRAIN, xz / crumbs, dpdx / crumbs, dpdy / crumbs).rgb * 2.0 / sandParams.uSandGrainMean;
      let soil = mix(greenParams.uSoil, sand, sandy) * mix(vec3f(1.0), grain, 0.6) * (1.0 + 0.12 * gradientNoise(xz * 3.0 - 7.7));
      var dead: f32;
      let deadLeaf = greenParams.uLitter * mix(greenParams.uLeafLight, greenParams.uLeafDark, leaves.b) / mix(greenParams.uLeafLight, greenParams.uLeafDark, greenShownTone(litter / greenParams.uLitterCover, soft));
      let ground = greenOver(leaves.a, leaves.b, greenParams.uLitterCover, litter, soft, deadLeaf, soil, &dead);
      // The green: blades over the sward's depths, their colour the tile's
      // (its average 1, at every mip level), and green leaves on them as far as
      // it is lush, the darkest first. Tufts reach out into the bare ground and
      // the gaps between them give way first: the patches' edges fray by a
      // blade or two, as much one way as the other.
      let sward = living * grass.rgb * 4.0 / greenParams.uGrassMean;
      var fresh: f32;
      let share = 0.6 * lush;
      let freshLeaf = living * mix(greenParams.uLeafLight, greenParams.uLeafDark, leaves.b) / mix(greenParams.uLeafLight, greenParams.uLeafDark, 1.0 - greenShownTone(share / greenParams.uLitterCover, soft));
      let green = greenOver(leaves.a, 1.0 - leaves.b, greenParams.uLitterCover, share, soft, freshLeaf, sward, &fresh);
      u = mix(u, clamp(u - 0.3 * (1.0 - soft) * (grass.a - greenParams.uGrassCover), 0.0, 1.0), near);
      edge = mix(edge, 0.02 + across, near);
      living = mix(living, green, near);
      bare = mix(bare, ground, near);

      // Leaves lie tilted by their own curl, where they are.
      let inside = 1.0 - smoothstep(cover - edge, cover + edge, u);
      let tilt = vec3f(leaves.r * 2.0 - 1.0, 0.0, leaves.g * 2.0 - 1.0);
      g.normal = normalize(n + near * (1.0 - soft) * mix(dead, max(fresh, dead * (1.0 - grass.a)), inside) * tilt);
    }
  }
  let inPatch = 1.0 - smoothstep(cover - edge, cover + edge, u);
  let seenBare = mix(bare, living, hidden);
  g.albedo = mix(mix(seenBare, living, cover), mix(seenBare, living, inPatch), seen);
  g.height = 1.0 - u;
  return g;
}

// The sand's share of what is sand or green where the two meet, from its
// share there (sand): sand only where the green stands lower than that share,
// so the edge runs raggedly round the green's patches, and since its height
// is spread evenly, the sand keeps its share on average. As the patches fade
// from a far pixel, so does the edge's raggedness.
fn greenSandShare(sand: f32, g: Green) -> f32 {
  let edge = 0.02 + g.width;
  return mix(sand, smoothstep(-edge, edge, sand - g.height), g.detail);
}
