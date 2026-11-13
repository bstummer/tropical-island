// The sea's surface, in the after-opaque pass: it moves with the waves
// (water/waves.js), shows the seabed through itself and what stands on it (the
// opaque scene, whose shaders leave the haze under the sea to this one), mirrors the
// sky, the sun and the land, and foams on the reef. Through the surface:
// water-seen.wgsl, water-seabed.wgsl and water-optics.wgsl. The mirror:
// water-mirror.wgsl, water-land.wgsl. The surf: water-surf.wgsl, water-foam.wgsl.
// The beach (swash.wgsl): the sheet a wave runs up the sand as, the glassy film it
// leaves, its foam. Over the beach as high as the waves wet it now the surface lies
// just over the ground, where it draws what this pixel shows of the ground as it is,
// and with the film and the foam on it, so they mirror what the sea does.
//
// The mesh: water/water-nodes.js, each instance a node, a grid of quads `spacing`
// apart from its corner, morphed for the camera as the terrain's is.

#include "chunks/scene-output.wgsl"
#include "chunks/lighting.wgsl"
#include "chunks/planet.wgsl"
#include "water-optics.wgsl"
#include "water-seen.wgsl"
#include "water-seabed.wgsl"
#include "water-mirror.wgsl"
#include "water-land.wgsl"
#include "water-surf.wgsl"
#include "water-foam.wgsl"
#include "sea-map.wgsl"
#include "swash.wgsl"
#include "chunks/rumples.wgsl"

// Whether this piece of the sea lies within reach of a waterline, and draws the beach's water (water.js).
override WATER_SHORE: bool = true;

struct Water {
  uPatches: vec3f, // 1 / each cascade's patch, m (water/spectrum.js)
  uFineSlopes: f32, // the variance of the slopes of waves too small for any cascade, per axis
  uMorph: array<vec4f, 16>, // per level, .xy: the distances over which it morphs into the next
  uUnresolved: array<vec4f, 6>, // per cascade, two of them: the variance its mip levels 0 to 7 have lost, both axes together
  uWaveTexels: f32, // texels across a patch of the waves' texture
  uSunCeiling: f32, // the most the sun's light in the water may reach once exposed
  uGlitter: f32, // how much of the sun's light the waves send towards the eye shows (config.water.glitter)
  uFinest: vec3f, // how much finer the second read of the ripples is, how strong, and log2 of how much finer
  uCapillaries: f32, // how strong the third read is, as much finer again, right by the eye
  uFootBias: f32, // log2 of the texels across a patch
  uLogPatches: vec3f, // log2 of uPatches
  uSharper: f32, // how many mip levels sharper than its longer side a square pixel reads the slopes
  uRisesLevel: f32, // the sea map's mip level what rises from the seabed is told by
  uGroundNear: vec2f, // m from the shore from which the opaque scene under the sea counts less, and not at all
  uRippleWander: vec2f, // how far the ripples' tile wanders, m; 2 pi over how far apart it does
  uGustSizes: vec2f, // the sides of the two reads of the tile the wind's gusts are told from, m
  uGustDrift: vec4f, // how each drifts with the wind, tiles/s
  uGustStrength: f32, // how much they say
  uGustFades: vec2f, // m from the eye over which they fade out
  uHighUp: vec3f, // from what height of the eye the ripples soften, up to what height (m); how many mip levels softer they are read then
  uAureole: vec2f, // the sun's glow, as sky/sky.wgsl has it: how sharp its peak is, how strong
  uHorizonFade: f32, // the sine of how far above the rim of the sea it has gone over into the sky by 63%
  uHorizonFrom: vec2f, // from what share of the way to the rim it does, and by what share it does in full
  uMirrorCells: vec4f, // what water/mirror.js threw the opaque scene into: cells across, down; pixels a cell; the share of the frame from its top over which what it mirrors fades in
  uMirrorTaps: vec3f, // the rays through what the pixel's waves tilt: each one's height squared, per the variance of the slopes
  uMirrorBeyond: f32, // how far past the shore (m) a ray that meets nothing at its own pixel is taken to reach land
  uMirrorSteep: f32, // how much higher, in the square of its height per the variance of the slopes, a mirrored ray needs only one ray
  uGustSeconds: f32, // the time, wrapped at the gusts' loop
  uGlintMean: f32, // the tile's mean (textures/glints.js)
  uGlintSizes: vec3f, // the three reads of the tile: its side, m
  uGlintDrift: array<vec4f, 3>, // and how each drifts, tiles/s
  uFoamAlbedo: vec3f, // linear
  uFoamLook: vec3f, // the sides of the seabed's tile as its patches read it (m); how wide a pixel (m) has it an even veil
  uFoamDrift: vec4f, // how each read of the tile drifts with the swell, tiles/s
  uFoamLace: vec3f, // the sides of the foam's tile as its lace reads it (m); its stretch along the swell's way
  uFoamCovers: vec2f, // how much foam covers none of the water, and all of it
  uFoamLaceDrift: vec2f, // how each read of it drifts along the swell's way, tiles/s
  uFoamLevels: array<vec4f, 5>, // the levels of its tile that leave each sixteenth of the foam (textures/foam.js)
  uFoamFacing: f32, // how much of the sun's light it takes with the sun on the horizon
  uFoamBacklit: vec2f, // how much of the sun's light its thin tops let through, and how much of that goes on onwards (Henyey-Greenstein g)
  // The beach: m of depth over which its water takes over from the sea's; how far up it the surface lies over the
  // ground, per a full wave's run-up; how far over it, m, and m more per m from the eye
  uShore: vec4f,
  uShoreSpacing: f32, // and m more per m of the mesh's spacing there
  uShoreRipples: vec2f, // how much of the ripples the sheet has, and the film it leaves
  uShoreVariance: vec2f, // how much rougher than the sea's their surfaces are, the variance of their slopes per axis
  uShoreRumples: vec2f, // the sand's rumples, which the film it leaves lies over (chunks/rumples.wgsl): m, slope
  uShoreMirror: f32, // m: how much higher than the ground under it what the water mirrors must stand
  uShoreFlow: f32, // how far the foam on the sheet moves with it, per the sheet's edge
}

