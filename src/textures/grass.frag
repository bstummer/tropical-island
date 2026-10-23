// The grass's base (textures/green.js): short tropical grass seen from
// straight above, a tile uTile metres across. Tufts, their blades radiating
// from a crown and leaning out, more and larger where the ground is lush;
// single blades lying about between them; bare ground in the gaps. A few
// tufts are old and gone to straw. r: coverage; g: height of the topmost
// blade, 0 on the ground, rising from each blade's base to its tip, tufts
// above lying blades; b: its tone, 0 fresh green to 1 dry straw; a: its
// brightness, a folded leaf lit on one half and shaded toward the crown, 0.5
// where bare.

#include "tileable.glsl"

#ifndef PI
#define PI 3.14159265358979
#endif

uniform float uTile; // m
uniform float uTexels; // across the tile
uniform vec2 uSeed;
uniform vec2 uShift; // tiles: shifted by whole ones, the texture is the same (fixtures/surfaces.js checks)

varying vec2 vUv;

// The tone bare ground gets: about the blades' average, so mipmaps that
// average it in keep the grass's tone.
const float BARE_TONE = 0.25;

// A grid of cells about `size` metres that repeats over the tile: its cell count.
float cellsAcross(float size) {
  return max(1.0, floor(uTile / size + 0.5));
}

// A hash of whole numbers (pcg2d, Jarzynski and Olano 2020). Its bits are the
// same on every GPU, so the many numbers a blade draws from one hash don't
// drift apart between them as stretched float hashes would.
uvec2 pcg2d(uvec2 v) {
  v = v * 1664525u + 1013904223u;
  v.x += v.y * 1664525u;
  v.y += v.x * 1664525u;
  v ^= v >> 16u;
  v.x += v.y * 1664525u;
  v.y += v.x * 1664525u;
  v ^= v >> 16u;
  return v;
}

// A cell's hash, the same for every repeat of the cell (n cells across the
// tile); each salt draws a different one.
uvec2 cellHash(vec2 cell, float n, uint salt) {
  uvec2 c = uvec2(cell - n * floor((cell + 0.5) / n)); // the half keeps the division off whole numbers
  return pcg2d(c + floatBitsToUint(uSeed) + salt * uvec2(0x9e3779b9u, 0x85ebca6bu));
}

// Two numbers in [0, 1) from 32 bits, sixteen each. fract(16 x) and
// fract(256 x) draw two more from x's low bits.
vec2 halves(uint bits) {
  return vec2(float(bits & 65535u), float(bits >> 16u)) / 65536.0;
}

float texel; // m, set in main()

// What the blades over a texel add up to. Each leaves a share of it bare;
// height, tone and brightness are weighted steeply toward the highest, so the
// blade on top shows and its anti-aliased edge blends into what lies under it.
struct Cover {
  vec3 sum; // height, tone, brightness, weighted
  float weight;
  float bare;
};

void add(inout Cover c, float alpha, float height, float tone, float bright) {
  float w = alpha * exp(40.0 * (min(height, 1.0) - 1.0)); // off a blade (alpha 0) its height runs on, and 0 * inf would be NaN
  c.sum += w * vec3(height, tone, bright);
  c.weight += w;
  c.bare *= 1.0 - alpha;
}

// A blade, `d` metres from its midrib and `s` along it (base 0, tip 1):
// narrow at the base, halfWidth from a quarter of the way up until it narrows
// to a point over its last part. A folded leaf: the half on `side` lighter,
// the other in shade, its edges darker.
void blade(inout Cover c, float d, float s, float halfWidth, float height, float tone, float bright, float side) {
  float taper = clamp((1.0 - s) * 2.86, 0.0, 1.0);
  float w = halfWidth * taper * (2.0 - taper) * min(1.0, 0.25 + 3.0 * s);
  float alpha = clamp((w - abs(d)) / texel + 0.5, 0.0, 1.0) * step(0.0, s) * step(s, 1.0);
  float across = d / max(w, 0.5 * texel);
  float fold = clamp(2.86 * side * across, -1.0, 1.0);
  add(c, alpha, height, tone, bright + 0.1 * fold - 0.12 * min(1.0, across * across));
}

