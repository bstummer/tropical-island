// What the sea knows of the island (water/sea-map.js, whose header says what each
// means), as the water reads it: two layers of a texture over the cove's frame.
// Needs terrainCove() (chunks/terrain.wgsl).

struct SeaLayout {
  uSeaLayout: vec4f, // the corner of the map's first texel (a, o), 1 / its width in m; how much of the ripples reaches the calmest water
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

// The map's mip level for a pixel `footprint` metres wide.
fn seaLevel(footprint: f32) -> f32 {
  return log2(max(footprint * f32(textureDimensions(uSeaMap).x) * seaLayout.uSeaLayout.z, 1.0));
}

// How much of each cascade reaches a point (water/surface.js reachInto is its
// twin): the swell as far as it arrives; the chop's long waves only where the
// wind has blown far; its ripples soon, and some anywhere there is water to move.
fn cascadeReach(sea: vec4f) -> vec3f {
  let least = seaLayout.uSeaLayout.w * smoothstep(0.0, 1.0, sea.y);
  return vec3f(sea.z, sea.w * sea.w, max(sqrt(max(sea.w, 0.0)), least));
}
