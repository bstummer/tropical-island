// Half floats for 16-bit float textures, as three.js's DataUtils converts them
// (see index.js): a number is rounded to a 32-bit float, then cut down to a
// half float, its lowest bits dropped rather than rounded. Math.f16round and
// Float16Array round to nearest instead, which moves texels.

const MAX = 65504; // the largest half float

const word = new ArrayBuffer(4);
const asFloat = new Float32Array(word);
const asBits = new Uint32Array(word);

// By a 32-bit float's sign and exponent: the half float's bits for it, and how
// far its mantissa shifts to fill them.
const base = new Uint32Array(512);
const shift = new Uint32Array(512);
for (let i = 0; i < 256; i++) {
  const e = i - 127;
  let [b, s] = [0x7c00, 13]; // infinity and NaN keep their mantissa's top
  if (e < -27) [b, s] = [0, 24]; // too small: zero
  else if (e < -14) [b, s] = [0x0400 >> (-e - 14), -e - 1]; // subnormal
  else if (e <= 15) [b, s] = [(e + 15) << 10, 13];
  else if (e < 128) [b, s] = [0x7c00, 24]; // too large: infinity
  base[i] = b;
  base[i | 0x100] = b | 0x8000;
  shift[i] = shift[i | 0x100] = s;
}

// A half float's bits for `value`, clamped to the range.
export function toHalfFloat(value) {
  if (Math.abs(value) > MAX) console.warn(`toHalfFloat: ${value} is out of range`);
  asFloat[0] = Math.max(-MAX, Math.min(MAX, value));
  const f = asBits[0];
  const e = (f >> 23) & 0x1ff;
  return base[e] + ((f & 0x007fffff) >> shift[e]);
}

// The other way, by a half float's sign and exponent: the 32-bit float's
// exponent bits, and where its mantissa's bits start in `mantissa` (a
// subnormal half float's normalized; a NaN keeps its payload).
const mantissa = new Uint32Array(2048);
const exponent = new Uint32Array(64);
const offset = new Uint32Array(64);
for (let i = 1; i < 1024; i++) {
  let [m, e] = [i << 13, 0];
  while ((m & 0x00800000) === 0) [m, e] = [m << 1, e - 0x00800000];
  mantissa[i] = (m & ~0x00800000) | (e + 0x38800000);
}
for (let i = 1024; i < 2048; i++) mantissa[i] = 0x38000000 + ((i - 1024) << 13);
for (let i = 1; i < 31; i++) exponent[i] = i << 23;
exponent[31] = 0x47800000;
exponent[32] = 0x80000000;
for (let i = 33; i < 63; i++) exponent[i] = 0x80000000 + ((i - 32) << 23);
exponent[63] = 0xc7800000;
for (let i = 1; i < 64; i++) if (i !== 32) offset[i] = 1024;

// The number a half float's bits hold (exactly).
export function fromHalfFloat(bits) {
  const e = bits >> 10;
  asBits[0] = mantissa[offset[e] + (bits & 0x3ff)] + exponent[e];
  return asFloat[0];
}
