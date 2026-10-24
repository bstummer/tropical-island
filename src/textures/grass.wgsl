// The grass's base (textures/green.js): short tropical grass seen from
// straight above, a tile uTile metres across. Tufts, their blades radiating
// from a crown and leaning out, more and larger where the ground is lush;
// single blades lying about between them; the sward's dark depths in the
// gaps. A few tufts are old and gone to straw. rgb: the colour's factor, a
// quarter of it: each blade lit on one half and shaded toward its crown and
// its base, by its tone from fresh green to straw; the depths' between them.
// a: how much the blades cover. Each is a plain average of what a texel
// shows, so the mipmaps keep the grass's colour at every distance.

#include "chunks/fullscreen.wgsl"
#include "chunks/pi.wgsl"
#include "tileable.wgsl"

struct Grass {
  uTile: f32, // m
  uTexels: f32, // across the tile
  uSeed: vec2f,
  uShift: vec2f, // tiles: shifted by whole ones, the texture is the same (fixtures/surfaces.js checks)
  uStraw: vec3f, // a dry blade's colour factor
  uDepths: f32, // the depths' between the blades
}

@group(1) @binding(0) var<uniform> grass: Grass;

// A grid of cells about `size` metres that repeats over the tile: its cell count.
fn cellsAcross(size: f32) -> f32 {
  return max(1.0, floor(grass.uTile / size + 0.5));
}

// A hash of whole numbers (pcg2d, Jarzynski and Olano 2020). Its bits are the
// same on every GPU, so the many numbers a blade draws from one hash don't
// drift apart between them as stretched float hashes would.
fn pcg2d(vIn: vec2u) -> vec2u {
  var v = vIn;
  v = v * 1664525u + 1013904223u;
  v.x += v.y * 1664525u;
  v.y += v.x * 1664525u;
  v ^= v >> vec2u(16u);
  v.x += v.y * 1664525u;
  v.y += v.x * 1664525u;
  v ^= v >> vec2u(16u);
  return v;
}

// A cell's hash, the same for every repeat of the cell (n cells across the
// tile); each salt draws a different one.
fn cellHash(cell: vec2f, n: f32, salt: u32) -> vec2u {
  let c = vec2u(cell - n * floor((cell + 0.5) / n)); // the half keeps the division off whole numbers
  return pcg2d(c + bitcast<vec2u>(grass.uSeed) + salt * vec2u(0x9e3779b9u, 0x85ebca6bu));
}

// Two numbers in [0, 1) from 32 bits, sixteen each. fract(16 x) and
// fract(256 x) draw two more from x's low bits.
fn halves(bits: u32) -> vec2f {
  return vec2f(f32(bits & 65535u), f32(bits >> 16u)) / 65536.0;
}

var<private> texel: f32; // m, set in fragmentMain()

// What the blades over a texel add up to. Each leaves a share of it bare;
// height, tone and brightness are weighted steeply toward the highest, so the
// blade on top shows and its anti-aliased edge blends into what lies under it.
struct Cover {
  sum: vec3f, // height, tone, brightness, weighted
  weight: f32,
  bare: f32,
}

fn add(c: ptr<function, Cover>, alpha: f32, height: f32, tone: f32, bright: f32) {
  let w = alpha * exp(40.0 * (min(height, 1.0) - 1.0)); // off a blade (alpha 0) its height runs on, and 0 * inf would be NaN
  (*c).sum += w * vec3f(height, tone, bright);
  (*c).weight += w;
  (*c).bare *= 1.0 - alpha;
}

// A blade, `d` metres from its midrib and `s` along it (base 0, tip 1):
// narrow at the base, halfWidth from a quarter of the way up until it narrows
// to a point over its last part. A folded leaf: the half on `side` lighter,
// the other in shade, its edges darker.
fn blade(c: ptr<function, Cover>, d: f32, s: f32, halfWidth: f32, height: f32, tone: f32, bright: f32, side: f32) {
  let taper = clamp((1.0 - s) * 2.86, 0.0, 1.0);
  let w = halfWidth * taper * (2.0 - taper) * min(1.0, 0.25 + 3.0 * s);
  let alpha = clamp((w - abs(d)) / texel + 0.5, 0.0, 1.0) * step(0.0, s) * step(s, 1.0);
  let across = d / max(w, 0.5 * texel);
  let fold = clamp(2.86 * side * across, -1.0, 1.0);
  add(c, alpha, height, tone, bright + 0.1 * fold - 0.12 * min(1.0, across * across));
}

