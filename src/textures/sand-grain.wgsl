// The sand's grain (textures/sand.js): a tile uTile millimetres across. Fine
// speckle under grit of a millimetre or so, mostly pale shell, some pink
// coral, tan and dark volcanic grains, and here and there a fragment of shell
// a few millimetres long. rgb: the albedo's factor, halved; a: height.

#include "chunks/fullscreen.wgsl"
#include "tileable.wgsl"

struct SandGrain {
  uTile: f32, // mm
  uSeed: vec2f,
  uShift: vec2f, // tiles: shifted by whole ones, the texture is the same (fixtures/surfaces.js checks)
}

@group(1) @binding(0) var<uniform> sandGrain: SandGrain;

// A grid of cells about `size` mm that repeats over the tile: its cell count.
fn cellsAcross(size: f32) -> f32 {
  return floor(sandGrain.uTile / size + 0.5);
}

// The colour factors grains take: pale shell, pink coral, tan, dark volcanic.
fn grainTint(pick: f32) -> vec3f {
  if (pick < 0.5) {
    return vec3f(1.16, 1.14, 1.1);
  }
  if (pick < 0.68) {
    return vec3f(1.12, 0.95, 0.92);
  }
  if (pick < 0.9) {
    return vec3f(0.86, 0.78, 0.64);
  }
  return vec3f(0.34, 0.33, 0.33);
}

@fragment
fn fragmentMain(in: Fullscreen) -> @location(0) vec4f {
  let uv = in.vUv + sandGrain.uShift;
  var factor = vec3f(1.0);
  var height = 0.3;

  // Speckle: every cell of 0.6 mm a little lighter or darker, a little pinker or creamier.
  let n1 = cellsAcross(0.6);
  let s = tileHash(floor(uv * n1), n1, sandGrain.uSeed);
  factor *= 1.0 + 0.07 * s.x;
  factor *= vec3f(1.0 + 0.02 * s.y, 1.0, 1.0 - 0.03 * s.y);
  height += 0.08 * s.x;

  // Grit: in four cells of ten, a grain about a millimetre across. Its centre
  // lies 0.15 of a cell or more inside its cell and it reaches less than 0.3
  // of one, so only its own cell and the nearer neighbour on each axis can
  // reach p: 2 x 2 cells, the lower first, in the order a 3 x 3 search takes them.
  let n2 = cellsAcross(3.2);
  var p = uv * n2;
  var cell = floor(p);
  var lower = cell + select(vec2f(0.0), vec2f(-1.0), p - cell < vec2f(0.5));
  for (var j = 0; j <= 1; j++) {
    for (var i = 0; i <= 1; i++) {
      let c = lower + vec2f(f32(i), f32(j));
      let h = tileHash(c, n2, sandGrain.uSeed + 3.1) * 0.5 + 0.5;
      if (h.x > 0.42) {
        continue;
      }
      let at = c + 0.15 + 0.7 * (tileHash(c, n2, sandGrain.uSeed + 7.7) * 0.5 + 0.5);
      let radius = (0.45 + 0.4 * h.y) * n2 / sandGrain.uTile; // mm into cells
      let d = length(p - at) / radius;
      if (d >= 1.0) {
        continue;
      }
      let inside = 1.0 - smoothstep(0.7, 1.0, d);
      factor = mix(factor, grainTint(fract(h.x * 7.13 + h.y * 3.7)), inside);
      height = max(height, 0.5 + 0.3 * sqrt(1.0 - d * d));
    }
  }

  // Shell fragments: in one cell of eight, an angular flake of 2 to 5 mm, with
  // a darker rim. Its centre lies 0.2 of a cell or more inside its cell and it
  // reaches 3 mm, a quarter of one at most: 2 x 2 cells, as the grit's.
  let n3 = cellsAcross(14.0);
  p = uv * n3;
  cell = floor(p);
  lower = cell + select(vec2f(0.0), vec2f(-1.0), p - cell < vec2f(0.5));
  for (var j = 0; j <= 1; j++) {
    for (var i = 0; i <= 1; i++) {
      let c = lower + vec2f(f32(i), f32(j));
      let h = tileHash(c, n3, sandGrain.uSeed + 11.9) * 0.5 + 0.5;
      if (h.x > 0.12) {
        continue;
      }
      let at = c + 0.2 + 0.6 * (tileHash(c, n3, sandGrain.uSeed + 5.3) * 0.5 + 0.5);
      let off = (p - at) * sandGrain.uTile / n3; // mm
      let angle = atan2(off.y, off.x);
      // Five-ish corners, from a noise read round the flake.
      let edge = (1.0 + 2.0 * h.y) * (0.75 + 0.25 * abs(sin(2.5 * angle + 9.0 * h.y)));
      let d = length(off) / edge;
      if (d >= 1.0) {
        continue;
      }
      let shell = select(vec3f(1.22, 1.2, 1.15), vec3f(1.18, 1.05, 1.02), h.y > 0.6);
      let rim = smoothstep(0.75, 0.95, d);
      factor = mix(factor, shell * (1.0 - 0.25 * rim), 1.0 - smoothstep(0.92, 1.0, d));
      height = max(height, 0.75);
    }
  }

  return vec4f(clamp(factor * 0.5, vec3f(0.0), vec3f(1.0)), clamp(height, 0.0, 1.0));
}
