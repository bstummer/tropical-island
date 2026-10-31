// How foam looks. It is a surface of its own under the shared light, so what else
// foams (Stage 7's lines on the beach) can join the surf's (water-surf.wgsl):
// seaFoamCover() turns how much foam there is into how much of the pixel it covers,
// foamLight() lights that. Needs `water`, water-surf.wgsl, water-seabed.wgsl.

// How much of a pixel `wide` m across foam covers, as lace where it lies thin, and how
// bright that is, as thick foam stands proud of its own hollows, read from the
// mottling of the seabed's tile, drifting with the swell. Far off, where a pixel holds
// many of its gaps, it covers as much as there is foam: a thin line of it still shows.
// None at all where there is none.
fn seaFoamCover(foam: f32, xz: vec2f, t: f32, wide: f32) -> vec2f {
  let large = seabedTileAt(SEABED_TURN * xz / water.uFoamLook.x - water.uFoamDrift.xy * t, water.uFoamLook.x, wide);
  let small = seabedTileAt(xz / water.uFoamLook.y - water.uFoamDrift.zw * t, water.uFoamLook.y, wide);
  let lace = 0.45 * large.r + 0.25 * large.g + 0.3 * small.g;
  let soft = clamp(wide / water.uFoamLook.z, 0.12, 0.5);
  let middle = 1.0 + soft - foam * (1.0 + 2.0 * soft);
  let far = smoothstep(water.uFoamLook.z, 4.0 * water.uFoamLook.z, wide);
  return vec2f(mix(smoothstep(middle - soft, middle + soft, lace), min(foam, 1.0), far), 0.6 + 0.4 * smoothstep(0.3, 0.7, lace));
}

// Foam's light: white, lit from the sun and the sky on it. It stands up off the water
// in heaps, some side of which always faces the sun: a low sun, which hardly reaches
// the level sea, still lights it. beam: the sun's light on a surface facing it.
fn foamLight(beam: vec3f, sky: vec3f) -> vec3f {
  return water.uFoamAlbedo / PI * (beam * mix(water.uFoamFacing, 1.0, max(frame.uSunDirection.y, 0.0)) + sky);
}
