// The swell's waves that reach the reef (PLAN.md 6.6), in JS, for sound and for what
// floats on the water; water/water-surf.wgsl is its twin, which draws them. Pure: a
// function of place and time, so the same however it got there.
//
// A wave comes in from the open sea as a long low line, when water/sea-map.js says it
// gets to each place (`late`, `speed`), so its crest bends round the reef and bunches
// up over the shallows. It stands taller as it slows, and steeper, as far as the water
// lets it: what the swell's own reach (`swell`) leaves of it. What that takes from it
// breaks. So a big wave of a set breaks seaward of the crest and whitens it through; a
// small one breaks only on the crest, in lace, and the smallest not at all. What breaks
// stands up off the water as whitewater, as tall as `stands` where it breaks hardest, in
// lumps along the crest, each wave its own, heaped up in places and lower between. Behind it
// foam runs in over the flat and fades, as far as the sea map says the surf breaks
// round here (`breaks`). A wave differs along its length, each its own way.
//
// createSurf(settings, way) -> at(here, x, z, t, out): settings: config.water.surf;
// way: the world direction the swell runs ([x, z], unit); here: the sea map at x, z.
// Into out, { foam, height, slope, lean }: how much foam covers the water, 0 to 1 and more
// where it lies thick; how high the wave stands (m); how steeply it rises along the
// way it runs, as its face leans on; how far (m) its water has moved on along that way, as
// by the reef a crest's top outruns its foot. The GPU's twin also takes how wide a pixel is.
import { waveSpeed } from './sea-map.js';
import { seededNoise } from '../world/noise.js';

// The seed of a wave's lumps along its crest: LUMP_SEED + its number in the waves' loop.
const LUMP_SEED = 7867;
// The seed of the heaps whitewater stands in along the crest, and the most seededNoise strays
// from 0 either way, near enough: heaped by it, it stands no taller than `stands`.
const HEAP_SEED = 7877;
const NOISE_MOST = 1.4;

// A wave's share of a full one, in its set and along its length (m across the way it
// runs). All the periods divide the waves' loop (config.water.waves), so the sets go on
// across it. The beach's waves have the same (water/swash.js).
export function waveSize(n, across, { least, sets, beat: by, along: [[rate0, turns0], [rate1, turns1]] }) {
  const beat = Math.min(Math.max(0.5 + by * Math.sin((2 * Math.PI * n) / sets[0]) + by * Math.sin((2 * Math.PI * n) / sets[1]), 0), 1);
  const along = 0.5 + 0.25 * Math.sin(across * rate0 + (2 * Math.PI * turns0 * n) / sets[0]) + 0.25 * Math.sin(across * rate1 + (2 * Math.PI * turns1 * n) / sets[1]);
  return (least + (1 - least) * beat * beat) * (0.6 + 0.7 * along);
}

const edge = (from, to, x) => {
  const t = Math.min(Math.max((x - from) / (to - from), 0), 1);
  return t * t * (3 - 2 * t);
};