@group(1) @binding(0) var<uniform> optics: WaterOptics;
@group(1) @binding(1) var uOpaque: texture_2d<f32>; // the opaque scene: a pass can't read what it draws into
@group(1) @binding(3) var uOpaqueDepth: texture_depth_2d;
@group(1) @binding(4) var<uniform> water: Water;
@group(1) @binding(5) var uWaves: texture_2d_array<f32>; // two layers per cascade (waves-store.wgsl)
@group(1) @binding(6) var uWavesSampler: sampler;
@group(1) @binding(8) var<storage, read> uMirror: array<u32>;

// The second read of the ripples is turned, so it doesn't line up with the first.
const FINEST_TURN = mat2x2f(0.8, 0.6, -0.6, 0.8);
// How many mip levels under what a pixel asks for a cascade's texels start being
// read smoothly, by the time they are twice as wide as that.
const WAVES_SMOOTH = 1.0;
// Over the beach, how many steps of the mesh past where the waves wet it now the surface
// still lies over the ground, so its edge, where it dips under, lies where the ground is bare.
const SHORE_STEPS = 2.0;
// How little of the beach's foam is none: where there is no more, nor film, the ground is bare.
const SHORE_FOAM_GONE = 1e-3;

struct VertexIn {
  @location(0) position: vec3f,
  @location(1) aNode: vec4f, // the node's corner x, z; its spacing; its level
}

struct Varyings {
  @builtin(position) position: vec4f,
  // Centroid: the far rim lies a fraction of a pixel below the plane's horizon,
  // where a pixel centre outside the triangle would extrapolate the position to
  // nonsense (a dark line along the horizon).
  @location(0) @interpolate(perspective, centroid) vWorldPos: vec3f,
  @location(1) vRest: vec2f, // where the water here rests: where the waves' texture is read
  // The beach's water's place (swash.wgsl SwashPlace), in the shore's pieces: lands, rise,
  // runs, fray; patches, gathers, the run-ups in slots 4 and 5; the run-ups in slots 0 to 3.
  @location(2) vPlace0: vec4f,
  @location(3) vPlace1: vec4f,
  @location(4) vPlace2: vec4f,
}

fn placeOf(in: Varyings) -> SwashPlace {
  return SwashPlace(in.vPlace0.x, in.vPlace0.y, in.vPlace0.z, in.vPlace0.w, in.vPlace1.x, in.vPlace1.y, in.vPlace2, in.vPlace1.z, in.vPlace1.w);
}

