// Seeded 2D gradient noise for the island's shape (world/island.js), and a
// hash for things scattered one per cell of a grid. JS only: the GPU gets the
// island as a heightmap and never evaluates this. Pure and Node-importable.

// Sixteen unit gradients, evenly around the circle.
const GX = new Float64Array(16);
const GY = new Float64Array(16);
for (let i = 0; i < 16; i++) {
  GX[i] = Math.cos((i * Math.PI) / 8);
  GY[i] = Math.sin((i * Math.PI) / 8);
}

// Gradient noise in about [-1, 1], zero at integer points, from an rng stream
// (core/random.js): the stream shuffles the lattice.
export function createNoise(r) {
  const perm = new Uint8Array(512);
  for (let i = 0; i < 256; i++) perm[i] = i;
  for (let i = 255; i > 0; i--) {
    const j = r.int(0, i);
    const t = perm[i];
    perm[i] = perm[j];
    perm[j] = t;
  }
  for (let i = 0; i < 256; i++) perm[i + 256] = perm[i];

  return function noise(x, y) {
    const fx = Math.floor(x);
    const fy = Math.floor(y);
    const ix = fx & 255;
    const iy = fy & 255;
    x -= fx;
    y -= fy;
    const a = perm[ix] + iy;
    const b = perm[ix + 1] + iy;
    const g00 = perm[a] & 15;
    const g10 = perm[b] & 15;
    const g01 = perm[a + 1] & 15;
    const g11 = perm[b + 1] & 15;
    const n00 = GX[g00] * x + GY[g00] * y;
    const n10 = GX[g10] * (x - 1) + GY[g10] * y;
    const n01 = GX[g01] * x + GY[g01] * (y - 1);
    const n11 = GX[g11] * (x - 1) + GY[g11] * (y - 1);
    const u = x * x * x * (x * (x * 6 - 15) + 10);
    const v = y * y * y * (y * (y * 6 - 15) + 10);
    const nx0 = n00 + u * (n10 - n00);
    const nx1 = n01 + u * (n11 - n01);
    return 1.4 * (nx0 + v * (nx1 - nx0));
  };
}

// Octaves of noise at x, y, each twice the frequency and half the amplitude of
// the last, turned against each other so their lattices don't line up. About
// [-1, 1].
export function fbm(noise, x, y, octaves) {
  let sum = 0;
  let amplitude = 1;
  let total = 0;
  for (let i = 0; i < octaves; i++) {
    sum += amplitude * noise(x, y);
    total += amplitude;
    amplitude *= 0.5;
    const nx = 1.6 * x - 1.2 * y + 17.3;
    y = 1.2 * x + 1.6 * y - 9.1;
    x = nx;
  }
  return sum / total;
}

// A float in [0, 1) from two integers and a seed, each mixed in in turn by
// murmur3's finaliser, so neighbouring cells and consecutive seeds (one per
// property of a thing in a cell) come out independent.
export function cellHash(i, j, seed) {
  return (fmix(fmix(fmix(seed) ^ i) ^ j) >>> 0) / 4294967296;
}

// murmur3's 32-bit finaliser: a bijection that spreads every bit into every other.
function fmix(h) {
  h ^= h >>> 16;
  h = Math.imul(h, 0x85ebca6b);
  h ^= h >>> 13;
  h = Math.imul(h, 0xc2b2ae35);
  return h ^ (h >>> 16);
}
