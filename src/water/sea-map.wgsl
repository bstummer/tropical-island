// What the sea knows of the island (water/sea-map.js, whose header says what each
// means), as the water reads it: three layers of a texture over the cove's frame.
// Needs terrainCove() (chunks/terrain.wgsl).

struct SeaLayout {
  uSeaLayout: vec4f, // the corner of the map's first texel (a, o), 1 / its width in m; how much of the ripples reaches the calmest water
  uRipplesDepth: f32, // from how deep (m) that much of them does
  uChopWander: vec2f, // how far the chop's tile wanders, m; 2 pi over how far apart it does
}

@group(1) @binding(10) var<uniform> seaLayout: SeaLayout;
@group(1) @binding(11) var uSeaMap: texture_2d_array<f32>;
@group(1) @binding(12) var uSeaMapSampler: sampler;

fn seaUv(xz: vec2f) -> vec2f {
  return (terrainCove(xz) - seaLayout.uSeaLayout.xy) * seaLayout.uSeaLayout.z;
}

// At world xz: how far the shore is (m), how deep the water is (m), how much of
// the swell and of the wind reach it.
fn seaAt(xz: vec2f) -> vec4f {
  return seaAtLevel(xz, 0.0);
}

// The same over more ground, at a mip level of the map.
fn seaAtLevel(xz: vec2f, level: f32) -> vec4f {
  return textureSampleLevel(uSeaMap, uSeaMapSampler, seaUv(xz), 0, level);
}

// At world xz: the way to the shore, in the cove's frame; how hard the surf breaks
// round here; how far the reef's crest is (m), + seaward of it.
fn seaShoreAt(xz: vec2f) -> vec4f {
  return textureSampleLevel(uSeaMap, uSeaMapSampler, seaUv(xz), 1, 0.0);
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

// Where the chop's tile is read, shape and all (water/surface.js chopRest is its
// twin): a slow wander, of no simple ratio to the tile, so from high up it doesn't
// show as a lattice in the sun's glitter.
fn chopRest(xz: vec2f) -> vec2f {
  let at = xz * seaLayout.uChopWander.y;
  return xz + seaLayout.uChopWander.x * vec2f(
    sin(dot(at, vec2f(0.946, 0.324))) + 0.5 * sin(dot(at, vec2f(-0.543, 1.503))),
    sin(dot(at, vec2f(-0.365, 0.9))) + 0.5 * sin(dot(at, vec2f(1.574, 0.492))),
  );
}