export function createSurf(settings, [wayX, wayZ]) {
  const { period, height, shoals, limit, dips, fades, back, front: open, fall, ahead, run, always, wave, trail, toe, stands, lumps: [lumpy, lumpSize], heaps: [heapy, heapSize], lean: [leans, narrows], loop } = settings;
  const deep = waveSpeed(Infinity, period);
  const waves = Math.round(loop / period);
  // How much more or less of wave n breaks at x, z: lumps along its crest, each wave its own.
  const lumps = (n, x, z) => 1 + lumpy * seededNoise(x / lumpSize, z / lumpSize, LUMP_SEED + n - waves * Math.floor(n / waves));
  // How tall its whitewater stands at x, z, per `stands`: heaped up in places along the crest.
  const tallness = (x, z) => (1 + heapy * seededNoise(x / heapSize, z / heapSize, HEAP_SEED)) / (1 + NOISE_MOST * heapy);
  return function at({ swell, depth, breaks, reef, late, speed }, x, z, t, out = {}) {
    out.foam = 0;
    out.height = 0;
    out.slope = 0;
    out.lean = 0;
    if (swell <= 0 || reef >= fades[1]) return out;
    // How far along in its wave this place is. Its front wanders a few metres, at sizes from hundreds of metres to a few.
    let wander = 0;
    for (const [m, kx, kz] of settings.wander) wander += m * Math.sin(x * kx + z * kz);
    const phase = (t - (x * wayX + z * wayZ) / deep - late - wander / speed) / period;
    const n = Math.floor(phase);
    const f = phase - n;
    const across = x * wayZ - z * wayX;
    const now = waveSize(n, across, settings);
    const next = waveSize(n + 1, across, settings);

    // How tall each stands here: taller as it slows, no more than what's left of the swell, or the water lets it.
    const rises = height * (deep / speed) ** shoals;
    const held = Math.sqrt(swell);
    const most = limit * Math.max(depth, 0);
    const nowTall = Math.min(rises * Math.min(now, held), most);
    const nextTall = Math.min(rises * Math.min(next, held), most);
    const mean = nowTall + (nextTall - nowTall) * f;
    const dies = Math.exp(Math.min(reef, 0) / fall) * (1 - edge(fades[0], fades[1], reef));
    // A long round wave at sea; by the reef a peak with a steep face, narrowing as it peaks, and
    // flat water ahead of it; round again as it dies on the flat.
    const peak = edge(0.15, 0.6, 1 - speed / deep) * Math.exp(Math.min(reef, 0) / fall);
    const front = open * (1 + (narrows - 1) * peak);
    const behind = Math.exp(-((f / back) ** 2));
    const before = Math.exp(-(((1 - f) / front) ** 2));
    const round = 0.5 * mean * Math.cos(2 * Math.PI * f);
    const crests = nowTall * behind + nextTall * before;
    const peaked = crests - 0.886 * (back + front) * mean;
    const roundly = -Math.PI * mean * Math.sin(2 * Math.PI * f);
    const peakedly = (-2 * f * nowTall * behind) / (back * back) + (2 * (1 - f) * nextTall * before) / (front * front);
    // Its top outruns its foot: by the reef its water moves on as far as its crest stands, so its
    // face leans on, squeezed steeper than its height alone makes it, and its back eases.
    const leaning = leans * dies * peak;
    const squeezed = Math.max(1 - (leaning * peakedly) / (speed * period), 0.1);
    out.lean = leaning * crests;

    // What the water took from it breaks, and whitens it as long as it does, less and less running
    // in, and none of it is left when the next one comes.
    const last = Math.exp(-trail);
    const fading = (Math.exp(-f * trail) - last) / (1 - last);
    const coming = Math.exp(-(((1 - f) / toe) ** 2));
    const breaking = breaks * edge(ahead, 0, reef) * edge(0, 0.05, swell) * Math.exp(Math.min(reef, 0) / run);
    const [behindLost, aheadLost] = breaking > 0 ? [Math.max(now - swell, 0) * lumps(n, x, z), Math.max(next - swell, 0) * lumps(n + 1, x, z)] : [0, 0];
    const lost = behindLost * fading + aheadLost * coming;
    out.foam = breaking * (always + wave * lost);
    // What breaks stands up off the water, as tall as `stands` where it breaks hardest; heaped
    // up in places along the crest, lower between, and its slope by a step either way.
    const standing = stands * breaking * Math.exp(-wave * lost);
    const losing = (-trail * behindLost * Math.exp(-f * trail)) / (1 - last) + ((2 * (1 - f)) / (toe * toe)) * aheadLost * coming;
    const step = 0.01 * heapSize;
    const heaping = (tallness(x + wayX * step, z + wayZ * step) - tallness(x - wayX * step, z - wayZ * step)) / (2 * step);
    const white = stands * breaking * (1 - Math.exp(-wave * lost));
    // It draws down no more than the shallows spare: the reef's crest stays under.
    out.height = Math.max(dies * (round + (peaked - round) * peak), -dips * Math.max(depth, 0)) + white * tallness(x, z);
    out.slope = (white * heaping - (dies * (roundly + (peakedly - roundly) * peak) + standing * wave * losing * tallness(x, z)) / (speed * period)) / squeezed;
    return out;
  };
}
