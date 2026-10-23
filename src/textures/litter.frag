// Leaf litter (textures/litter.js): a tile uTile metres across of the floor
// of a palm grove or the jungle, seen from above. Leaves lie in random order,
// the topmost seen: small and middling ones, lanceolate, elliptic or round,
// now and then a big one, a coconut palm's leaflet, long, narrow and folded,
// or a twig. Each is curled a little, cupped or bent, its edge drooping or
// curling up, with a midrib and faint side veins; some have bites out of the
// margin or holes. Soil shows between them. r, g: the normal's x and y
// (tangent space, z up), flat on soil; b: the tone, 0 light to 1 dark, mostly
// the leaf's own, so a palette shifts the balance between leaves, darker on
// the veins, at the edges and beside a leaf lying on it (0.5 on soil); a: how
// much of it is covered.
//
// It is made at every load, also by a software renderer (SwiftShader, in CI),
// which runs both sides of every branch and pays for branching on top: so
// leaves are worked out without branches, only those that can reach the
// point in full, and the loop keeps little: the top leaf's cell, worked out
// again in full after it.

#include "tileable.glsl"

#ifndef PI
#define PI 3.14159265358979
#endif

uniform float uTile; // m
uniform float uTexels; // across the tile
uniform vec2 uSeed;
uniform vec2 uShift; // tiles: shifted by whole ones, the texture is the same (fixtures/surfaces.js checks)

varying vec2 vUv;

const float BROAD = 0.0;
const float LEAFLET = 1.0;
const float TWIG = 2.0;
const float SHADE = 0.008; // m: how far beyond its edge a leaf shades the one it lies on

// Three grids of cells with a leaf in some: the cell (m); how far a leaf's
// middle strays from its cell's, of a cell; the share of cells with a leaf,
// and of them, leaflets and twigs. The first is searched 3x3 about the
// point, so its leaves, with their shade, may reach 1.35 cells from their
// cells' middles; the others 2x2, reaching 0.75.
const vec4 GRIDS[3] = vec4[3](vec4(0.0556, 0.15, 1.0, 0.0), vec4(0.133, 0.25, 1.0, 0.0), vec4(0.375, 0.25, 1.0, 0.3));
const float TWIGS_SHARE = 0.15; // of the third's
// Their broad leaves: the shortest and longest (m); the narrowest and widest,
// half the width of half the length.
const vec4 BROADS[3] = vec4[3](vec4(0.04, 0.137, 0.25, 0.7), vec4(0.08, 0.185, 0.25, 0.7), vec4(0.18, 0.3, 0.3, 0.6));
// Leaflets and twigs, the same.
const vec4 LEAFLETS = vec4(0.3, 0.535, 0.045, 0.06);
const vec4 TWIGS = vec4(0.12, 0.45, 0.012, 0.022);

// A grid of cells at least `size` metres that repeats over the tile: its cell
// count, rounded down so no leaf reaches past the cells searched.
float cellsAcross(float size) {
  return max(1.0, floor(uTile / size + 1e-3));
}

// A cell's leaf, from the first of its random numbers, g (its kind or none,
// and length): its kind as weights, 1 for the one it is (leaflet, twig); its
// sizes (the shortest and longest, the narrowest and widest: BROADS).
vec4 sizes(vec2 g, vec2 kinds, vec4 broad, vec4 toLeaflet, vec4 toTwig, out vec2 kind) {
  kind.x = 1.0 - step(kinds.x, g.x);
  kind.y = 1.0 - step(kinds.y, g.x) - kind.x;
  return broad + kind.x * toLeaflet + kind.y * toTwig;
}

// Where the point p is from the middle of the leaf of cell c (both in cells),
// in metres: the middle strays from the cell's by grid.y.
vec2 fromMiddle(vec2 p, vec2 c, vec2 g, vec4 grid) {
  vec2 h = fract(g.yx * vec2(13.7, 7.3) + g * vec2(5.1, 9.7));
  return (p - c - 0.5 - grid.y * (2.0 * h - 1.0)) * grid.x;
}

