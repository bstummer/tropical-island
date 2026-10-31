// The ground under the sea, which only the water shows, so the water draws it: a
// function of where a ray lands, with nothing of the mesh or of the land's shaders
// in it, so it looks the same from any distance, with no seam between pieces of the
// terrain, and costs nothing where the sea is too deep to show it. White sand with
// darker beds of weed on the lagoon's floor, its ripples up close; coral and rubble
// mottled at several sizes from the back of the reef out, and on anything that
// rises from the floor (the bommies); rock turning to the same a couple of metres
// down. The mottling comes from a tile (textures/seabed.js), read at two sizes that
// never line up: its mips take each size away once a pixel covers it, so far off
// it keeps its average and nothing crawls. Needs the terrain's chunk (chunks/terrain.wgsl).

#include "/chunks/tiles.wgsl"
#include "/chunks/pi.wgsl"
#include "/chunks/sh.wgsl"

struct SeabedLook {
  uSeabedSand: vec3f, // linear albedos, as all here
  uWetSand: vec3f, // the beach's, right at the waterline
  uWetRock: vec3f, // the shore's rock, right at the waterline
  uCoralDark: vec3f,
  uCoralLight: vec3f,
  uWeed: vec3f,
  uSeabedTile: vec3f, // the tile's size, m; how much larger its second read is; its texels across
}

@group(1) @binding(7) var<uniform> seabedLook: SeabedLook;

// Turned, so the tile's two reads don't line up.
const SEABED_TURN = mat2x2f(0.8, 0.6, -0.6, 0.8);

fn seabedTileAt(uv: vec2f, size: f32, footprint: f32) -> vec4f {
  let level = log2(max(footprint * seabedLook.uSeabedTile.z / size, 1e-3));
  return textureSampleLevel(uSurfaceTiles, uSurfaceTilesSampler, uv, i32(TILE_SEABED), level);
}

// The seabed's radiance in air at xz, `depth` m under the sea, for a pixel `footprint`
// wide along its longer side (dx, dy: its sides, m), its mottling read `sharp` wide,
// under the sun that reaches the surface above it, with how much it stands above
// the ground round it and how far the shore is (m). Its light is worked out by the
// sun as it bends into the water, so a low sun doesn't rake it.
fn seabedRadiance(xz: vec2f, depth: f32, dx: vec2f, dy: vec2f, sharp: f32, sun: vec3f, rises: f32, shore: f32, ior: f32) -> vec3f {
  let ao = terrainCove(xz);
  var info: vec4f;
  var cover: vec4f;
  terrainGround(ao, dx, dy, &info, &cover);
  var slope = terrainWorldSlope(info.xy);

  let large = seabedLook.uSeabedTile.x * seabedLook.uSeabedTile.y;
  let far = seabedTileAt(SEABED_TURN * xz / large, large, sharp);
  let near = seabedTileAt(xz / seabedLook.uSeabedTile.x, seabedLook.uSeabedTile.x, sharp);
  // The larger read's finer channels at the sizes of the smaller's coarser ones, so
  // what these make doesn't repeat with the smaller tile.
  let beds = 2.0 * far.r - 1.0;
  let clumps = near.r + far.g - 1.0;
  let small = near.g + far.b - 1.0;
  let fine = 2.0 * near.b - 1.0;

  // Coral from the reef's crest back onto the flat, its edge wandering, and on what rises from the floor.
  let reef = smoothstep(-38.0, -8.0, info.w + 16.0 * beds + 6.0 * clumps);
  let coral = max(reef, smoothstep(0.3, 1.2, rises)) * smoothstep(0.05, 0.25, depth);
  let heads = 0.87 + 0.13 * near.a;
  let mottled = mix(seabedLook.uCoralDark, seabedLook.uCoralLight, smoothstep(0.1, 0.9, (0.5 + 0.3 * beds + 0.4 * clumps + 0.3 * small + 0.15 * fine) * heads));

  var sand = mix(seabedLook.uWetSand, seabedLook.uSeabedSand, smoothstep(0.0, 0.15, depth));
  sand *= 1.0 + 0.1 * clumps + 0.06 * small + 0.04 * fine;
  let weeds = smoothstep(0.1, 0.45, beds + 0.5 * clumps + 0.25 * small) * smoothstep(0.3, 1.0, depth);
  sand = mix(sand, seabedLook.uWeed * (1.0 + 0.35 * small + 0.35 * fine), 0.8 * weeds);
  // Its ripples, where a pixel holds them, run along the shore's way.
  let held = (1.0 - smoothstep(0.03, 0.1, sharp)) * (1.0 - coral) * (1.0 - weeds);
  slope += terrainWorldSlope(vec2f(0.0, 0.1 * held * cos(8.0 * (ao.y + 4.0 * clumps))));

  // A rocky shore's rock runs out under sand a little way off it, its edge wandering.
  let rocky = cover.y * (1.0 - smoothstep(10.0, 40.0, shore + 20.0 * beds + 8.0 * clumps));
  let rock = mix(seabedLook.uWetRock, mottled, smoothstep(0.0, 2.0, depth));
  let albedo = mix(mix(sand, rock, rocky), mottled, coral);

  let n = normalize(vec3f(-slope.x, 1.0, -slope.y));
  let sunBelow = -refract(-frame.uSunDirection, vec3f(0.0, 1.0, 0.0), 1.0 / ior);
  let tilt = max(dot(n, sunBelow), 0.0) / max(sunBelow.y, 0.1);
  return albedo / PI * (sun * tilt + shIrradiance(n));
}
