// What a pixel of the water's surface sees of what lies under it: the ray from
// the eye bends down at the surface, so it meets the seabed much nearer than the
// straight line through that pixel would, and it never travels far through the
// water, however low the eye looks. That is why a lagoon's colours follow its
// depth, and what makes the shallows clear.
//
// Where it lands comes from how deep the water is, and the seabed there needs no
// pixel of the opaque scene (water-seabed.wgsl): no mesh or level of detail shows
// under the water. All the opaque scene adds is what stands on the seabed, the
// rocks, and the ground just under the waterline, each with its share of the pixel
// in alpha (world/terrain.wgsl), found by walking the ray over the opaque scene
// on screen, which keeps what the ray only passes behind out of it. Needs
// uOpaque, uOpaqueDepth, `frame`, and from the includer seaDepthAt(xz, footprint),
// how deep the water is as a pixel that wide sees it, and seabedDepthAt(xz, footprint),
// the same as finely as it is known (m).

// How deep under the sea the first thing along the view at this pixel of the
// opaque scene lies, as before the planet's bend: below 0 above it.
fn opaqueDepthBelow(pixel: vec2i, size: vec2f) -> f32 {
  let z = textureLoad(uOpaqueDepth, pixel, 0);
  let away = frame.projectionMatrix[3][2] / (z + frame.projectionMatrix[2][2]);
  let ndc = (vec2f(pixel) + 0.5) / size * vec2f(2.0, -2.0) + vec2f(-1.0, 1.0);
  let inView = vec3f(ndc.x / frame.projectionMatrix[0][0], ndc.y / frame.projectionMatrix[1][1], -1.0) * away;
  let p = frame.cameraPosition + (vec4f(inView, 0.0) * frame.viewMatrix).xyz; // the camera's rotation, inverted
  return -(p.y + planetDrop(p.xz));
}

// The pixel of a point given in clip space, -1 where it is off the frame. Rows from the top.
fn seenPixel(clip: vec4f, size: vec2f) -> vec2i {
  if (clip.w <= 0.0) {
    return vec2i(-1);
  }
  let uv = clip.xy / clip.w * vec2f(0.5, -0.5) + 0.5;
  if (any(uv < vec2f(0.0)) || any(uv >= vec2f(1.0))) {
    return vec2i(-1);
  }
  return vec2i(uv * size);
}

// How deep the ray looks first for what stands in its way (m), how much deeper at
// each step, and how many steps it takes: the last lands on the seabed.
const SEEN_FIRST = 0.4;
const SEEN_DEEPER = 5.0;
const SEEN_STEPS = 4;
// How far (m, and as a share of how deep it is) what a pixel shows may lie from the
// ray where the ray comes back to it, to be what the ray meets.
const SEEN_NEAR = 0.3;
const SEEN_NEAR_SHARE = 0.25;

struct SeenBelow {
  xz: vec2f, // where the ray meets the seabed
  depth: f32, // how deep what it sees lies, m
  on: vec4f, // what stands there: its colour as the opaque scene stores it, and how much of the pixel it covers
}

// From a point of the surface along `bent` (unit, down), from the depth under the
// point (`guess`, m): how deep the ray goes, in two steps, which any slope sand
// lies on needs no more than, and which on a drop-off meet halfway rather than
// flip between its top and its foot; and what stands in its way on the way down:
// the first thing the ray goes behind on screen between one step and the next, if
// going back up the ray to how deep that lies still finds it there. A pixel can show
// something far nearer the eye than the ray at that pixel, a rock that the ray never
// comes near: it would float over deep water, a good way off. What stands well above
// the water (a rock's side, the beach) can't be what the ray sees, so it adds nothing,
// and nothing can bleed from it into the seabed beside it.
fn seenBelow(surface: vec3f, bent: vec3f, size: vec2f, deepest: f32, guess: f32, footprint: f32) -> SeenBelow {
  let down = 1.0 / max(-bent.y, 0.1);
  let along = bent.xz * down;
  let first = clamp(guess, 0.0, deepest);
  let second = clamp(seaDepthAt(surface.xz + along * first, footprint), 0.0, deepest);
  let reach = clamp(seaDepthAt(surface.xz + along * 0.5 * (first + second), footprint), 0.0, deepest);
  var out: SeenBelow;
  out.xz = surface.xz + along * reach;
  let seabed = clamp(seabedDepthAt(out.xz, footprint), 0.0, deepest);
  out.depth = seabed;
  out.on = vec4f(0.0);
  let start = frame.projectionMatrix * frame.viewMatrix * vec4f(surface, 1.0);
  let perMetre = frame.projectionMatrix * frame.viewMatrix * vec4f(bent * down, 0.0);
  var last = -0.3;
  var at = min(SEEN_FIRST, seabed);
  for (var i = 0; i < SEEN_STEPS; i++) {
    let pixel = seenPixel(start + perMetre * at, size);
    if (pixel.x < 0) {
      break;
    }
    let shown = opaqueDepthBelow(pixel, size);
    if (shown >= last && shown <= at) {
      let back = seenPixel(start + perMetre * max(shown, 0.0), size);
      if (back.x >= 0) {
        let met = opaqueDepthBelow(back, size);
        let stored = textureLoad(uOpaque, back, 0);
        if (stored.a > 0.0 && abs(met - shown) < max(SEEN_NEAR, SEEN_NEAR_SHARE * shown)) {
          out.on = vec4f(stored.rgb, stored.a * smoothstep(-0.3, -0.1, met));
          out.depth = mix(seabed, clamp(met, 0.0, seabed), out.on.a);
          break;
        }
      }
    }
    if (at >= seabed) {
      break;
    }
    last = at;
    at = select(min(at * SEEN_DEEPER, seabed), seabed, i == SEEN_STEPS - 2);
  }
  return out;
}
