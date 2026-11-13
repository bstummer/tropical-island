// How foam looks. It is a surface of its own under the shared light, the surf's
// (water-surf.wgsl) and the beach's (swash.wgsl) alike: seaFoamCover() turns how much
// foam there is into how much of the pixel it covers, foamLight() lights that. Needs
// `water`, water-seabed.wgsl, chunks/tiles.wgsl.

// The level of the foam's tile that leaves `share` of it above (textures/foam.js).
fn foamLevel(share: f32) -> f32 {
  let at = clamp(share, 0.0, 1.0) * 16.0;
  let i = min(u32(at), 15u);
  let j = i + 1u;
  return mix(water.uFoamLevels[i / 4u][i % 4u], water.uFoamLevels[j / 4u][j % 4u], at - f32(i));
}

// The largest hole in the foam's tile, in tiles: textures/foam-tile.wgsl's HOLE_LARGEST.
const FOAM_HOLE_LARGEST: f32 = 0.03;

// The foam's tile at uv (in tiles), its side `size` m, for a pixel `footprint` m wide.
fn foamTileAt(uv: vec2f, size: f32, footprint: f32) -> vec4f {
  let level = log2(max(footprint * seabedLook.uSeabedTile.z / size, 1e-3));
  return textureSampleLevel(uSurfaceTiles, uSurfaceTilesSampler, uv, i32(TILE_FOAM), level);
}

// How much of a pixel `wide` m across foam covers, and how bright that is. Where it lies
// thick and where thin over metres comes from the mottling of the seabed's tile; up close,
// the holes of open water its bubbles leave as they burst, from its own tile, small ones
// first, then larger, till only a web of it is left, then bits. That tile is read in the
// frame of the way the water carries it (`way`, unit), stretched along it and moved
// `along` it (m), twice at sides of no simple ratio, all drifting with the swell for
// `drifting` s, and cut at the level that leaves as much as the foam covers, its edges as
// soft as the pixel is long (`longest`, m), or where it stretches its holes would flicker.
// None at all where there is none. Up close it has relief: its heaps are lit on the side that
// faces the sun, dimmer on the other, as how far into the foam a point lies rises and falls.
fn seaFoamCover(foam: f32, xz: vec2f, way: vec2f, along: f32, drifting: f32, wide: f32, longest: f32) -> vec2f {
  let t = drifting;
  let large = seabedTileAt(SEABED_TURN * xz / water.uFoamLook.x - water.uFoamDrift.xy * t, water.uFoamLook.x, wide);
  let small = seabedTileAt(xz / water.uFoamLook.y - water.uFoamDrift.zw * t, water.uFoamLook.y, wide);
  let patchy = 0.45 * large.r + 0.25 * large.g + 0.3 * small.g;
  let amount = clamp(foam * (0.2 + 1.6 * patchy), 0.0, 1.0);
  let flow = vec2f((dot(xz, way) - along) * water.uFoamLace.z, dot(xz, vec2f(-way.y, way.x)));
  let near = foamTileAt(flow / water.uFoamLace.x - vec2f(water.uFoamLaceDrift.x * t, 0.0), water.uFoamLace.x, wide);
  let wider = foamTileAt(flow / water.uFoamLace.y + vec2f(0.37 - water.uFoamLaceDrift.y * t, 0.61), water.uFoamLace.y, wide);
  // How far into the foam, in holes' radii, and the nearest hole's radius (m): the read
  // whose holes are nearer. What is left of two reads is the product of their shares.
  let nearer = select(wider, near, near.r < wider.r);
  let size = select(water.uFoamLace.y, water.uFoamLace.x, near.r < wider.r);
  let into = 2.0 * nearer.r;
  let covers = smoothstep(water.uFoamCovers.x, water.uFoamCovers.y, amount);
  let level = foamLevel(sqrt(covers));
  let soft = clamp(longest / max(nearer.b * FOAM_HOLE_LARGEST * size, 1e-4), 0.03, 1.0);
  // A pixel as long as the holes covers at least as much as the level leaves, on average: a
  // cut that soft falls short of all of it even where the foam covers all, and where a swell's
  // top turns edge-on to a swimmer's eye that drew a grey line across the whitewater. Sparse
  // foam keeps its bits.
  let lace = max(smoothstep(level - soft, level + soft, into), covers * smoothstep(0.25, 1.0, soft));
  // Brightest where it lies thickest, far from any hole; greyer at their edges, where it thins.
  let thick = smoothstep(level, level + 0.8, into);
  let far = smoothstep(water.uFoamLook.z, 4.0 * water.uFoamLook.z, wide);
  // Its relief: how far into it the foam lies a step towards the sun, in the lace's frame.
  var relief = 0.0;
  let sunWay = frame.uSunDirection.xz / max(length(frame.uSunDirection.xz), 1e-4);
  if (far < 1.0 && frame.uSunDirection.y > 0.0) {
    let step = water.uFoamRelief.x;
    let toward = vec2f(dot(sunWay, way) * water.uFoamLace.z, dot(sunWay, vec2f(-way.y, way.x))) * step;
    let sunward = foamTileAt((flow + toward) / water.uFoamLace.x - vec2f(water.uFoamLaceDrift.x * t, 0.0), water.uFoamLace.x, wide);
    // Rising towards the sun, a heap's side faces away from it: dimmer.
    relief = (1.0 - far) * clamp(water.uFoamRelief.y * (near.r - sunward.r) / step, -water.uFoamRelief.z, water.uFoamRelief.z);
  }
  let bright = mix((0.68 + 0.32 * thick) * (0.9 + 0.2 * near.g), 0.68 + 0.32 * covers, far) * (1.0 + relief);
  return vec2f(mix(lace, amount, far), bright);
}

// Foam's light: white, lit from the sun and the sky on it. It stands up off the water
// in heaps, some side of which always faces the sun: a low sun, which hardly reaches
// the level sea, still lights it. Its thin tops and spray let some of the sun through,
// mostly onwards: seen against a low sun it glows rather than standing dark against
// the sky the sea mirrors. beam: the sun's light on a surface facing it; view: to the eye.
fn foamLight(beam: vec3f, sky: vec3f, view: vec3f) -> vec3f {
  let g = water.uFoamBacklit.y;
  let onwards = (1.0 - g * g) / (4.0 * PI * pow(1.0 + g * g + 2.0 * g * dot(view, frame.uSunDirection), 1.5));
  return water.uFoamAlbedo * (beam * (mix(water.uFoamFacing, 1.0, max(frame.uSunDirection.y, 0.0)) / PI + water.uFoamBacklit.x * onwards) + sky / PI);
}
