// One stage of an inverse FFT of a cascade's fields (waves-evolve.wgsl), along
// its rows or its columns: Stockham's, so no reordering, each stage reading one
// buffer and writing the other. A stage with stride s takes each point of the
// line from two points half the current length apart; after log2(size) of them
// the line is whole.

struct Stage {
  uSize: u32,
  uStride: u32, // 1, 2, 4... up to size / 2
  uHorizontal: u32, // 1 along rows, 0 along columns
  uPad: u32,
}

struct Cell {
  first: vec4f,
  second: vec4f,
}

@group(0) @binding(0) var<uniform> stage: Stage;
@group(0) @binding(1) var<storage, read> twiddles: array<vec2f>; // e^(2 pi i m / size), m up to size / 2
@group(0) @binding(2) var<storage, read> source: array<Cell>;
@group(0) @binding(3) var<storage, read_write> output: array<Cell>;

fn times(a: vec2f, b: vec2f) -> vec2f {
  return vec2f(a.x * b.x - a.y * b.y, a.x * b.y + a.y * b.x);
}

@compute @workgroup_size(16, 16)
fn main(@builtin(global_invocation_id) id: vec3u) {
  let size = stage.uSize;
  if (id.x >= size || id.y >= size) {
    return;
  }
  let s = stage.uStride;
  // The point along the line and which line it is.
  let horizontal = stage.uHorizontal == 1u;
  let along = select(id.y, id.x, horizontal);
  let line = select(id.x, id.y, horizontal);
  let stride = select(size, 1u, horizontal);
  let start = select(line, line * size, horizontal);

  let q = along % s;
  let r = along / s;
  let p = r / 2u;
  let half = size / s / 2u;
  let a = source[start + (q + s * p) * stride];
  let b = source[start + (q + s * (p + half)) * stride];
  var cell: Cell;
  if ((r & 1u) == 0u) {
    cell.first = a.first + b.first;
    cell.second = a.second + b.second;
  } else {
    let w = twiddles[p * s];
    let first = a.first - b.first;
    let second = a.second - b.second;
    cell.first = vec4f(times(first.xy, w), times(first.zw, w));
    cell.second = vec4f(times(second.xy, w), times(second.zw, w));
  }
  output[start + along * stride] = cell;
}
