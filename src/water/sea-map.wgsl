// What the sea knows of the island (water/sea-map.js, whose header says what each
// means), as the water reads it: three layers of a texture over the cove's frame.
// Needs terrainCove() (chunks/terrain.wgsl).

struct SeaLayout {
  uSeaLayout: vec4f, // the corner of the map's first texel (a, o), 1 / its width in m; how much of the ripples reaches the calmest water
  uRipplesDepth: f32, // from how deep (m) that much of them does
  uChopWander: vec2f, // how far the chop's tile wanders, m; 2 pi over how far apart it does
  uSeaOpen: vec2f, // over how far (m) past the map's square the open sea takes over; how far off it has the reef's crest (m)
}

@group(1) @binding(10) var<uniform> seaLayout: SeaLayout;
@group(1) @binding(11) var uSeaMap: texture_2d_array<f32>;
@group(1) @binding(12) var uSeaMapSampler: sampler;

fn seaUv(xz: vec2f) -> vec2f {
  return (terrainCove(xz) - seaLayout.uSeaLayout.xy) * seaLayout.uSeaLayout.z;
}

// How much of what the map holds still counts at world xz: 1 on its square, going
// over into the open sea's past it (water/sea-map.js at() is the twin), as the
// clamped edge would run on to the horizon in a straight lane.
fn seaKept(xz: vec2f) -> f32 {
  let samples = f32(textureDimensions(uSeaMap).x);
  let texel = 1.0 / (seaLayout.uSeaLayout.z * samples);
  let u = (terrainCove(xz) - seaLayout.uSeaLayout.xy) / texel - 0.5; // in samples from the first
  let past = texel * length(u - clamp(u, vec2f(0.0), vec2f(samples - 1.0)));
  return 1.0 - smoothstep(0.0, seaLayout.uSeaOpen.x, past);
}

// At world xz: how far the shore is (m), how deep the water is (m), how much of
// the swell and of the wind reach it.
fn seaAt(xz: vec2f) -> vec4f {
  return seaAtLevel(xz, 0.0);
}

// The same over more ground, at a mip level of the map.
fn seaAtLevel(xz: vec2f, level: f32) -> vec4f {
  let read = textureSampleLevel(uSeaMap, uSeaMapSampler, seaUv(xz), 0, level);
  let kept = seaKept(xz);
  return vec4f(read.xy, mix(vec2f(1.0), read.zw, kept));
}

// At world xz: the way inland, in the cove's frame; how hard the surf breaks
// round here; how far the reef's crest is (m), + seaward of it.
fn seaShoreAt(xz: vec2f) -> vec4f {
  let read = textureSampleLevel(uSeaMap, uSeaMapSampler, seaUv(xz), 1, 0.0);
  let kept = seaKept(xz);
  return vec4f(read.xy, read.z * kept, mix(seaLayout.uSeaOpen.y, read.w, kept));
}

// At world xz, the swell's waves: how many s later than over deep water they get here;
// the way they run, in the cove's frame; how fast, m/s.
fn seaWaveAt(xz: vec2f) -> vec4f {
  return textureSampleLevel(uSeaMap, uSeaMapSampler, seaUv(xz), 2, 0.0);
}

// The map's mip level for a pixel `footprint` metres wide.
fn seaLevel(footprint: f32) -> f32 {
  return log2(max(footprint * f32(textureDimensions(uSeaMap).x) * seaLayout.uSeaLayout.z, 1.0));
}

// How much of each cascade reaches a point (water/surface.js reachInto is its
// twin): the swell as far as it arrives; the chop's long waves only where the
// wind has blown far; its ripples soon, and some anywhere there is water to move.
// And the open sea's own chop, raised far off, which comes in with the swell and
// breaks on the reef as it does: so the lagoon behind it lies calm.
fn cascadeReach(sea: vec4f) -> vec3f {
  let least = seaLayout.uSeaLayout.w * smoothstep(0.0, seaLayout.uRipplesDepth, sea.y);
  let open = sea.z * sea.z;
  return vec3f(sea.z, max(sea.w * sea.w, open), max(max(sqrt(max(sea.w, 0.0)), least), open));
}

// Where a tile is read at xz as it wanders `wander` (how far, m; 2 pi over how far
// apart it does): slowly, of no simple ratio to the tile, so it never lines up with
// itself across the sea (water/surface.js chopRest is its twin).
const WANDER_WAYS = mat4x2f(0.946, 0.324, -0.543, 1.503, -0.365, 0.9, 1.574, 0.492);

fn wandered(xz: vec2f, wander: vec2f) -> vec2f {
  let at = xz * wander.y;
  return xz + wander.x * vec2f(
    sin(dot(at, WANDER_WAYS[0])) + 0.5 * sin(dot(at, WANDER_WAYS[1])),
    sin(dot(at, WANDER_WAYS[2])) + 0.5 * sin(dot(at, WANDER_WAYS[3])),
  );
}

// How the wander stretches the water where it reads the tile, as columns d/dx and
// d/dz of where it reads: a slope read there tilts the surface here by `slope * it`.
fn wanderedStretch(xz: vec2f, wander: vec2f) -> mat2x2f {
  let at = xz * wander.y;
  let k = wander.x * wander.y;
  let c = k * vec4f(cos(dot(at, WANDER_WAYS[0])), 0.5 * cos(dot(at, WANDER_WAYS[1])), cos(dot(at, WANDER_WAYS[2])), 0.5 * cos(dot(at, WANDER_WAYS[3])));
  let across = c.x * WANDER_WAYS[0] + c.y * WANDER_WAYS[1]; // how the read's x moves with x and z
  let along = c.z * WANDER_WAYS[2] + c.w * WANDER_WAYS[3]; // and its z
  return mat2x2f(vec2f(1.0 + across.x, along.x), vec2f(across.y, 1.0 + along.y));
}

// Where the chop's tile is read, shape and all: so from high up it doesn't show as a
// lattice in the sun's glitter.
fn chopRest(xz: vec2f) -> vec2f {
  return wandered(xz, seaLayout.uChopWander);
}

// Where a cascade's texture holds its waves at world xz: texel i holds them at
// i x patch / size (waves-store.wgsl), so a filtered read goes half a texel on,
// or the surface drawn would lie half a texel off what JS sums (water/surface.js).
// patches: 1 / its patch (m); texels: across it.
fn wavesUv(xz: vec2f, patches: f32, texels: f32) -> vec2f {
  return xz * patches + 0.5 / texels;
}