// The leaf of cell c of a grid, seen from p (both in cells; c wrapped into
// the tile: wrapped): how far outside it the point is (m; far for an empty
// cell). grid: the cell (m), how far a leaf's middle strays, the grid's seed,
// the share of cells with a leaf; kinds: the shares with a leaflet, and with
// a leaflet or a twig; broad, toLeaflet, toTwig: its broad leaves' sizes
// (BROADS), and the steps to leaflets' and twigs'. pile: its place in the
// pile, and its tone. frame: the point in its frame (from its middle towards
// its tip, and across, m) and its axis in the tile; size: half its length and
// width (m), its kind.
float leaf(vec2 p, vec2 c, vec2 wrapped, vec4 grid, vec2 kinds, vec4 broad, vec4 toLeaflet, vec4 toTwig, out vec2 pile, out vec4 frame, out vec3 size) {
  // Its random numbers: tileHash's (the cell is wrapped already); and more
  // from their lower bits.
  vec2 id = wrapped + uSeed + grid.z;
  vec2 g = noiseHash22(id) * 0.5 + 0.5;
  pile = noiseHash22(id + 7.9) * 0.5 + 0.5;
  vec2 a = fract(pile * vec2(11.9, 17.3) + g.yx * vec2(3.3, 6.9)); // direction, width
  vec2 b = fract(a.yx * vec2(13.7, 7.3) + pile.yx * 5.1); // outline, bend

  vec2 kind;
  vec4 dims = sizes(g, kinds, broad, toLeaflet, toTwig, kind);
  float plain = 1.0 - kind.x - kind.y;
  float halfLength = 0.5 * mix(dims.x, dims.y, g.y);
  float halfWidth = halfLength * mix(dims.z, dims.w, a.y);
  // Its outline: half its width along it, from u = -1 at the base to 1 at
  // the tip, sqrt(1 - v^2) (an ellipse) drawn out towards points by
  // pointedness; v puts the widest point at u = -skew. Straightness cuts it
  // off into parallel sides: leaflets', twigs'.
  float skew = mix(-0.2, 0.45, b.x) * plain + 0.35 * kind.x;
  float pointed = fract(3.7 * b.x) * plain + 0.8 * kind.x;
  float straight = 1.0 + 0.6 * kind.x + 4.0 * kind.y;

  vec2 off = fromMiddle(p, c, g, grid);
  float angle = 2.0 * PI * a.x;
  vec2 axis = vec2(cos(angle), sin(angle));
  vec2 at = vec2(dot(off, axis), dot(off, vec2(-axis.y, axis.x)));
  float u = at.x / halfLength;
  at.y -= (0.12 + 0.18 * (1.0 - plain)) * (b.y - 0.5) * at.x * u; // the midrib bends
  u = clamp(u, -1.0, 1.0);
  float v = (u + skew) / (1.0 + skew * u);
  float q = max(1.0 - v * v, 0.0);
  float w = halfWidth * min(1.0, straight * sqrt(q) * mix(1.0, q, pointed));
  w *= 1.0 + 0.3 * (fract(5.3 * b.y) - 0.5) * sign(at.y) * plain; // one half wider

  frame = vec4(at, axis);
  size = vec3(halfLength, halfWidth, kind.x * LEAFLET + kind.y * TWIG);
  // Leaflets and twigs lie higher in the pile, as narrow things would mostly
  // be hidden; twigs are dark; big leaves keep to middling tones, as they
  // would stand out where the tile repeats.
  pile.x = mix(pile.x, 0.3 + 0.7 * pile.x, 1.0 - plain);
  pile.y = mix(mix(pile.y, 0.5, 0.4 * smoothstep(0.08, 0.13, halfLength)), 0.55 + 0.4 * pile.y, kind.y);
  // Ties in the pile, broken by the tone: else which leaf lies on top could
  // change from cell to cell.
  pile.x += pile.y / 1024.0;
  // Across it: near enough to the distance along the sides, where it matters.
  return max(abs(at.y) - w, abs(at.x) - halfLength) + step(grid.w, g.x);
}