@vertex
fn vertexMain(in: VertexIn) -> Varyings {
  // As the terrain's (chunks/terrain-mesh.wgsl terrainMorph).
  let level = i32(in.aNode.w);
  var grid = in.position.xz;
  let flat = in.aNode.xy + grid * in.aNode.z;
  let k = clamp((length(flat - frame.cameraPosition.xz) - water.uMorph[level].x) / (water.uMorph[level].y - water.uMorph[level].x), 0.0, 1.0);
  grid -= fract(grid * 0.5) * 2.0 * k;
  let rest = in.aNode.xy + grid * in.aNode.z;

  // Each cascade at the mip that holds no finer waves than this mesh can draw, and
  // on its way to the next level's as the vertices are: at a seam the two levels'
  // vertices lie together, and on another mip they would part, opening cracks.
  let sea = seaAt(rest);
  let reach = cascadeReach(sea);
  let footprint = 2.0 * in.aNode.z * (1.0 + k) * water.uWaveTexels;
  var moved = vec3f(0.0);
  for (var c = 0; c < 3; c++) {
    let patches = water.uPatches[c];
    let lod = max(log2(footprint * patches), 0.0);
    let read = select(rest, chopRest(rest), c == 1);
    moved += reach[c] * textureSampleLevel(uWaves, uWavesSampler, wavesUv(read, patches, water.uWaveTexels), 2 * c, lod).xyz;
  }

  let shore = seaShoreAt(rest);
  moved.y += surfAt(sea, shore, seaWaveAt(rest), 0.0, rest, frame.uWaveSeconds).height;
  let ground = terrainHeight(terrainCove(rest), 0);
  var out: Varyings;
  out.vPlace0 = vec4f(0.0);
  out.vPlace1 = vec4f(0.0);
  out.vPlace2 = vec4f(0.0);
  var place: SwashPlace;
  var bore = SwashBore(0.0, 0.0, 0.0, 0.0, 0.0);
  if (WATER_SHORE) {
    // The beach's water's place, for this vertex and the pixels round it, and the waves
    // coming in over the last of the shallows.
    place = swashPlace(rest, sea.x, shore.xy);
    out.vPlace0 = vec4f(place.lands, place.rise, place.runs, place.fray);
    out.vPlace1 = vec4f(place.patches, place.gathers, place.runUp4, place.runUp5);
    out.vPlace2 = place.runUps;
    bore = swashBore(place, sea.x, sea.y);
    moved.y += bore.height;
  }
  moved.y = max(moved.y, troughFloor(ground));
  if (WATER_SHORE) {
    // Near the shore the beach's water: the sheet a wave runs up as, and the sea's edge drawn
    // down after it; over the beach as high as the waves wet it now, just over the ground,
    // and a few steps of the mesh more, where it gives back the bare ground as the terrain drew
    // it. Higher it lies under the ground, which the terrain alone draws.
    if (ground > -water.uShore.x && ground < water.uShore.y * place.runs) {
      let wash = swashFrom(place, ground, 0.0, bore.height);
      let spacing = in.aNode.z * (1.0 + k);
      moved = mix(moved, vec3f(0.0, ground + wash.cover, 0.0), 1.0 - smoothstep(0.5 * water.uShore.x, water.uShore.x, -ground));
      let lift = water.uShore.z + water.uShore.w * length(rest - frame.cameraPosition.xz) + water.uShoreSpacing * spacing;
      let wets = ground < wash.top + SHORE_STEPS * spacing * max(wash.rise, SWASH_LEAST) + lift;
      moved.y = select(min(moved.y, ground - lift), max(moved.y, ground + lift), wets);
    }
  }

  var world = vec3f(rest.x + moved.x, moved.y, rest.y + moved.z);
  world.y -= planetDrop(world.xz);
  out.vWorldPos = world;
  out.vRest = rest;
  out.position = frame.projectionMatrix * frame.viewMatrix * vec4f(world, 1.0);
  return out;
}

// How deep the water at world xz is, as a pixel that wide sees it, for water-seen.wgsl.
fn seaDepthAt(xz: vec2f, footprint: f32) -> f32 {
  return seaAtLevel(xz, seaLevel(footprint)).y;
}

// The same as finely as it is known: from the fine grid's own samples where a pixel
// is small enough to tell them apart, as the sea map's are further apart than
// the seabed's roughness is wide and would alias it.
fn seabedDepthAt(xz: vec2f, footprint: f32) -> f32 {
  let ao = terrainCove(xz);
  let f = terrainGrid(0, ao);
  let i = floor(f);
  let t = f - i;
  let g = terrainGather(0, i);
  let fine = -mix(mix(g.w, g.z, t.x), mix(g.x, g.y, t.x), t.y);
  return mix(seaDepthAt(xz, footprint), fine, terrainWeight(0, ao) * (1.0 - smoothstep(1.0, 3.0, footprint)));
}

