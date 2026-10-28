// The rock's detail (textures/rock.js), its first pass: a tile uTile metres
// across of rock broken into blocks by cracks, each block standing a little
// proud or sunk and tilted, its edges bevelled or rounded; the faces rough,
// pitted, and speckled with the rock's two minerals. r: the height (m); g:
// the albedo's factor, but for the second mineral's brightness, which its
// tint carries (textures/rock.js): so it stays under 2, and follows the
// weathering alone; b: how much of it is the second mineral.

#include "chunks/fullscreen.wgsl"
#include "tileable.wgsl"

struct RockTile {
  uTile: f32, // m
  uSeed: vec2f,
  uShift: vec2f, // tiles: shifted by whole ones, the texture is the same (fixtures/surfaces.js checks)
  uBlocks: vec4f, // size (m); how regular, 0 to 1; crack width (m); bevel (m)
  uShape: vec4f, // rounding of the edges, 0 (a chamfer) to 1; tilt of the faces; how much they stand proud or sunk, of the bevel; the share of joints that gape
  uFace: vec4f, // roughness (m); pit size (m); share of cells with a pit; pit depth (m)
  uMinerals: vec3f, // crystal size (m); share of the second mineral; the speckle's contrast
}

@group(1) @binding(0) var<uniform> rockTile: RockTile;

// A grid of cells about `size` metres that repeats over the tile: its cell count.
fn cellsAcross(size: f32) -> f32 {
  return max(1.0, floor(rockTile.uTile / size + 0.5));
}

struct Block {
  cell: vec2f, // its cell, within the grid's repeat
  toPoint: vec2f, // from here to the block's point, in cells
  border: f32, // to the nearest border with another block, in cells
}

// Blocks: the cells of a Voronoi diagram over a grid n cells across that
// repeats, their points jittered; the borders' distance after Quilez.
fn nearestBlock(p: vec2f, n: f32, seed: vec2f, jitter: f32) -> Block {
  let ip = floor(p);
  let fp = p - ip;
  var mg = vec2f(0.0);
  var mr = vec2f(0.0);
  var md = 8.0;
  for (var j = -1; j <= 1; j++) {
    for (var i = -1; i <= 1; i++) {
      let g = vec2f(f32(i), f32(j));
      let r = g + 0.5 + jitter * tileHash(ip + g, n, seed) - fp;
      let d = dot(r, r);
      if (d < md) {
        md = d;
        mr = r;
        mg = g;
      }
    }
  }
  var border = 8.0;
  for (var j = -2; j <= 2; j++) {
    for (var i = -2; i <= 2; i++) {
      let g = mg + vec2f(f32(i), f32(j));
      let r = g + 0.5 + jitter * tileHash(ip + g, n, seed) - fp;
      let d = r - mr;
      if (dot(d, d) > 1e-6) {
        border = min(border, dot(0.5 * (mr + r), normalize(d)));
      }
    }
  }
  var b: Block;
  b.cell = (ip + mg) - n * floor((ip + mg) / n); // GLSL's mod(ip + mg, n)
  b.toPoint = mr;
  b.border = border;
  return b;
}

@fragment
fn fragmentMain(in: Fullscreen) -> @location(0) vec4f {
  let uv = in.vUv + rockTile.uShift;

  // Joints: the borders between blocks, which wander, and gape as cracks in
  // stretches; elsewhere the blocks meet closed, in a step or a crease.
  let n = cellsAcross(rockTile.uBlocks.x);
  let nw = 2.0 * n;
  let warp = 0.12 / n * vec2f(tileFbm(uv * nw, nw, rockTile.uSeed + 31.0, 3), tileFbm(uv * nw, nw, rockTile.uSeed + 37.0, 3));
  let jitter = 0.45 * (1.0 - rockTile.uBlocks.y);
  let b = nearestBlock((uv + warp) * n, n, rockTile.uSeed, jitter);
  let cell = rockTile.uTile / n; // m
  let border = b.border * cell;
  let gapes = smoothstep(-0.15, 0.15, tileNoise(uv * nw, nw, rockTile.uSeed + 41.0) + 0.7 * (2.0 * rockTile.uShape.w - 1.0));
  let crack = gapes * (1.0 - smoothstep(0.3 * rockTile.uBlocks.z, rockTile.uBlocks.z, border));

  // Each block a little proud or sunk and tilted; its edge eased down to the
  // joint by the bevel, rounded or chamfered.
  let own = tileHash(b.cell, n, rockTile.uSeed + 4.1);
  let tilt = tileHash(b.cell, n, rockTile.uSeed + 8.3);
  let bevel = rockTile.uBlocks.w;
  let x = clamp(border / bevel, 0.0, 1.0);
  let profile = mix(x, sqrt(x * (2.0 - x)), rockTile.uShape.x);
  var height = profile * (rockTile.uShape.z * bevel * (own.x + 1.0) + rockTile.uShape.y * dot(tilt, -b.toPoint * cell));
  height -= 1.5 * rockTile.uBlocks.z * crack;

  // Rough faces: sharp-creased hollows and ridges, from a hand's width down to millimetres.
  let rough = cellsAcross(0.25);
  let ridged = tileRidged(uv * rough, rough, rockTile.uSeed + 2.0, 6);
  height += rockTile.uFace.x * (ridged - 0.4);

  // Pits: gas bubbles in lava, solution pits in limestone.
  let np = cellsAcross(3.0 * rockTile.uFace.y);
  let pp = uv * np;
  let pc = floor(pp);
  var pit = 0.0;
  for (var j = -1; j <= 1; j++) {
    for (var i = -1; i <= 1; i++) {
      let c = pc + vec2f(f32(i), f32(j));
      let h = tileHash(c, np, rockTile.uSeed + 13.0) * 0.5 + 0.5;
      if (h.x > rockTile.uFace.z) {
        continue;
      }
      // Anywhere in its cell, of any size, most small: no grid shows.
      let at = c + 0.15 + 0.7 * (tileHash(c, np, rockTile.uSeed + 17.0) * 0.5 + 0.5);
      let d = length(pp - at) / (0.12 + 0.4 * h.y * h.y);
      if (d < 1.0) {
        pit = max(pit, 1.0 - d * d);
      }
    }
  }
  height -= rockTile.uFace.w * pit;

  // Minerals: angular crystals, each of one mineral or the other, and a speckle.
  let nm = cellsAcross(rockTile.uMinerals.x);
  let m = nearestBlock(uv * nm, nm, rockTile.uSeed + 21.0, 0.45);
  let mh = tileHash(m.cell, nm, rockTile.uSeed + 25.0) * 0.5 + 0.5;
  let second = step(mh.x, rockTile.uMinerals.y);
  var factor = 1.0 + rockTile.uMinerals.z * (2.0 * mh.y - 1.0);

  // Weathering: each block its own shade, crests worn lighter, hollows,
  // cracks and pits holding dirt and shade.
  factor *= 1.0 + 0.12 * own.y;
  factor *= 0.75 + 0.5 * smoothstep(0.15, 0.65, ridged);
  factor *= 1.0 - 0.6 * crack;
  factor *= 1.0 - 0.45 * pit;

  return vec4f(height, factor, second, 1.0);
}
