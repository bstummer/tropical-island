// The rock's detail (textures/rock.js), its first pass: a tile uTile metres
// across of rock broken into blocks by cracks, each block standing a little
// proud or sunk and tilted, its edges bevelled or rounded; the faces rough,
// pitted, and speckled with the rock's two minerals. r: the height (m); g:
// the albedo's factor; b: how much of it is the second mineral.

#include "tileable.glsl"

uniform float uTile; // m
uniform vec2 uSeed;
uniform vec2 uShift; // tiles: shifted by whole ones, the texture is the same (fixtures/surfaces.js checks)
uniform vec4 uBlocks; // size (m); how regular, 0 to 1; crack width (m); bevel (m)
uniform vec4 uShape; // rounding of the edges, 0 (a chamfer) to 1; tilt of the faces; how much they stand proud or sunk, of the bevel; the share of joints that gape
uniform vec4 uFace; // roughness (m); pit size (m); share of cells with a pit; pit depth (m)
uniform vec4 uMinerals; // crystal size (m); share of the second mineral; its brightness; the speckle's contrast

varying vec2 vUv;

// A grid of cells about `size` metres that repeats over the tile: its cell count.
float cellsAcross(float size) {
  return max(1.0, floor(uTile / size + 0.5));
}

struct Block {
  vec2 cell; // its cell, within the grid's repeat
  vec2 toPoint; // from here to the block's point, in cells
  float border; // to the nearest border with another block, in cells
};

// Blocks: the cells of a Voronoi diagram over a grid n cells across that
// repeats, their points jittered; the borders' distance after Quilez.
Block nearestBlock(vec2 p, float n, vec2 seed, float jitter) {
  vec2 ip = floor(p);
  vec2 fp = p - ip;
  vec2 mg = vec2(0.0);
  vec2 mr = vec2(0.0);
  float md = 8.0;
  for (int j = -1; j <= 1; j++) {
    for (int i = -1; i <= 1; i++) {
      vec2 g = vec2(float(i), float(j));
      vec2 r = g + 0.5 + jitter * tileHash(ip + g, n, seed) - fp;
      float d = dot(r, r);
      if (d < md) {
        md = d;
        mr = r;
        mg = g;
      }
    }
  }
  float border = 8.0;
  for (int j = -2; j <= 2; j++) {
    for (int i = -2; i <= 2; i++) {
      vec2 g = mg + vec2(float(i), float(j));
      vec2 r = g + 0.5 + jitter * tileHash(ip + g, n, seed) - fp;
      vec2 d = r - mr;
      if (dot(d, d) > 1e-6) border = min(border, dot(0.5 * (mr + r), normalize(d)));
    }
  }
  Block b;
  b.cell = mod(ip + mg, n);
  b.toPoint = mr;
  b.border = border;
  return b;
}

void main() {
  vec2 uv = vUv + uShift;

  // Joints: the borders between blocks, which wander, and gape as cracks in
  // stretches; elsewhere the blocks meet closed, in a step or a crease.
  float n = cellsAcross(uBlocks.x);
  float nw = 2.0 * n;
  vec2 warp = 0.12 / n * vec2(tileFbm(uv * nw, nw, uSeed + 31.0, 3), tileFbm(uv * nw, nw, uSeed + 37.0, 3));
  float jitter = 0.45 * (1.0 - uBlocks.y);
  Block b = nearestBlock((uv + warp) * n, n, uSeed, jitter);
  float cell = uTile / n; // m
  float border = b.border * cell;
  float gapes = smoothstep(-0.15, 0.15, tileNoise(uv * nw, nw, uSeed + 41.0) + 0.7 * (2.0 * uShape.w - 1.0));
  float crack = gapes * (1.0 - smoothstep(0.3 * uBlocks.z, uBlocks.z, border));

  // Each block a little proud or sunk and tilted; its edge eased down to the
  // joint by the bevel, rounded or chamfered.
  vec2 own = tileHash(b.cell, n, uSeed + 4.1);
  vec2 tilt = tileHash(b.cell, n, uSeed + 8.3);
  float bevel = uBlocks.w;
  float x = clamp(border / bevel, 0.0, 1.0);
  float profile = mix(x, sqrt(x * (2.0 - x)), uShape.x);
  float height = profile * (uShape.z * bevel * (own.x + 1.0) + uShape.y * dot(tilt, -b.toPoint * cell));
  height -= 1.5 * uBlocks.z * crack;

  // Rough faces: sharp-creased hollows and ridges, from a hand's width down to millimetres.
  float rough = cellsAcross(0.25);
  float ridged = tileRidged(uv * rough, rough, uSeed + 2.0, 6);
  height += uFace.x * (ridged - 0.4);

  // Pits: gas bubbles in lava, solution pits in limestone.
  float np = cellsAcross(3.0 * uFace.y);
  vec2 pp = uv * np;
  vec2 pc = floor(pp);
  float pit = 0.0;
  for (int j = -1; j <= 1; j++) {
    for (int i = -1; i <= 1; i++) {
      vec2 c = pc + vec2(float(i), float(j));
      vec2 h = tileHash(c, np, uSeed + 13.0) * 0.5 + 0.5;
      if (h.x > uFace.z) continue;
      vec2 at = c + 0.3 + 0.4 * (tileHash(c, np, uSeed + 17.0) * 0.5 + 0.5);
      float d = length(pp - at) / (0.25 + 0.25 * h.y);
      if (d < 1.0) pit = max(pit, 1.0 - d * d);
    }
  }
  height -= uFace.w * pit;

  // Minerals: angular crystals, each of one mineral or the other, and a speckle.
  float nm = cellsAcross(uMinerals.x);
  Block m = nearestBlock(uv * nm, nm, uSeed + 21.0, 0.45);
  vec2 mh = tileHash(m.cell, nm, uSeed + 25.0) * 0.5 + 0.5;
  float second = step(mh.x, uMinerals.y);
  float factor = mix(1.0, uMinerals.z, second) * (1.0 + uMinerals.w * (2.0 * mh.y - 1.0));

  // Weathering: each block its own shade, crests worn lighter, hollows,
  // cracks and pits holding dirt and shade.
  factor *= 1.0 + 0.12 * own.y;
  factor *= 0.75 + 0.5 * smoothstep(0.15, 0.65, ridged);
  factor *= 1.0 - 0.6 * crack;
  factor *= 1.0 - 0.45 * pit;

  gl_FragColor = vec4(height, factor, second, 1.0);
}
