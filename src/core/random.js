// Seeded randomness. The only allowed source of random numbers in the app.
//
//   const rng = createRandom(seed);
//   const r = rng('palms');      // independent stream derived from (seed, 'palms')
//   r.next(); r.range(2, 5); r.int(0, 3); r.pick(list); r.chance(0.3); r.normal();
//
// Every stream is keyed by its name, so adding a new system (a new name) never
// shifts the numbers an existing system sees. Each rng(name) call returns a
// fresh stream from the start of that sequence: use one distinct name per
// consumer, and nest with slashes when needed ('palms/fronds').

export function createRandom(seed) {
  const base = String(seed);
  return function rng(name) {
    if (!name) throw new Error('rng(name): a stream name is required');
    return stream(sfc32(...cyrb128(`${base}\u0000${name}`)));
  };
}

function stream(next) {
  for (let i = 0; i < 15; i++) next(); // let the state mix before use
  return {
    next, // float in [0, 1)
    range: (min, max) => min + (max - min) * next(),
    int: (min, max) => min + Math.floor(next() * (max - min + 1)), // inclusive
    chance: (p) => next() < p,
    pick: (list) => list[Math.floor(next() * list.length)],
    normal(mean = 0, sd = 1) {
      const u = 1 - next(); // (0, 1], keeps log() finite
      return mean + sd * Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * next());
    },
  };
}

// sfc32: small, fast, 128-bit state. Returns floats in [0, 1).
function sfc32(a, b, c, d) {
  return function next() {
    a |= 0; b |= 0; c |= 0; d |= 0;
    const t = (((a + b) | 0) + d) | 0;
    d = (d + 1) | 0;
    a = b ^ (b >>> 9);
    b = (c + (c << 3)) | 0;
    c = (c << 21) | (c >>> 11);
    c = (c + t) | 0;
    return (t >>> 0) / 4294967296;
  };
}

// cyrb128: hashes a string into four 32-bit words to seed sfc32.
function cyrb128(str) {
  let h1 = 1779033703, h2 = 3144134277, h3 = 1013904242, h4 = 2773480762;
  for (let i = 0; i < str.length; i++) {
    const k = str.charCodeAt(i);
    h1 = h2 ^ Math.imul(h1 ^ k, 597399067);
    h2 = h3 ^ Math.imul(h2 ^ k, 2869860233);
    h3 = h4 ^ Math.imul(h3 ^ k, 951274213);
    h4 = h1 ^ Math.imul(h4 ^ k, 2716044179);
  }
  h1 = Math.imul(h3 ^ (h1 >>> 18), 597399067);
  h2 = Math.imul(h4 ^ (h2 >>> 22), 2869860233);
  h3 = Math.imul(h1 ^ (h3 >>> 17), 951274213);
  h4 = Math.imul(h2 ^ (h4 >>> 19), 2716044179);
  h1 ^= h2 ^ h3 ^ h4;
  h2 ^= h1;
  h3 ^= h1;
  h4 ^= h1;
  return [h1 >>> 0, h2 >>> 0, h3 >>> 0, h4 >>> 0];
}