// Single blades lying about, one from each cell about 12 cm across: from
// anywhere in it, any way, at most half a cell long, so the two by two cells
// nearest a texel hold every one that reaches it. Low, flat, many of them dead.
void lying(inout Cover c, vec2 uv) {
  float n = cellsAcross(0.12);
  float cell = uTile / n; // m
  vec2 p = uv * n;
  vec2 corner = floor(p - 0.5);
  for (int j = 0; j < 2; j++) {
    for (int i = 0; i < 2; i++) {
      vec2 id = corner + vec2(float(i), float(j));
      uvec2 hash = cellHash(id, n, 7u);
      vec2 a = halves(hash.x); // its base
      vec2 b = halves(hash.y); // length and bend; direction and tone
      vec2 v = (p - id - a) * cell; // m from its base
      float len = cell * (0.25 + 0.2 * b.x);
      vec2 dir = vec2(cos(2.0 * PI * b.y), sin(2.0 * PI * b.y));
      float s = dot(v, dir) / len;
      float d = dot(v, vec2(-dir.y, dir.x)) - 0.2 * (fract(16.0 * b.x) - 0.5) * len * s * s; // bent a little
      float dry = fract(16.0 * b.y);
      float tone = dry < 0.3 ? 0.65 + dry : 0.1 + 0.3 * dry;
      float halfWidth = (0.7 + 0.8 * fract(16.0 * a.x)) * 1e-3;
      blade(c, d, s, halfWidth, (0.05 + 0.1 * b.x) * (0.8 + 0.2 * s), tone, 0.75 + 0.15 * fract(16.0 * a.y), fract(256.0 * b.y) < 0.5 ? -1.0 : 1.0);
    }
  }
}

// A tuft, in most cells of about 7 cm one: its crown in the middle of the
// cell, its blades reaching out at most 1.55 times its reach and 1.5 cells,
// so the four by four cells nearest a texel hold every tuft that reaches it.
// The blades stand in three rings, short and upright inside, long and leaning
// out at the rim, each ring around a point of its own in the crown. A ring's
// blades fall in equal sectors as seen from that point, each blade within its
// own, so a texel looks up one blade a ring. `fade` thins them all.
void tuft(inout Cover c, vec2 id, vec2 p, float n, float cell, float fade) {
  uvec2 hash = cellHash(id, n, 1u);
  vec2 at = id + 0.2 + 0.6 * halves(hash.x); // the crown, in cells
  vec2 a = halves(hash.y); // size, how likely the cell has a tuft, old; lean
  float lush = min(tileNoise(at / n * 2.0, 2.0, uSeed + 4.7), 0.5); // beyond, every cell has a large tuft anyway
  if (fract(16.0 * a.x) > 1.2 + 0.8 * lush) return;
  float size = clamp(0.4 + 0.8 * a.x + 0.6 * lush, 0.0, 1.0);
  float reach = mix(0.4, 0.95, size) * cell;
  vec2 q = (p - at) * cell; // m from the crown
  if (dot(q, q) > 2.4 * reach * reach) return;
  vec2 b = 2.0 * PI * halves(pcg2d(hash).x); // its waves' and its lean's directions
  // Its blades wave, each tuft its own way, by at most a tenth of its reach.
  vec2 across = vec2(cos(b.x), sin(b.x));
  q += 0.1 * reach * sin(vec2(dot(q, across), dot(q, vec2(-across.y, across.x))) * 5.0 / reach + b);
  // It leans: its blades up to 40% longer on one side, and shorter on the other.
  vec2 lean = 0.4 * a.y * vec2(cos(b.y), sin(b.y));
  float dryShare = fract(256.0 * a.x) < 0.12 ? 0.5 : 0.04; // an old tuft is half straw
  float top = 0.7 + 0.3 * size;
  float count = floor(reach * 800.0) + 6.0; // blades in a ring
  float sector = 2.0 * PI / count;
  for (int l = 0; l < 3; l++) {
    float ring = float(l) / 2.0; // 0 inside to 1 at the rim
    // Each ring around its own point, set at its own angle, curling its own way.
    vec2 rp = halves(pcg2d(hash + uint(l + 1)).x);
    vec2 o = q - 0.2 * (1.0 - ring) * reach * (2.0 * rp - 1.0);
    float r = length(o);
    float swirl = 0.4 * (fract(16.0 * rp.x) - 0.5) * r * r / (reach * reach);
    float along = (atan(o.y, o.x) - swirl) / sector - fract(16.0 * rp.y);
    float k = floor(along);
    uvec2 bh = pcg2d(uvec2(k - count * floor((k + 0.5) / count), l) + hash);
    vec2 u = halves(bh.x); // angle, missing; length, bend
    vec2 v = halves(bh.y); // dry, tone, burnt tip; width, brightness, side
    float s = r / ((0.5 + 0.5 * ring) * reach * (1.0 + dot(o, lean) / max(r, 1e-6)) * (0.6 + 0.4 * u.y));
    // Off the sector's middle by up to 0.06 of it at the base and 0.1 more
    // by the tip, and at most 0.34 either side: each blade stays in its sector.
    float d = r * sector * (fract(along) - 0.5 - 0.12 * (u.x - 0.5) - 0.2 * (fract(16.0 * u.y) - 0.5) * s * s);
    float halfWidth = min((1.0 + v.y) * 1e-3, 0.34 * sector * r) * step(fract(256.0 * u.x), 0.9) * fade; // a few missing
    float tone = v.x < dryShare + 0.08 * ring ? 0.7 + 0.3 * fract(16.0 * v.x) : 0.05 + 0.2 * fract(16.0 * v.x); // outer blades die first
    tone = mix(tone, 0.75, step(0.85, fract(256.0 * v.x)) * clamp(4.0 * s - 3.0, 0.0, 1.0)); // burnt tips
    float height = top * (1.0 - 0.2 * ring) * (0.3 + 0.7 * s);
    float bright = (0.74 + 0.12 * fract(16.0 * v.y)) * (0.65 + 0.35 * min(1.0, 2.0 * s));
    blade(c, d, s, halfWidth, height, tone, bright, fract(256.0 * v.y) < 0.5 ? -1.0 : 1.0);
  }
}