void main() {
  vec2 uv = vUv + uShift;
  float texel = uTile / uTexels;
  // The topmost leaf at the point: its place in the pile (-1: none), how much
  // of the texel it covers, its cell; its grid and tone.
  vec4 top = vec4(-1.0, 0.0, 0.0, 0.0);
  vec2 topGrid = vec2(0.0, 0.5);
  // The one below it: its place, how much it covers, its tone.
  vec3 below = vec3(-1.0, 0.0, 0.5);
  // The highest leaf whose edge is near the point, or that covers it: its
  // place in the pile and how near.
  vec2 near = vec2(-1.0, 0.0);
  vec2 pile;
  vec4 frame;
  vec3 size;

  // 0, though the compiler can't tell: Direct3D's would unroll the loops,
  // and take seconds over them.
  int none = int(min(uTile, 0.0));
  for (int s = 0; s < 3 + none; s++) {
    vec4 grid = GRIDS[s];
    vec4 broad = BROADS[s];
    float n = cellsAcross(grid.x);
    vec4 cell = vec4(uTile / n, grid.y, 37.0 * float(s), grid.z);
    vec2 kinds = vec2(grid.w, grid.w + (s == 2 ? TWIGS_SHARE : 0.0));
    vec4 toLeaflet = LEAFLETS - broad;
    vec4 toTwig = TWIGS - broad;
    vec2 p = uv * n;
    // The cells searched: 3x3 about the point's, or the 2x2 nearest it.
    int span = s == 0 ? 3 : 2;
    vec2 first = floor(p) - (s == 0 ? vec2(1.0) : step(fract(p), vec2(0.5)));
    vec2 wrapped = mod(first, n);
    // The cells whose leaves can reach the point, by a circle about each a
    // little over half its length, and its shade: packed four bits each, x +
    // 4y. Only those are worked out in full, by a loop that ends when they do,
    // which a software renderer skips too. Eight fit; of 9 cells, about 3 hold
    // the point, and more than 7 none in a million texels.
    uint list = 0u;
    int count = 0;
    for (int j = 0; j < span + none; j++) {
      for (int i = 0; i < span + none; i++) {
        vec2 o = vec2(float(i), float(j));
        vec2 w = wrapped + o;
        vec2 g = noiseHash22(w - n * step(n, w) + uSeed + cell.z) * 0.5 + 0.5;
        vec2 kind;
        vec4 dims = sizes(g, kinds, broad, toLeaflet, toTwig, kind);
        float r = 0.51 * mix(dims.x, dims.y, g.y) + SHADE;
        vec2 off = fromMiddle(p, first + o, g, cell);
        uint hit = uint(all(bvec2(dot(off, off) < r * r, g.x < cell.w)));
        list = list * (1u + 15u * hit) + hit * uint(i + 4 * j);
        count += int(hit);
      }
    }
    for (int k = 0; k < count; k++) {
      vec2 o = vec2(float(list & 3u), float((list >> 2u) & 3u));
      list >>= 4u;
      vec2 w = wrapped + o;
      float d = leaf(p, first + o, w - n * step(n, w), cell, kinds, broad, toLeaflet, toTwig, pile, frame, size);
      float alpha = clamp(0.5 - d / texel, 0.0, 1.0);
      // The topmost two, and the highest near: picked by weights, 1 or 0, as
      // && and ?: would branch.
      float covers = step(1e-6, alpha);
      float onTop = covers * step(top.x, pile.x);
      float second = covers * (1.0 - onTop) * step(below.x, pile.x);
      below = mix(mix(below, vec3(pile.x, alpha, pile.y), second), vec3(top.xy, topGrid.y), onTop);
      top = mix(top, vec4(pile.x, alpha, first + o), onTop);
      topGrid = mix(topGrid, vec2(float(s), pile.y), onTop);
      near = mix(near, vec2(pile.x, 1.0 - max(d, 0.0) / SHADE), step(d, SHADE) * step(near.x, pile.x));
    }
  }

  // The top leaf again, in full.
  int s = int(topGrid.x + 0.5);
  vec4 grid = GRIDS[s];
  vec4 broad = BROADS[s];
  float n = cellsAcross(grid.x);
  vec4 cell = vec4(uTile / n, grid.y, 37.0 * float(s), grid.z);
  vec2 kinds = vec2(grid.w, grid.w + (s == 2 ? TWIGS_SHARE : 0.0));
  float inside = -leaf(uv * n, top.zw, mod(top.zw, n), cell, kinds, broad, LEAFLETS - broad, TWIGS - broad, pile, frame, size);

  // Its own random numbers, keyed by its place in the pile and tone.
  vec2 key = pile * 1013.0;
  vec4 r = vec4(noiseHash22(key + 1.3), noiseHash22(key + 2.9)); // cupped, bent, twisted; tilted
  vec4 e = vec4(noiseHash22(key + 4.7), noiseHash22(key + 6.1)) * 0.5 + 0.5; // bites, holes
  vec2 x = noiseHash22(key + 8.3); // midrib, edge
  vec2 at = frame.xy;
  float plain = size.z == BROAD ? 1.0 : 0.0;
  // Blotches a centimetre or two across: (value, slope).
  vec3 blotch = gradientNoiseD(at / 0.015 + key);

  // Bites out of the margin along a stretch of one side, as ragged as the
  // blotches; and holes where the blotches run darkest: eaten by insects.
  float stretch = (at.x / size.x - mix(-0.5, 0.5, e.y)) / mix(0.2, 0.5, e.z);
  float bitten = plain * step(e.x, 0.3) * step(0.0, at.y * (e.z - 0.5)) * max(1.0 - stretch * stretch, 0.0);
  inside -= bitten * 1.2 * min(0.6 * size.y, 0.008) * smoothstep(-0.4, 0.4, blotch.x);
  float holed = plain * step(0.88, e.x);
  inside = min(inside, mix(1.0, (0.45 - blotch.x) * 0.015 / max(length(blotch.yz), 0.3), holed));
  float alpha = top.y * clamp(0.5 + inside / texel, 0.0, 1.0);

  // Its surface: the slope of its height (m per m, in its frame), and its tone.
  vec2 own = 0.15 * r.zw; // lying a little tilted on what is under it
  float tone = pile.y;
  if (size.z == TWIG) {
    float q = clamp(at.y / size.y, -0.9, 0.9);
    own.y -= q / sqrt(1.0 - q * q);
  } else {
    float band = max(0.003, 1.5 * texel);
    float rim = 1.0 - clamp(inside / band, 0.0, 1.0);
    // Cupped across (some rolled), bent along, a touch twisted.
    float cup = mix(0.15 * r.x, mix(-0.3, 0.9, r.x * 0.5 + 0.5) * (fract(9.1 * r.x) > 0.85 ? 1.7 : 1.0), plain);
    own.y += cup * at.y / size.y;
    own.x += 0.25 * r.y * at.x / size.x;
    own += 0.15 * r.z * at.yx / size.x;
    // Its edge droops or curls up, and is darker. The outward direction: an ellipse's.
    vec2 outward = at / (size.xy * size.xy);
    own += outward * inversesqrt(max(dot(outward, outward), 1e-6)) * mix(-0.6, 0.4, x.y * 0.5 + 0.5) * rim;
    tone += 0.05 * rim + 0.06 * blotch.x;
    if (size.z == LEAFLET) {
      // Folded along the midrib.
      own.y += sign(x.x) * mix(0.2, 0.5, abs(x.x)) * clamp(at.y / (1.5 * texel), -1.0, 1.0);
      tone += 0.04 * (1.0 - smoothstep(0.0, 2.0 * texel, abs(at.y)));
    } else {
      // The midrib, a ridge or a groove, thinning to the tip.
      float u = 0.5 + 0.5 * at.x / size.x;
      float rib = max(0.05 * size.y * (1.0 - 0.6 * u), 1.5 * texel);
      float q = at.y / rib;
      float e = max(1.0 - q * q, 0.0);
      own.y -= 0.6 * x.x * q * e;
      tone += 0.04 * e * e;
      // Side veins running out towards the tip; gone where they would crowd the texels.
      float spacing = 0.2 * size.x;
      float phase = (at.x - 0.9 * abs(at.y) + 0.3 * at.y * at.y / size.y) / spacing;
      float vein = 1.0 - smoothstep(0.0, max(0.0008, texel), abs(fract(phase + 0.5) - 0.5) * spacing);
      vein *= smoothstep(3.0 * texel, 6.0 * texel, spacing) * smoothstep(rib, 2.0 * rib, abs(at.y));
      tone += 0.025 * vein;
      // Drier towards the tip.
      tone += 0.04 * u * u;
    }
  }
  // Darker beside the edge of a leaf lying on it; the leaf below shows only
  // beside the top one's edge or through its holes, in its shade.
  float shade = 0.08;
  // (Places in the pile went through mix(), which may round them by a hair:
  // the top leaf itself is not to shade itself.)
  tone += near.x > top.x + 1e-4 ? shade * near.y * near.y : 0.0;

  // The top leaf over the one below over the soil.
  float cover = alpha + (1.0 - alpha) * below.y;
  vec2 slope = alpha * (frame.zw * own.x + vec2(-frame.w, frame.z) * own.y);
  tone = alpha * clamp(tone, 0.0, 1.0) + (1.0 - alpha) * below.y * min(below.z + shade, 1.0) + (1.0 - cover) * 0.5;
  vec3 normal = normalize(vec3(-slope, 1.0));
  gl_FragColor = vec4(normal.xy * 0.5 + 0.5, tone, cover);
}