// Where the ripples' tile is read: wandering (sea-map.wgsl wandered), or it would show
// as a lattice in the sun's glitter, above all as the water moves. The fragment's
// alone: the surface's shape, whose ripples are a few cm tall, stays the plain sum
// JS knows (water/surface.js).
fn rippleRest(rest: vec2f) -> vec2f {
  return wandered(rest, water.uRippleWander);
}

// How much of the ripples' slopes the wind's gusts leave here: patches it roughens and
// patches it leaves smooth, a hundred metres and more across, drifting with it,
// so the sea isn't one even texture from above, and at a low angle shows them moving.
// The tile read where 32 of its texels make one, what it holds there the same in any preset.
fn seaGusts(xz: vec2f, seconds: f32) -> f32 {
  let level = log2(seabedLook.uSeabedTile.z / 32.0);
  let large = textureSampleLevel(uSurfaceTiles, uSurfaceTilesSampler, SEABED_TURN * xz / water.uGustSizes.x - water.uGustDrift.xy * seconds, i32(TILE_SEABED), level);
  let small = textureSampleLevel(uSurfaceTiles, uSurfaceTilesSampler, xz / water.uGustSizes.y - water.uGustDrift.zw * seconds, i32(TILE_SEABED), level);
  return clamp(1.0 + water.uGustStrength * (large.r + small.r - 1.0 + 0.5 * (large.g + small.g - 1.0)), 0.2, 1.6);
}

// A cascade's finest level at uv as a cubic B-spline, in four bilinear reads: a
// bilinear read of texels wider than a pixel has corners along their rows, which
// the sun's glitter shows as zigzags fixed in the world while the waves pass through.
fn wavesCubic(uv: vec2f, layer: i32) -> vec4f {
  let st = uv * water.uWaveTexels - 0.5;
  let i = floor(st);
  let f = st - i;
  let f2 = f * f;
  let f3 = f2 * f;
  let less = (1.0 - f) * (1.0 - f) * (1.0 - f) + 4.0 - 6.0 * f2 + 3.0 * f3;
  let more = 1.0 + 3.0 * f + 3.0 * f2 - 3.0 * f3 + f3;
  let a = (i - 0.5 + (4.0 - 6.0 * f2 + 3.0 * f3) / less) / water.uWaveTexels;
  let b = (i + 1.5 + f3 / more) / water.uWaveTexels;
  let near = less.x * textureSampleLevel(uWaves, uWavesSampler, a, layer, 0.0) + more.x * textureSampleLevel(uWaves, uWavesSampler, vec2f(b.x, a.y), layer, 0.0);
  let far = less.x * textureSampleLevel(uWaves, uWavesSampler, vec2f(a.x, b.y), layer, 0.0) + more.x * textureSampleLevel(uWaves, uWavesSampler, b, layer, 0.0);
  return (less.y * near + more.y * far) / 36.0;
}

// A cascade at uv for a pixel that asks for mip level `wanted`, below 0 where its
// finest texels are wider than the pixel.
fn wavesRead(uv: vec2f, layer: i32, wanted: f32) -> vec4f {
  let cubic = clamp(-wanted - WAVES_SMOOTH, 0.0, 1.0);
  var read = vec4f(0.0);
  if (cubic < 1.0) {
    read = textureSampleLevel(uWaves, uWavesSampler, uv, layer, max(wanted, 0.0));
  }
  if (cubic > 0.0) {
    read = mix(read, wavesCubic(uv, layer), cubic);
  }
  return read;
}

// What cascade c's mips have lost at level `lod` (uUnresolved), both axes together.
fn unresolved(c: i32, lod: f32) -> f32 {
  let l = clamp(lod, 0.0, 7.0);
  let i = i32(floor(l));
  let j = min(i + 1, 7);
  let a = water.uUnresolved[2 * c + i / 4][i % 4];
  let b = water.uUnresolved[2 * c + j / 4][j % 4];
  return mix(a, b, l - f32(i));
}

