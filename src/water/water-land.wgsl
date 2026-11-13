// What the surface mirrors of what stands over it: water/mirror.js has thrown the
// opaque scene to where its mirror image lies on screen. A flat sea would read it at
// its own pixel; a tilted bit of surface sends its ray elsewhere, and where that ray
// lands on the image depends on how far it goes: nothing moves at the foot of a
// rock, and far off a hill the waves stretch it down the water in long streaks.
// Needs uOpaque, `frame` and `water`.

const MIRROR_INDEX_BITS = 22u; // as mirror-project.wgsl
const MIRROR_NEAR_OCTAVES = 17.0;
const MIRROR_NEAR_LEVELS = 1022.0;
const MIRROR_NEARER = 0.98; // a level of how near is 1.2%: what stands at the water's foot counts as behind it

// Where the first thing along the view at this pixel of the opaque scene lies, in the world.
fn opaqueSeen(pixel: vec2i, size: vec2f) -> vec3f {
  let z = textureLoad(uOpaqueDepth, pixel, 0);
  let away = frame.projectionMatrix[3][2] / (z + frame.projectionMatrix[2][2]);
  let ndc = (vec2f(pixel) + 0.5) / size * vec2f(2.0, -2.0) + vec2f(-1.0, 1.0);
  let inView = vec3f(ndc.x / frame.projectionMatrix[0][0], ndc.y / frame.projectionMatrix[1][1], -1.0) * away;
  return frame.cameraPosition + (vec4f(inView, 0.0) * frame.viewMatrix).xyz; // the camera's rotation, inverted
}

// How far along the eye's axis (m) what a key holds lies, as far as its levels tell.
fn landKeyW(key: u32) -> f32 {
  let near = f32((key >> MIRROR_INDEX_BITS) - 1u) / MIRROR_NEAR_LEVELS;
  return exp2((1.0 - near) * MIRROR_NEAR_OCTAVES);
}

// The land's stored colour at a cell of the image, and how much of it there is: its
// row's share of the frame fades it off the frame's top, whose rows mirror nothing
// further. Nothing where it stands nearer the eye than this water (eyeW, along the
// eye's axis): water behind a rock can't mirror it; nor where it stands no higher than
// `above` m over the still sea: the image is the still sea's, and water lying higher,
// on a beach, mirrors nothing of the beach lower down round it.
fn landCell(cell: vec2i, eyeW: f32, above: f32) -> vec4f {
  let key = uMirror[u32(cell.x) + u32(cell.y) * u32(water.uMirrorCells.x)];
  if (key == 0u || landKeyW(key) < MIRROR_NEARER * eyeW) {
    return vec4f(0.0);
  }
  let index = key & ((1u << MIRROR_INDEX_BITS) - 1u);
  let across = u32(water.uMirrorCells.x);
  let source = vec2u(index % across, index / across);
  let stride = u32(water.uMirrorCells.z);
  let pixel = min(source * stride + stride / 2u, vec2u(textureDimensions(uOpaque)) - 1u);
  let standing = opaqueSeen(vec2i(pixel), vec2f(textureDimensions(uOpaqueDepth)));
  if (standing.y + planetDrop(standing.xz) < above) {
    return vec4f(0.0);
  }
  let stored = textureLoad(uOpaque, pixel, 0);
  // At an edge its samples are weighted by alpha (post/opaque-resolve.wgsl), so what
  // wasn't drawn, or was left to the water, adds nothing: what it covers, and how much.
  return vec4f(stored.rgb / max(stored.a, 1e-3), stored.a * smoothstep(0.0, water.uMirrorCells.w, f32(source.y) / water.uMirrorCells.y));
}

// How far past the point the first thing in the image at this pixel stands (m), below 0 where nothing does.
fn landFarther(pixel: vec2f, away: f32, eyeW: f32) -> f32 {
  let cell = vec2i(pixel / water.uMirrorCells.z);
  let key = uMirror[u32(cell.x) + u32(cell.y) * u32(water.uMirrorCells.x)];
  if (key == 0u) {
    return -1.0;
  }
  return away * (landKeyW(key) / eyeW - 1.0);
}

// Where in the image the ray from p towards dir lands after `far` metres: its share
// of the cells, off them beyond [0, 1].
fn landImageUv(p: vec3f, dir: vec3f, far: f32) -> vec3f {
  let q = p + dir * far;
  let image = vec3f(q.x, q.y - 2.0 * (q.y + planetDrop(q.xz)), q.z);
  let clip = frame.projectionMatrix * frame.viewMatrix * vec4f(image, 1.0);
  return vec3f(clip.xy / max(clip.w, 1e-4) * vec2f(0.5, -0.5) + 0.5, clip.w);
}

// Whether a ray's landing has any image to read: in front of the eye and within the
// frame's rows. Off its sides it reads the side's column, as the land beyond a side
// runs on from what stands at it; taking it for sky put a sliver of sky by each side
// wherever the waves tilt rays out of the frame.
fn landOnImage(at: vec3f) -> bool {
  return at.z > 0.0 && at.y >= 0.0 && at.y < 1.0;
}

// The land along that ray, read at the nearest cell: enough where the waves blur it.
fn landNearest(at: vec3f, eyeW: f32, above: f32) -> vec4f {
  if (!landOnImage(at)) {
    return vec4f(0.0);
  }
  let cell = vec2i(at.xy * water.uMirrorCells.xy);
  return landCell(vec2i(clamp(cell.x, 0, i32(water.uMirrorCells.x) - 1), cell.y), eyeW, above);
}

// Between the four nearest cells: where the water lies still enough to show the land sharp.
fn landSmooth(at: vec3f, eyeW: f32, above: f32) -> vec4f {
  if (!landOnImage(at)) {
    return vec4f(0.0);
  }
  let st = at.xy * water.uMirrorCells.xy - 0.5;
  let i = floor(st);
  let f = st - i;
  let top = water.uMirrorCells.xy - 1.0;
  var color = vec3f(0.0);
  var share = 0.0;
  for (var k = 0; k < 4; k++) {
    let corner = vec2f(f32(k & 1), f32(k >> 1u));
    let weight = mix(1.0 - f.x, f.x, corner.x) * mix(1.0 - f.y, f.y, corner.y);
    let land = landCell(vec2i(clamp(i + corner, vec2f(0.0), top)), eyeW, above);
    color += weight * land.a * land.rgb;
    share += weight * land.a;
  }
  return vec4f(color / max(share, 1e-4), share);
}
