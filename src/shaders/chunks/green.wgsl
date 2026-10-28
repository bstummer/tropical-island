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
// isn't, so a far hill keeps it too. Nothing here depends on where the camera
// stands but the detail's range: what lies on the ground, and where, is the
// same from anywhere, only filtered by the pixel (src/fixtures/patches.js
// checks it).
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

// The patches' edges blur, either side, over this share of their size at
// their softest (config.world.terrain.green.patches.sharp 0), and none at 1.
const GREEN_BLUR: f32 = 0.05;
// How much the patches' noise bends across a pixel, by the square of its
// width in patches: its curvature, about, at the threshold.
const GREEN_BEND: f32 = 6.0;
// The green's stands (green()): size (m), how much lighter or darker, and an offset.
const GREEN_STANDS = array<vec4f, 3>(vec4f(2.5, 0.2, 3.7, -8.1), vec4f(9.0, 0.16, -5.2, 2.9), vec4f(40.0, 0.12, 11.3, 6.6));

struct GreenUniforms {
  uGrass: vec3f, // linear albedos, as all here
  uLeafy: vec3f,
  uSoil: vec3f,
  uLitter: vec3f,
  uGreenOpen: vec3f, // the share that is green at the scrub, the palm belt and the jungle, on open ground
  uGreenLush: vec3f, // and on lush ground
  uGreenLitter: vec3f, // the share of the bare ground that is litter, at the same
  uGreenTone: vec4f, // how the green turns over hundreds of metres: a factor's change, rgb, per unit; wavelength (m)
  uGrassMean: vec3f, // the grass's colour factor on average (its tile's rgb x 4), its two reads laid over each other (greenTile)
  uGrassCover: f32, // how much the blades cover on average, the same
  uLitterCover: f32, // how much the leaves cover on average, the same
  uGrassDepths: f32, // the grass tile's colour factor between its blades
  uGreenTiles: vec3f, // the grass's and the litter's tiles (m); how much larger soil's crumbs are than the sand's grains
  uLeafLight: vec3f, // a leaf's factor at tone 0, and at 1
  uLeafDark: vec3f,
  uGreenRange: f32, // m from the camera: beyond it the green is its patches alone
  uGreenClumps: vec2f, // how much the clumps lighten or darken it, and their size (m)
  uLeafShares: vec4f, // the shares of the litter's leaves its masks show, the lightest first (textures/green.js leafShares)
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

// Leaves covering a share of the ground (`share`) over `under`, as much of the
// point as `present` (greenLeaves), and `cover`, how much the litter's
// leaves cover on average: of their albedo `on`, and once the share is more
// than they cover, the ground between them takes it too.
fn greenOver(present: f32, cover: f32, share: f32, on: vec3f, under: vec3f) -> vec3f {
  return mix(mix(under, on, max(share - cover, 0.0) / (1.0 - cover)), on, present);
}

// Of the litter's leaves (a point's masks, how much leaves cover it and their
// tone), how much of the point the lightest `shown` of them cover (of all the
// leaves, 0 to 1): those of the masks' share below it, none below the first
// and all above the last (textures/litter-tones.js), and of those up to the
// next, the ones lighter than `shown`, as far as a pixel sees their own tone
// (`own`, greenLeafOwn), the rest in part, which keeps the share. The masks
// are mipmapped, so a pixel sees how much of it those leaves cover, at any
// distance: the same leaves show, shrinking with it, until too small to see.
fn greenLeaves(masks: vec4f, covers: f32, tone: f32, own: f32, shown: f32) -> f32 {
  let q = greenParams.uLeafShares;
  var lo = vec2f(0.0); // a share and its mask
  var hi = vec2f(1.0, covers);
  for (var k = 0; k < 4; k++) {
    lo = select(lo, vec2f(q[k], masks[k]), q[k] < shown);
    hi = select(hi, vec2f(q[3 - k], masks[3 - k]), q[3 - k] >= shown);
  }
  let part = clamp((shown - lo.x) / max(hi.x - lo.x, 1e-4), 0.0, 1.0);
  let lighter = 1.0 - smoothstep(shown - 0.01, shown + 0.01, tone);
  return lo.y + max(hi.y - lo.y, 0.0) * mix(part, lighter, greenLeafPicks(own, part));
}

// How much greenLeaves picks the leaves between two masks by their tone
// rather than showing each in part: as far as a pixel sees their own tones
// (`own`), `part` of the way between the masks, but for the last fifth, over
// which it gives way to the upper mask, which is all there is at its end:
// tones mixed at the leaves' edges would leave out some of its own. (At the
// lower end, a hair from the mask, it is the lower mask alone.)
fn greenLeafPicks(own: f32, part: f32) -> f32 {
  return own * smoothstep(0.0, 0.05, part) * (1.0 - smoothstep(0.8, 1.0, part));
}

// The tone of the lightest `shown` of the leaves as greenLeaves shows them, on
// average, as the litter's tile spreads them evenly over 0 to 1
// (textures/litter-tones.js): those of the mask below, and of those up to the
// next, the ones lighter than `shown` as far as it picks them, and all, in
// part, as far as it doesn't.
fn greenShownTone(shown: f32, own: f32) -> f32 {
  let q = greenParams.uLeafShares;
  let x = clamp(shown, 0.0, 1.0);
  var lo = 0.0;
  var hi = 1.0;
  for (var k = 0; k < 4; k++) {
    lo = select(lo, q[k], q[k] < x);
    hi = select(hi, q[3 - k], q[3 - k] >= x);
  }
  let part = clamp((x - lo) / max(hi - lo, 1e-4), 0.0, 1.0);
  let picks = greenLeafPicks(own, part);
  return (lo * lo + (1.0 - picks) * part * (hi * hi - lo * lo) + picks * (x * x - lo * lo)) / max(2.0 * x, 1e-4);
}

// The same for the darkest `shown` of them: all of them but the lightest rest.
fn greenShownDarkTone(shown: f32, own: f32) -> f32 {
  let rest = 1.0 - clamp(shown, 0.0, 1.0);
  return (0.5 - rest * greenShownTone(rest, own)) / max(1.0 - rest, 1e-4);
}

// The tone of the leaves in a texel of the litter's tile, where they cover it:
// its tone (b) holds the soil's 0.5 where they don't (a).
fn greenLeafTone(leaves: vec4f) -> f32 {
  return clamp((leaves.b - (1.0 - leaves.a) * 0.5) / max(leaves.a, 1e-3), 0.0, 1.0);
}

// A leaf's colour factor at `tone` (0 light to 1 dark), over that of the
// leaves shown on average (`mean`, their tone: greenShownTone), so they keep
// their albedo on average however many show (fixtures/green-tiles.wgsl too).
// `own`: how much a pixel sees of the leaf's own tone (greenLeafOwn); the rest
// is their mean.
fn greenLeafFactor(tone: f32, mean: f32, own: f32) -> vec3f {
  return mix(greenParams.uLeafLight, greenParams.uLeafDark, mix(mean, tone, own)) / mix(greenParams.uLeafLight, greenParams.uLeafDark, mean);
}

// How much a pixel `footprint` metres across sees of a leaf's own tone: all
// of it while it is about a texel of the litter's tile, none once it is
// several. A larger one mixes the tones of the leaves in it, those shown with
// those not, so it can't tell their own from it.
fn greenLeafOwn(footprint: f32) -> f32 {
  let texel = greenParams.uGreenTiles.y / f32(textureDimensions(uSurfaceTiles).x);
  return 1.0 - smoothstep(1.0, 6.0, footprint / texel);
}

// Two reads of a tile, the second turned and smaller, so the repeats never
// line up, laid one over the other: what covers the top one (a) hides the
// other, which shows through its gaps. Which lies on top leans one way or the
// other in patches. `ground`: the tile's rgb where nothing covers it. The
// second's normal (rg) is turned back. On average they hold what
// world/green.js greenLayers says, at every distance.
fn greenTile(layer: f32, xz: vec2f, dpdx: vec2f, dpdy: vec2f, size: f32, ground: vec3f, lean: f32, normal: bool) -> vec4f {
  let r = greenReads(xz, dpdx, dpdy, size);
  let a = surfaceTile(layer, r.a, r.adx, r.ady);
  var b = surfaceTile(layer, r.b, r.bdx, r.bdy);
  if (normal) {
    b = greenTurnedBack(b);
  }
  return greenLaid(a, b, ground, lean);
}

// Where greenTile reads a tile `size` metres across, twice, with the
// derivatives of each.
struct GreenReads {
  a: vec2f,
  adx: vec2f,
  ady: vec2f,
  b: vec2f,
  bdx: vec2f,
  bdy: vec2f,
}

fn greenReads(xz: vec2f, dpdx: vec2f, dpdy: vec2f, size: f32) -> GreenReads {
  let second = GREEN_SMALLER * size;
  let c = GREEN_TURN.x;
  let s = GREEN_TURN.y;
  return GreenReads(xz / size, dpdx / size, dpdy / size, sandRotate(xz, c, s) / second + 0.43, sandRotate(dpdx, c, s) / second, sandRotate(dpdy, c, s) / second);
}

const GREEN_TURN: vec2f = vec2f(0.6, 0.8); // the second read's turn, its cosine and sine
const GREEN_SMALLER: f32 = 0.71; // and its size

// The second read's normal (rg) turned back.
fn greenTurnedBack(b: vec4f) -> vec4f {
  return vec4f(sandRotate(b.rg * 2.0 - 1.0, GREEN_TURN.x, -GREEN_TURN.y) * 0.5 + 0.5, b.ba); // GLSL: b.rg = ...
}

// Two reads laid one over the other (greenTile).
fn greenLaid(a: vec4f, b: vec4f, ground: vec3f, lean: f32) -> vec4f {
  return greenLaidBy(a, b, ground, smoothstep(-0.05, 0.05, lean));
}

// The same, the first on top as far as `top`.
fn greenLaidBy(a: vec4f, b: vec4f, ground: vec3f, top: f32) -> vec4f {
  let cover = 1.0 - (1.0 - a.a) * (1.0 - b.a);
  let aOnTop = vec4f(a.rgb + (1.0 - a.a) * (b.rgb - ground), cover);
  let bOnTop = vec4f(b.rgb + (1.0 - b.a) * (a.rgb - ground), cover);
  return mix(bOnTop, aOnTop, top);
}

// The litter as greenTile lays it (`leaves`, flat and of tone 0.5 on soil),
// and its leaves' masks laid the same way (`masks`, for greenLeaves): each
// read's show through the other's gaps. Where a pixel sees a leaf's own tone
// (`own`, greenLeafOwn), one read or the other lies on top, not both in part,
// so no leaf shows faintly through another.
struct GreenLitter {
  leaves: vec4f,
  masks: vec4f,
}

fn greenLitter(xz: vec2f, dpdx: vec2f, dpdy: vec2f, lean: f32, own: f32) -> GreenLitter {
  let r = greenReads(xz, dpdx, dpdy, greenParams.uGreenTiles.y);
  let a = surfaceTile(TILE_LITTER, r.a, r.adx, r.ady);
  let b = greenTurnedBack(surfaceTile(TILE_LITTER, r.b, r.bdx, r.bdy));
  let ma = surfaceTile(TILE_LEAVES, r.a, r.adx, r.ady);
  let mb = surfaceTile(TILE_LEAVES, r.b, r.bdx, r.bdy);
  let top = mix(smoothstep(-0.05, 0.05, lean), step(0.0, lean), own);
  return GreenLitter(greenLaidBy(a, b, vec3f(0.5), top), mix(mb + (1.0 - b.a) * ma, ma + (1.0 - a.a) * mb, top));
}

// n: the ground's normal; band, lush and sandy: its ground
// (chunks/terrain.wgsl terrainGround); sand: dry sand's albedo.
fn green(position: vec3f, n: vec3f, band: f32, lush: f32, sandy: f32, sand: vec3f, dpdx: vec2f, dpdy: vec2f) -> Green {
  return greenFrom(frame.cameraPosition, position, n, band, lush, sandy, sand, dpdx, dpdy);
}

// The same for a camera at `camera`, which decides only how far the detail
// reaches.
fn greenFrom(camera: vec3f, position: vec3f, n: vec3f, band: f32, lush: f32, sandy: f32, sand: vec3f, dpdx: vec2f, dpdy: vec2f) -> Green {
  let xz = position.xz;
  let footprint = max(length(dpdx), length(dpdy)); // metres a pixel spans on the ground
  let distance = length(position - camera);
  let cover = greenCover(band, lush);
  let litter = greenByBand(greenParams.uGreenLitter, band);

  // Over hundreds of metres the green turns drier or deeper, on average neither.
  let tone = gradientNoise(xz / greenParams.uGreenTone.w) / 0.24;
  var living = greenLiving(lush) * max(vec3f(0.0), 1.0 + clamp(tone, -1.5, 1.5) * greenParams.uGreenTone.xyz);
  var bare = greenBare(band, sandy, sand);
  var bareTone = 1.0; // how much lighter or darker the bare ground is here, near and far
  // Its texture beyond the detail's reach: bushes and tussocks a few metres
  // across and thickets of ten, taller and darker and deeper or shorter and
  // lighter and drier, and bands of tens of metres drier or lusher. Each
  // shows as sharp as a pixel allows and fades as a pixel grows past it; on
  // average none changes the green.
  var stands = 0.0;
  for (var k = 0; k < 3; k++) {
    let size = GREEN_STANDS[k].x;
    let n = gradientNoise(xz / size + GREEN_STANDS[k].zw) / 0.24;
    let blur = 0.5 + 6.0 * footprint / size;
    stands += GREEN_STANDS[k].y * (2.0 * smoothstep(-blur, blur, n) - 1.0) * (1.0 - smoothstep(0.08, 0.3, footprint / size));
  }
  living *= max(vec3f(0.0), 1.0 + stands * (1.0 + 4.0 * greenParams.uGreenTone.xyz)); // linear in stands, so their average keeps it
  bareTone *= 1.0 - 0.5 * stands;
  if (GREEN_DETAIL) {
    // Clumps, taller and darker or shorter and lighter, and a little drier,
    // their edges as sharp as a pixel allows, until a pixel covers one. They
    // fade before the detail's range ends.
    let fine = 1.0 - smoothstep(0.5 * greenParams.uGreenRange, 0.9 * greenParams.uGreenRange, distance);
    let q = xz / greenParams.uGreenClumps.y;
    var clump = (0.6 * gradientNoise(q) + 0.4 * gradientNoise(q * 2.7 + vec2f(1.9, -4.4))) / 0.18;
    let blur = 0.6 + 8.0 * footprint / greenParams.uGreenClumps.y;
    clump = 1.3 * (2.0 * smoothstep(-blur, blur, clump) - 1.0);
    clump *= fine * (1.0 - smoothstep(0.1, 0.4, footprint / greenParams.uGreenClumps.y));
    living *= max(vec3f(0.0), (1.0 + greenParams.uGreenClumps.x * clump) * (1.0 + 0.5 * clump * greenParams.uGreenTone.xyz));
    bareTone *= 1.0 - 0.5 * greenParams.uGreenClumps.x * clump;
  }

  // Patches of green and bare, where the noise falls under the green's share.
  // Their edges blur over as many metres anywhere (blur, in the noise's
  // units), and by as much as the noise changes across the pixel: along its
  // slope, and by its bend, which grows with the square of the pixel and is
  // all there is where the slope is flat, at the tip of a patch smaller than
  // a pixel, which would otherwise show as a speck. Once that is a good part
  // of the noise's range the patches give way to the share itself.
  let patches = greenPatches(xz);
  var u = patches.x;
  let wide = footprint / patchParams.uGreenPatches.x; // the pixel, in patches
  let across = abs(dot(patches.yz, dpdx)) + abs(dot(patches.yz, dpdy)) + GREEN_BEND * wide * wide;
  let seen = 1.0 - smoothstep(0.15, 0.4, across);
  let blur = (1.0 - patchParams.uGreenPatches.y) * GREEN_BLUR * patchParams.uGreenPatches.x * length(patches.yz);
  var edge = blur + across;

  var g: Green;
  g.normal = n;
  g.detail = seen;
  g.width = across;
  if (GREEN_DETAIL) {
    let near = (1.0 - smoothstep(0.75 * greenParams.uGreenRange, greenParams.uGreenRange, distance)) * (1.0 - smoothstep(0.02, 0.05, footprint));
    if (near > 0.0) {
      // How far a pixel is from telling a leaf or a blade from the next.
      let soft = smoothstep(0.003, 0.02, footprint);
      let lean = 0.6 * gradientNoise(xz * 0.7 + 3.1);
      let grass = greenTile(TILE_GRASS, xz, dpdx, dpdy, greenParams.uGreenTiles.x, vec3f(0.25 * greenParams.uGrassDepths), lean, false);
      let own = greenLeafOwn(footprint);
      let litterLaid = greenLitter(xz, dpdx, dpdy, lean, own);
      let leaves = litterLaid.leaves;
      let tone = greenLeafTone(leaves);

      // The bare ground: coarse sand and soil in crumbs, mottled where it holds
      // more or less humus, under as many dead leaves as its share of litter,
      // the lightest first.
      let crumbs = greenParams.uGreenTiles.z * sandParams.uSandTiles.x;
      let grain = surfaceTile(TILE_GRAIN, xz / crumbs, dpdx / crumbs, dpdy / crumbs).rgb * 2.0 / sandParams.uSandGrainMean;
      let soil = mix(greenParams.uSoil, sand, sandy) * mix(vec3f(1.0), grain, 0.6) * (1.0 + 0.12 * gradientNoise(xz * 3.0 - 7.7));
      let dead = greenLeaves(litterLaid.masks, leaves.a, tone, own, litter / greenParams.uLitterCover);
      let deadLeaf = greenParams.uLitter * greenLeafFactor(tone, greenShownTone(litter / greenParams.uLitterCover, own), own);
      let ground = greenOver(dead, greenParams.uLitterCover, litter, deadLeaf, soil);
      // The green: blades over the sward's depths, their colour the tile's
      // (its average 1, at every mip level), and green leaves on them as far as
      // it is lush, the darkest first. Tufts reach out into the bare ground and
      // the gaps between them give way first: the patches' edges fray, as much
      // one way as the other, over the width their blur stands in for where a
      // pixel can't tell the blades apart, so the blur is the fray's average.
      let sward = living * grass.rgb * 4.0 / greenParams.uGrassMean;
      let share = 0.6 * lush;
      let fresh = leaves.a - greenLeaves(litterLaid.masks, leaves.a, tone, own, 1.0 - share / greenParams.uLitterCover);
      let freshLeaf = living * greenLeafFactor(tone, greenShownDarkTone(share / greenParams.uLitterCover, own), own);
      let green = greenOver(fresh, greenParams.uLitterCover, share, freshLeaf, sward);
      let tufts = near * (1.0 - soft);
      u = clamp(u - tufts * 2.0 * blur * (grass.a - greenParams.uGrassCover), 0.0, 1.0);
      edge = mix(blur, 0.1 * blur, tufts) + across;
      living = mix(living, green, near);
      bare = mix(bare, ground, near);

      // Leaves lie tilted by their own curl, where they are.
      let inside = 1.0 - smoothstep(cover - edge, cover + edge, u);
      let tilt = vec3f(leaves.r * 2.0 - 1.0, 0.0, leaves.g * 2.0 - 1.0);
      g.normal = normalize(n + near * (1.0 - soft) * mix(dead, max(fresh, dead * (1.0 - grass.a)), inside) * tilt);
    }
  }
  bare *= bareTone;
  let inPatch = 1.0 - smoothstep(cover - edge, cover + edge, u);
  g.albedo = mix(mix(bare, living, cover), mix(bare, living, inPatch), seen);
  g.height = 1.0 - u;
  return g;
}

// The sand's share of what is sand or green where the two meet, from its
// share there (sand): sand only where the green stands lower than that share,
// so the edge runs raggedly round the green's patches, and since its height
// is spread evenly, the sand keeps its share on average. As the patches fade
// from a far pixel, so does the edge's raggedness. Compared in the logistic
// curve's units (chunks/patches.wgsl), where all sand and no sand lie at the
// ends of the scale, so the edge's blur gives way to them: blurred in the
// height's own units, green showed where the sand's share was all but whole
// and stopped short along the ground's texels where it was whole.
fn greenSandShare(sand: f32, g: Green) -> f32 {
  let h = clamp(g.height, 1e-4, 1.0 - 1e-4);
  let s = clamp(sand, 1e-4, 1.0 - 1e-4);
  let edge = 0.08 + g.width / (h * (1.0 - h));
  return mix(sand, smoothstep(-edge, edge, log(s / (1.0 - s)) - log(h / (1.0 - h))), g.detail);
}
