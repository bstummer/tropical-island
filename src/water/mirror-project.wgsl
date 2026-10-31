// What the sea mirrors of the land (water/mirror.js): each cell's worth of the
// opaque scene that stands above the sea is thrown to where its mirror image in the
// sea lies on screen. Which of several lands in a cell is the nearest to the eye
// beneath the sea, whichever order they come in: a key holds how near, then which
// cell of the opaque scene it came from. 0: nothing.

struct Project {
  uClip: mat4x4f, // world to clip
  uView: mat4x4f,
  uProjection: vec4f, // the projection's [0][0], [1][1], [2][2], [3][2]
  uCamera: vec3f,
  uGroundRadius: f32, // km
  uPixels: vec2f,
  uCells: vec2u,
  uStride: u32, // pixels a cell
}

@group(0) @binding(0) var<uniform> project: Project;
@group(0) @binding(1) var uDepth: texture_depth_2d;
@group(0) @binding(2) var<storage, read_write> cells: array<atomic<u32>>;

// Water/water-land.wgsl reads the keys back by these.
const INDEX_BITS = 22u; // cells of the opaque scene: more than 4K's at 2 pixels a cell
const NEAR_OCTAVES = 17.0; // from 1 m to about 130 km
const NEAR_LEVELS = 1022.0;

@compute @workgroup_size(16, 16)
fn main(@builtin(global_invocation_id) id: vec3u) {
  if (id.x >= project.uCells.x || id.y >= project.uCells.y) {
    return;
  }
  let pixel = min(id.xy * project.uStride + project.uStride / 2u, vec2u(project.uPixels) - 1u);
  let z = textureLoad(uDepth, pixel, 0);
  if (z <= 0.0) {
    return; // the far plane: nothing drew here
  }
  let away = project.uProjection.w / (z + project.uProjection.z);
  let ndc = (vec2f(pixel) + 0.5) / project.uPixels * vec2f(2.0, -2.0) + vec2f(-1.0, 1.0);
  let inView = vec3f(ndc.x / project.uProjection.x, ndc.y / project.uProjection.y, -1.0) * away;
  let world = project.uCamera + (vec4f(inView, 0.0) * project.uView).xyz; // the camera's rotation, inverted
  // The sea's surface bends with the planet (chunks/planet.wgsl).
  let across = world.xz - project.uCamera.xz;
  let above = world.y + dot(across, across) / (2000.0 * project.uGroundRadius);
  if (above <= 0.0) {
    return;
  }
  let clip = project.uClip * vec4f(world.x, world.y - 2.0 * above, world.z, 1.0);
  if (clip.w <= 0.0) {
    return;
  }
  let uv = clip.xy / clip.w * vec2f(0.5, -0.5) + 0.5;
  if (any(uv < vec2f(0.0)) || any(uv >= vec2f(1.0))) {
    return;
  }
  let cell = vec2u(uv * vec2f(project.uCells));
  // So near its own image that it falls by rounding alone: the first of a shore lying
  // nearly flat in the sea, whose image is hidden by the shore itself.
  if (cell.y <= id.y + 1u) {
    return;
  }
  let near = clamp(1.0 - log2(max(clip.w, 1.0)) / NEAR_OCTAVES, 0.0, 1.0);
  let key = ((u32(near * NEAR_LEVELS) + 1u) << INDEX_BITS) | (id.x + id.y * project.uCells.x);
  place(cell, key);
  // The image leans as the eye looks down, so it falls short of the frame's sides: the
  // last column runs on to the side, as what stands past it is much the same.
  if (id.x == 0u) {
    for (var x = cell.x; x > 0u && cell.x - x < SIDE_REACH; x--) {
      place(vec2u(x - 1u, cell.y), key);
    }
  } else if (id.x + 1u == project.uCells.x) {
    for (var x = cell.x + 1u; x < project.uCells.x && x - cell.x <= SIDE_REACH; x++) {
      place(vec2u(x, cell.y), key);
    }
  }
}

const SIDE_REACH = 128u; // cells

// In this cell and the next row's: the image stretches, and would leave holes along its rows.
fn place(cell: vec2u, key: u32) {
  atomicMax(&cells[cell.x + cell.y * project.uCells.x], key);
  if (cell.y + 1u < project.uCells.y) {
    atomicMax(&cells[cell.x + (cell.y + 1u) * project.uCells.x], key);
  }
}