// The tuft packed in `key` (see tufts()), if it reaches the texel.
void tuftAt(inout Cover c, float key, vec2 corner, vec2 p, float n, float cell, float fade) {
  if (key >= 1024.0 * 16.0) return;
  float which = key - 16.0 * floor((key + 0.5) / 16.0);
  float row = floor((which + 0.5) / 4.0);
  tuft(c, corner + vec2(which - 4.0 * row, row), p, n, cell, fade);
}

// The three tufts that reach furthest over the texel; a fourth would reach it
// with the tips of its outer blades at most. Where the fourth nearly ties with
// the third, the third's blades thin out, so neither is cut off where they
// swap. Each cell's order (how far out the texel lies, of the furthest its
// tuft could reach) is packed with the cell, so a few min and max sort them.
void tufts(inout Cover c, vec2 uv) {
  float n = cellsAcross(0.07);
  float cell = uTile / n; // m
  vec2 p = uv * n;
  vec2 corner = floor(p - 0.5) - 1.0;
  vec4 nearest = vec4(1e6);
  for (int j = 0; j < 4; j++) {
    for (int i = 0; i < 4; i++) {
      vec2 id = corner + vec2(float(i), float(j));
      uvec2 hash = cellHash(id, n, 1u);
      float most = min(1.0, 0.7 + 0.8 * halves(hash.y).x); // the largest size tuft() can give it
      float order = length(p - id - 0.2 - 0.6 * halves(hash.x)) / (1.55 * mix(0.4, 0.95, most));
      float key = floor(min(order, 2.0) * 1024.0) * 16.0 + float(4 * j + i);
      float lo = min(nearest.x, key);
      key = max(nearest.x, key);
      nearest.x = lo;
      lo = min(nearest.y, key);
      key = max(nearest.y, key);
      nearest.y = lo;
      lo = min(nearest.z, key);
      key = max(nearest.z, key);
      nearest.z = lo;
      nearest.w = min(nearest.w, key);
    }
  }
  vec2 orders = floor(nearest.zw / 16.0) / 1024.0;
  float fade = clamp(8.0 * (orders.y - orders.x), 0.0, 1.0);
  for (int k = 0; k < 3; k++) tuftAt(c, k == 0 ? nearest.x : (k == 1 ? nearest.y : nearest.z), corner, p, n, cell, k == 2 ? fade : 1.0);
}

void main() {
  vec2 uv = vUv + uShift;
  texel = uTile / uTexels;
  // Blades bend with a slow warp of the ground under them, neighbours alike,
  // the way wind and feet lay them.
  float nw = cellsAcross(0.15);
  uv += 0.012 / uTile * vec2(tileNoise(uv * nw, nw, uSeed + 21.0), tileNoise(uv * nw, nw, uSeed + 23.0));
  Cover c = Cover(vec3(0.0), 0.0, 1.0);
  lying(c, uv);
  tufts(c, uv);
  float cover = 1.0 - c.bare;
  vec3 top = c.weight > 0.0 ? c.sum / c.weight : vec3(0.0, BARE_TONE, 0.5);
  gl_FragColor = vec4(cover, top.x * cover, mix(BARE_TONE, top.y, cover), mix(0.5, top.z, cover));
}