@fragment
fn fragmentMain(in: Varyings) -> @location(0) vec4f {
  let p = in.vWorldPos;
  let size = vec2f(textureDimensions(uOpaqueDepth));

  // The slopes, cascade by cascade, at the mips the longer side of the pixel's
  // footprint asks for: sharper than that where the pixel is about square, softer
  // the more it stretches at a grazing angle, so the far sea's rows hold no waves
  // a pixel tall to crawl as the eye moves; the mirror takes up what they lose.
  // Read at a level, without anisotropy: most of it would be wasted here, and it
  // would cost several times as much.
  let dx = dpdx(in.vRest);
  let dy = dpdy(in.vRest);
  let longest = max(max(dot(dx, dx), dot(dy, dy)), 1e-12);
  let ground = max(abs(dx.x * dy.y - dx.y * dy.x), 1e-12); // the pixel's, m2
  let stretch = log2(max(longest / ground, 1.0)); // of the longer side over the shorter
  let foot = 0.5 * log2(longest) + water.uFootBias - clamp(water.uSharper - 0.25 * stretch, -1.0, water.uSharper);
  // From high up ripples a pixel wide would crawl: they soften into what the surface
  // mirrors, by the height of the eye, as a low view's far sea must keep them.
  let high = smoothstep(water.uHighUp.x, water.uHighUp.y, frame.cameraPosition.y);
  let wanted = vec3f(foot) + water.uLogPatches + vec3f(0.0, 0.0, high * water.uHighUp.z);
  let lods = max(wanted, vec3f(0.0));
  let ripples = rippleRest(in.vRest);
  // The swell's waves are many of its texels long (config.water.waves.swell.shortest): a plain read does.
  let s0 = textureSampleLevel(uWaves, uWavesSampler, wavesUv(in.vRest, water.uPatches[0], water.uWaveTexels), 1, lods.x);
  let s1 = wavesRead(wavesUv(chopRest(in.vRest), water.uPatches[1], water.uWaveTexels), 3, wanted.y);
  let s2 = wavesRead(wavesUv(ripples, water.uPatches[2], water.uWaveTexels), 5, wanted.z);
  // And the ripples again, much finer and turned, for what the eye sees up close.
  let finestWanted = wanted.z + water.uFinest.z;
  let finestLod = max(finestWanted, 0.0);
  let finest = wavesRead(FINEST_TURN * ripples * water.uPatches[2] * water.uFinest.x, 5, finestWanted);
  // Right by the eye, the capillaries that break the sun's mirror into filigree: a pixel's
  // own read of them, and only there, where its levels hold what would else be lost.
  // The sun's alone: in what else it mirrors they would only make the land's cells flicker.
  let capillaryWanted = finestWanted + water.uFinest.z;
  let capillarySay = 1.0 - smoothstep(1.0, 2.0, capillaryWanted);
  var capillary = vec2f(0.0);
  // The wanders stretch the tiles where they are read, as much as two fifths: the slopes
  // read there tilt the surface here only through that stretch.
  let rippleStretch = wanderedStretch(in.vRest, water.uRippleWander);
  if (capillarySay > 0.0) {
    capillary = capillarySay * textureSampleLevel(uWaves, uWavesSampler, FINEST_TURN * FINEST_TURN * ripples * water.uPatches[2] * water.uFinest.x * water.uFinest.x, 5, max(capillaryWanted, 0.0)).xy * FINEST_TURN * FINEST_TURN * rippleStretch;
  }
  let sea = seaAt(in.vRest);
  var reach = cascadeReach(sea);
  // The beach: what this pixel shows of the ground, as it is, and how far its water goes over
  // to the beach's, by how deep the sea is here; what the waves do where it shows.
  let pixel = vec2i(in.position.xy);
  var seen = p;
  var seenHeight = 0.0;
  var seenTall = 0.0;
  var beach = 0.0;
  if (WATER_SHORE) {
    seen = opaqueSeen(pixel, size);
    seenHeight = seen.y + planetDrop(seen.xz);
    seenTall = fwidth(seenHeight);
    beach = 1.0 - smoothstep(0.5 * water.uShore.x, water.uShore.x, sea.y);
  }
  let shore = seaShoreAt(in.vRest);
  var wash = Swash(0.0, 0.0, 0.0, 0.0, 1.0, 0.0, 0.0, 0.0, 1.0, 0.0);
  // The waves coming in over the last of the shallows, as the vertices have them.
  var bore = SwashBore(0.0, 0.0, 0.0, 0.0, 0.0);
  if (WATER_SHORE) {
    bore = swashBore(placeOf(in), sea.x, sea.y);
  }
  if (WATER_SHORE && beach > 0.0) {
    wash = swashFrom(placeOf(in), seenHeight, seenTall, bore.height);
    // The sheet ripples as it runs; the film it leaves, a little, as the sand under it.
    reach.z = max(reach.z, beach * mix(water.uShoreRipples.y, water.uShoreRipples.x, smoothstep(0.0, 0.01, wash.cover)));
  }
  // How much of this is water: the sea's, the sheet's and the film's, and none of the bare beach.
  let wet = mix(1.0, wash.film, beach);
  // The gusts fade out far off, where at a grazing angle their patches read as hills of water.
  reach.z *= mix(seaGusts(in.vRest, water.uGustSeconds), 1.0, smoothstep(water.uGustFades.x, water.uGustFades.y, length(in.vRest - frame.cameraPosition.xz)));
  let chopped = vec4f(s1.xy * wanderedStretch(in.vRest, frame.uChopWander), s1.zw);
  let rippled = s2 + water.uFinest.y * vec4f(finest.xy * FINEST_TURN, 0.0, 0.0);
  var slopes = reach.x * s0 + reach.y * chopped + reach.z * vec4f(rippled.xy * rippleStretch, rippled.zw);
  // Each wave's face as it comes in, rising out to sea.
  let inland = normalize(terrainWorld(shore.xy) + vec2f(1e-6, 0.0));
  slopes.x -= bore.slope * inland.x;
  slopes.y -= bore.slope * inland.y;
  // The swell's long waves and how they break, their slope along the way they run.
  var foam = 0.0;
  if (sea.z > 0.0 && shore.w < surf.uSurfWay.w) {
    let wave = seaWaveAt(in.vRest);
    let breaking = surfAt(sea, shore, wave, sqrt(longest), in.vRest, frame.uWaveSeconds);
    foam = breaking.foam;
    slopes.x += breaking.slope * (wave.y * frame.uTerrainFrame.x + wave.z * frame.uTerrainFrame.z);
    slopes.y += breaking.slope * (wave.y * frame.uTerrainFrame.y + wave.z * frame.uTerrainFrame.w);
  }
  // The film the sheet leaves on the sand lies over its rumples: so does what it mirrors.
  var rumpled = vec3f(0.0);
  if (WATER_SHORE && beach > 0.0) {
    let lies = beach * wash.film * (1.0 - smoothstep(0.0, 0.01, wash.cover));
    rumpled = lies * rumples(seen.xz, sqrt(longest), water.uShoreRumples.x, water.uShoreRumples.y);
    slopes.x += rumpled.x;
    slopes.y += rumpled.y;
  }
  // A crest's sideways moves squeeze it: its slopes steepen as they pile up, along
  // whichever way it runs, so with no way favoured.
  let squeezing = 1.0 / max(1.0 + slopes.z + slopes.w, 0.5);
  let squeezed = slopes.xy * squeezing;
  let n = normalize(vec3f(-squeezed.x, 1.0, -squeezed.y));
  let forSun = squeezed + reach.z * water.uCapillaries * capillary * squeezing;
  let nSun = normalize(vec3f(-forSun.x, 1.0, -forSun.y));

  // What the pixel's waves too small for it add to what the surface mirrors.
  let lost = reach * reach * vec3f(
    unresolved(0, lods.x),
    unresolved(1, lods.y),
    unresolved(2, lods.z) + water.uFinest.y * water.uFinest.y * unresolved(2, finestLod) + water.uCapillaries * water.uCapillaries * mix(unresolved(2, 7.0), unresolved(2, max(capillaryWanted, 0.0)), capillarySay * capillarySay),
  );
  // The beach's water is rougher: the sheet's, and most the film's over the sand's grains.
  let rougher = beach * mix(water.uShoreVariance.y, water.uShoreVariance.x, smoothstep(0.0, 0.01, wash.cover));
  let variance = 0.5 * (lost.x + lost.y + lost.z) + water.uFineSlopes + rougher + 0.5 * rumpled.z + specularKernel(n);

  // Where the beach lies bare above the sea, the ground as the terrain drew it, which is all
  // that follows would give back: no water, film or foam on it, nor haze to take out.
  if (WATER_SHORE && beach >= 1.0 && seenHeight > 0.01 && wash.film <= 0.0 && wash.foam + wash.line + foam < SHORE_FOAM_GONE) {
    let bare = textureLoad(uOpaque, pixel, 0);
    if (bare.a >= 1.0) {
      return sceneOutput(sceneRadiance(bare.rgb) / frame.uExposure, 1.0);
    }
  }

  let view = normalize(frame.cameraPosition - p);
  let up = vec3f(0.0, 1.0, 0.0);
  shadeOnce(p, up, vec2f(0.0), vec2f(0.0), SHADE_HIGH); // what falls on the surface: the island's shade, read once
  let sun = sunLight(p, up);
  let sky = shIrradiance(up);

  let facing = max(dot(n, view), 0.0);
  let bent = refract(-view, n, 1.0 / optics.uIor);
  let wide = sqrt(longest);
  // Near a shore the ground as drawn runs on under the waterline, and rocks stand
  // there; out on the reef this draws all of the seabed, the coral up to the crest.
  let ashore = 1.0 - smoothstep(water.uGroundNear.x, water.uGroundNear.y, sea.x);
  var below = seenBelow(p, bent, size, optics.uSeabedFade.y, sea.y, wide, ashore);
  below.on = vec4f(sceneRadiance(below.on.rgb) / frame.uExposure, below.on.a);
  // On the beach this pixel's own ground, straight through the few centimetres of water
  // over it, as the terrain drew it, its haze taken out: this adds the haze for all of it.
  let air = aerialAt(p);
  if (WATER_SHORE && beach > 0.0) {
    let stored = textureLoad(uOpaque, pixel, 0);
    let hazed = smoothstep(-0.01, 0.01, seenHeight);
    let drawn = (sceneRadiance(stored.rgb / max(stored.a, 1e-3)) / frame.uExposure - hazed * air.added) / mix(vec3f(1.0), max(air.through, vec3f(1e-3)), hazed);
    below.on = mix(below.on, vec4f(drawn, stored.a), beach);
    below.depth = mix(below.depth, wash.cover, beach);
    below.xz = mix(below.xz, seen.xz, beach);
  }
  var seabed = vec3f(0.0);
  if (below.on.a < 1.0 && below.depth < optics.uSeabedFade.y) {
    // The ground round it, tens of metres across: what rises from that, and how far the shore is.
    let round = seaAtLevel(below.xz, max(seaLevel(wide), water.uRisesLevel));
    // Its mottling sharper than the longer side where the pixel stretches, or the near sea's floor blurs.
    let sharp = wide * exp2(-min(0.5 * stretch, 1.5));
    seabed = seabedRadiance(below.xz, below.depth, dx, dy, sharp, sun, round.y - below.depth, round.x, ashore, optics.uIor);
  }
  seabed = mix(seabed, below.on.rgb, below.on.a);
  // Where the beach is bare, it is as it was drawn; the sheet over it white with bubbles and sand as it runs up.
  var leaving = mix(seabed, waterLeaving(optics, seabed, below.depth, max(facing, 0.02), frame.uSunDirection.y, sun, sky), wet);
  leaving = mix(leaving, water.uFoamAlbedo * (sun + sky) / PI, 1.0 - (1.0 - beach * wash.milk) * (1.0 - bore.milk));

  // The sun's light by height, its way through the air, as sunLight() has it.
  let height = p.y + planetDrop(p.xz);
  let sunHere = textureSampleLevel(uSunlight, uSunlightSampler, vec2f(sunlightU(height * 0.001), 0.5), 0.0).rgb;
  let beam = sunHere * sunVisibility(p, up);

  // What it mirrors, as seen from the sea, the sun's glow with the sky, and the land
  // in front of them: waves it can't see tilt the surface, each way by a share, so
  // on average it mirrors sky from higher up than a flat sea would, far brighter by
  // the horizon than at the height of its mean; three rays through them where that
  // tells, looking low, and they land more than a few cells apart.
  let mirrored = wet * seaMirrored(facing, variance);
  let towards = reflect(-view, n);
  let flat2 = towards.y * towards.y;
  let eyeW = (frame.projectionMatrix * frame.viewMatrix * vec4f(p, 1.0)).w;
  let toP = length(frame.cameraPosition - p);
  let toLand = landFarther(in.position.xy, toP, eyeW);
  let far = select(max(sea.x, 0.0) + water.uMirrorBeyond, toLand, toLand > 0.0);
  let blur = 8.0 * variance;
  // On the beach the water lies over the ground: what stands round it no higher isn't mirrored.
  let mirrorsAbove = select(LAND_ANY, seenHeight + water.uShoreMirror, WATER_SHORE && beach > 0.0);
  let spread = (sqrt(flat2 + water.uMirrorTaps.z * variance) - sqrt(flat2 + water.uMirrorTaps.x * variance)) * frame.projectionMatrix[1][1] * water.uMirrorCells.y * 0.5;
  var skyPart = vec3f(0.0);
  var landPart = vec3f(0.0);
  var landShare = 0.0;
  if (spread < 2.0 || flat2 > water.uMirrorSteep * variance) {
    let dir = normalize(vec3f(towards.x, sqrt(flat2 + water.uMirrorTaps.y * variance), towards.z));
    let land = landSmooth(landImageUv(p, dir, far), eyeW, mirrorsAbove);
    skyPart = (1.0 - land.a) * (seaSkyRadiance(dir) + beam * sunGlow(dir, water.uAureole, blur));
    landPart = land.a * sceneRadiance(land.rgb);
    landShare = land.a;
  } else {
    for (var i = 0; i < 3; i++) {
      let dir = normalize(vec3f(towards.x, sqrt(flat2 + water.uMirrorTaps[i] * variance), towards.z));
      // The middle ray between cells, or what the land holds flips by thirds as the eye moves.
      let on = landImageUv(p, dir, far);
      var land: vec4f;
      if (i == 1) {
        land = landSmooth(on, eyeW, mirrorsAbove);
      } else {
        land = landNearest(on, eyeW, mirrorsAbove);
      }
      skyPart += (1.0 - land.a) * (seaSkyRadiance(dir) + beam * sunGlow(dir, water.uAureole, blur)) / 3.0;
      landPart += land.a * sceneRadiance(land.rgb) / 3.0;
      landShare += land.a / 3.0;
    }
  }
  var radiance = (1.0 - mirrored) * leaving + mirrored * skyPart;

  // The sun is mirrored only where the land doesn't stand in front of it, as the sky.
  radiance += wet * (1.0 - landShare) * seaGlints(water.uGlitter * beam * seaGlitter(nSun, view, frame.uSunDirection, variance), in.vRest, dx, dy, ground, frame.uWaveSeconds);

  // Foam over all of it, a surface of its own: the surf's, drifting with the swell, and
  // the beach's, in the frame of the way inland: what a wave's break leaves, drifting in with
  // it, the sheet's moving with it and what it left where it turned lying still.
  let sheetFoam = beach * wash.foam;
  let ashoreFoam = bore.foam + sheetFoam + beach * wash.line;
  var foamCover = 0.0;
  if (foam + ashoreFoam > 0.0) {
    let onBeach = ashoreFoam > foam;
    let moves = (bore.foam * bore.along + sheetFoam * water.uShoreFlow * max(wash.level, 0.0) / max(wash.rise, 0.02)) / max(ashoreFoam, 1e-4);
    // Sharper than the pixel's longer side, or it smears across the eye's line.
    let lace = seaFoamCover(foam + ashoreFoam, in.vRest, select(surf.uSurfWay.xy, inland, onBeach), select(0.0, moves, onBeach), select(frame.uWaveSeconds, 0.0, onBeach), wide * exp2(-min(0.5 * stretch, 1.5)), wide);
    foamCover = lace.x;
    radiance = mix(radiance, lace.y * foamLight(beam, sky, view), foamCover);
  }

  // What it mirrors of the land comes through the air on screen as it is: the air
  // between the eye and the land is all in it, this water's stretch of it too.
  let landMirrored = (1.0 - foamCover) * mirrored * landShare;
  radiance = radiance * air.through + air.added * (1.0 - landMirrored) + (1.0 - foamCover) * mirrored * landPart / frame.uExposure;
  // The last of the sea goes over into the sky just above it: the eye's line runs
  // through kilometres of the haze that lies on the water, and the rim is no line.
  // Only far off, as a share of how far the rim is: a wave right by a swimmer's eye
  // stands at the same angle, in no haze.
  let above = max(view.y - sin(horizonDip(frame.cameraPosition.y * 0.001)), 0.0);
  let rim = sqrt(2000.0 * frame.uGroundRadius * max(frame.cameraPosition.y, 0.1));
  let intoSky = exp(-above / water.uHorizonFade) * smoothstep(water.uHorizonFrom.x * rim, water.uHorizonFrom.y * rim, length(p.xz - frame.cameraPosition.xz));
  // Not the beach's bare sand, which is land.
  radiance = mix(radiance, skyRadiance(-view), intoSky * mix(1.0, wet, beach));

  return sceneOutput(radiance, 1.0);
}