// Single blades lying about, one from each cell about 12 cm across: from
// anywhere in it, any way, at most half a cell long, so the two by two cells
// nearest a texel hold every one that reaches it. Low, flat, many of them dead.
fn lying(c: ptr<function, Cover>, uv: vec2f) {
  let n = cellsAcross(0.12);
  let cell = grass.uTile / n; // m
  let p = uv * n;
  let corner = floor(p - 0.5);
  for (var j = 0; j < 2; j++) {
    for (var i = 0; i < 2; i++) {
      let id = corner + vec2f(f32(i), f32(j));
      let hash = cellHash(id, n, 7u);
      let a = halves(hash.x); // its base
      let b = halves(hash.y); // length and bend; direction and tone
      let v = (p - id - a) * cell; // m from its base
      let len = cell * (0.25 + 0.2 * b.x);
      let dir = vec2f(cos(2.0 * PI * b.y), sin(2.0 * PI * b.y));
      let s = dot(v, dir) / len;
      let d = dot(v, vec2f(-dir.y, dir.x)) - 0.2 * (fract(16.0 * b.x) - 0.5) * len * s * s; // bent a little
      let dry = fract(16.0 * b.y);
      let tone = select(0.1 + 0.3 * dry, 0.65 + dry, dry < 0.3);
      let halfWidth = (0.7 + 0.8 * fract(16.0 * a.x)) * 1e-3;
      blade(c, d, s, halfWidth, (0.05 + 0.1 * b.x) * (0.8 + 0.2 * s), tone, 0.75 + 0.15 * fract(16.0 * a.y), select(1.0, -1.0, fract(256.0 * b.y) < 0.5));
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
fn tuft(c: ptr<function, Cover>, id: vec2f, p: vec2f, n: f32, cell: f32, fade: f32) {
  let hash = cellHash(id, n, 1u);
  let at = id + 0.2 + 0.6 * halves(hash.x); // the crown, in cells
  let a = halves(hash.y); // size, how likely the cell has a tuft, old; lean
  let lush = min(tileNoise(at / n * 2.0, 2.0, grass.uSeed + 4.7), 0.5); // beyond, every cell has a large tuft anyway
  if (fract(16.0 * a.x) > 1.2 + 0.8 * lush) {
    return;
  }
  let size = clamp(0.4 + 0.8 * a.x + 0.6 * lush, 0.0, 1.0);
  let reach = mix(0.4, 0.95, size) * cell;
  var q = (p - at) * cell; // m from the crown
  if (dot(q, q) > 2.4 * reach * reach) {
    return;
  }
  let b = 2.0 * PI * halves(pcg2d(hash).x); // its waves' and its lean's directions
  // Its blades wave, each tuft its own way, by at most a tenth of its reach.
  let across = vec2f(cos(b.x), sin(b.x));
  q += 0.1 * reach * sin(vec2f(dot(q, across), dot(q, vec2f(-across.y, across.x))) * 5.0 / reach + b);
  // It leans: its blades up to 40% longer on one side, and shorter on the other.
  let lean = 0.4 * a.y * vec2f(cos(b.y), sin(b.y));
  let dryShare = select(0.04, 0.5, fract(256.0 * a.x) < 0.12); // an old tuft is half straw
  let top = 0.7 + 0.3 * size;
  let count = floor(reach * 800.0) + 6.0; // blades in a ring
  let sector = 2.0 * PI / count;
  for (var l = 0; l < 3; l++) {
    let ring = f32(l) / 2.0; // 0 inside to 1 at the rim
    // Each ring around its own point, set at its own angle, curling its own way.
    let rp = halves(pcg2d(hash + u32(l + 1)).x);
    let o = q - 0.2 * (1.0 - ring) * reach * (2.0 * rp - 1.0);
    let r = length(o);
    let swirl = 0.4 * (fract(16.0 * rp.x) - 0.5) * r * r / (reach * reach);
    let along = (atan2(o.y, o.x) - swirl) / sector - fract(16.0 * rp.y);
    let k = floor(along);
    let bh = pcg2d(vec2u(u32(k - count * floor((k + 0.5) / count)), u32(l)) + hash);
    let u = halves(bh.x); // angle, missing; length, bend
    let v = halves(bh.y); // dry, tone, burnt tip; width, brightness, side
    let s = r / ((0.5 + 0.5 * ring) * reach * (1.0 + dot(o, lean) / max(r, 1e-6)) * (0.6 + 0.4 * u.y));
    // Off the sector's middle by up to 0.06 of it at the base and 0.1 more
    // by the tip, and at most 0.34 either side: each blade stays in its sector.
    let d = r * sector * (fract(along) - 0.5 - 0.12 * (u.x - 0.5) - 0.2 * (fract(16.0 * u.y) - 0.5) * s * s);
    let halfWidth = min((1.0 + v.y) * 1e-3, 0.34 * sector * r) * step(fract(256.0 * u.x), 0.9) * fade; // a few missing
    var tone = select(0.05 + 0.2 * fract(16.0 * v.x), 0.7 + 0.3 * fract(16.0 * v.x), v.x < dryShare + 0.08 * ring); // outer blades die first
    tone = mix(tone, 0.75, step(0.85, fract(256.0 * v.x)) * clamp(4.0 * s - 3.0, 0.0, 1.0)); // burnt tips
    let height = top * (1.0 - 0.2 * ring) * (0.3 + 0.7 * s);
    let bright = (0.74 + 0.12 * fract(16.0 * v.y)) * (0.65 + 0.35 * min(1.0, 2.0 * s));
    blade(c, d, s, halfWidth, height, tone, bright, select(1.0, -1.0, fract(256.0 * v.y) < 0.5));
  }
}

// The tuft packed in `key` (see tufts()), if it reaches the texel.
fn tuftAt(c: ptr<function, Cover>, key: f32, corner: vec2f, p: vec2f, n: f32, cell: f32, fade: f32) {
  if (key >= 1024.0f * 16.0f) {
    return;
  }
  let which = key - 16.0 * floor((key + 0.5) / 16.0);
  let row = floor((which + 0.5) / 4.0);
  tuft(c, corner + vec2f(which - 4.0 * row, row), p, n, cell, fade);
}

// The three tufts that reach furthest over the texel; a fourth would reach it
// with the tips of its outer blades at most. Where the fourth nearly ties with
// the third, the third's blades thin out, so neither is cut off where they
// swap. Each cell's order (how far out the texel lies, of the furthest its
// tuft could reach) is packed with the cell, so a few min and max sort them.
fn tufts(c: ptr<function, Cover>, uv: vec2f) {
  let n = cellsAcross(0.07);
  let cell = grass.uTile / n; // m
  let p = uv * n;
  let corner = floor(p - 0.5) - 1.0;
  var nearest = vec4f(1e6);
  for (var j = 0; j < 4; j++) {
    for (var i = 0; i < 4; i++) {
      let id = corner + vec2f(f32(i), f32(j));
      let hash = cellHash(id, n, 1u);
      let most = min(1.0, 0.7 + 0.8 * halves(hash.y).x); // the largest size tuft() can give it
      let order = length(p - id - 0.2 - 0.6 * halves(hash.x)) / (1.55 * mix(0.4, 0.95, most));
      var key = floor(min(order, 2.0) * 1024.0) * 16.0 + f32(4 * j + i);
      var lo = min(nearest.x, key);
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
  let orders = floor(nearest.zw / 16.0) / 1024.0;
  let fade = clamp(8.0 * (orders.y - orders.x), 0.0, 1.0);
  for (var k = 0; k < 3; k++) {
    tuftAt(c, select(select(nearest.z, nearest.y, k == 1), nearest.x, k == 0), corner, p, n, cell, select(1.0, fade, k == 2));
  }
}

@fragment
fn fragmentMain(in: Fullscreen) -> @location(0) vec4f {
  var uv = in.vUv + grass.uShift;
  texel = grass.uTile / grass.uTexels;
  // Blades bend with a slow warp of the ground under them, neighbours alike,
  // the way wind and feet lay them.
  let nw = cellsAcross(0.15);
  uv += 0.012 / grass.uTile * vec2f(tileNoise(uv * nw, nw, grass.uSeed + 21.0), tileNoise(uv * nw, nw, grass.uSeed + 23.0));
  var c = Cover(vec3f(0.0), 0.0, 1.0);
  lying(&c, uv);
  tufts(&c, uv);
  let cover = 1.0 - c.bare;
  let top = select(vec3f(0.0, 0.0, 0.5), c.sum / c.weight, c.weight > 0.0); // height, tone, brightness
  let blade = mix(vec3f(1.0), grass.uStraw, smoothstep(0.45, 0.85, top.y)) * (0.4 + 0.8 * top.z) * (0.55 + 0.45 * top.x);
  return vec4f(mix(vec3f(grass.uDepths), blade, cover) / 4.0, cover);
}
