// The swell's waves that reach the reef (PLAN.md 6.6), in JS, for sound and for what
// floats on the water; water/water-surf.wgsl is its twin, which draws them. Pure: a
// function of place and time, so the same however it got there.
//
// A wave comes in from the open sea as a long low line, when water/sea-map.js says it
// gets to each place (`late`, `speed`), so its crest bends round the reef and bunches
// up over the shallows. It stands taller as it slows, and steeper, as far as the water
// lets it: what the swell's own reach (`swell`) leaves of it. What that takes from it
// breaks. So a big wave of a set breaks seaward of the crest and whitens it through; a
// small one breaks only on the crest, in lace, and the smallest not at all. Behind it
// foam runs in over the flat and fades, as far as the sea map says the surf breaks
// round here (`breaks`). A wave differs along its length, each its own way.
//
// createSurf(settings, way) -> at(here, x, z, t, out): settings: config.water.surf;
// way: the world direction the swell runs ([x, z], unit); here: the sea map at x, z.
// Into out, { foam, height, slope }: how much foam covers the water, 0 to 1 and more
// where it lies thick; how high the wave stands (m); how steeply it rises along the
// way it runs. The GPU's twin also takes how far whitewater reaches seen from far off, and how wide a pixel is.
import { waveSpeed } from './sea-map.js';

// A wave's share of a full one, in its set and along its length. All the periods
// divide the waves' loop (config.water.waves), so the sets go on across it.
function sizeOf(n, across, least) {
  const beat = Math.min(Math.max(0.5 + 0.35 * Math.sin((2 * Math.PI * n) / 8) + 0.35 * Math.sin((2 * Math.PI * n) / 5), 0), 1);
  const along = 0.5 + 0.25 * Math.sin(across * 0.031 + (2 * Math.PI * 3 * n) / 8) + 0.25 * Math.sin(across * 0.0127 + (2 * Math.PI * 2 * n) / 5);
  return (least + (1 - least) * beat * beat) * (0.6 + 0.7 * along);
}

const edge = (from, to, x) => {
  const t = Math.min(Math.max((x - from) / (to - from), 0), 1);
  return t * t * (3 - 2 * t);
};

export function createSurf(settings, [wayX, wayZ]) {
  const { period, height, shoals, limit, dips, fades, least, back, front, fall, ahead, run, always, wave, trail, toe } = settings;
  const deep = waveSpeed(Infinity, period);
  return function at({ swell, depth, breaks, reef, late, speed }, x, z, t, out = {}) {
    out.foam = 0;
    out.height = 0;
    out.slope = 0;
    if (swell <= 0 || reef >= fades[1]) return out;
    // How far along in its wave this place is. Its front wanders a few metres, at sizes from hundreds of metres to a few.
    const wander = 3 * Math.sin(x * 0.021 + z * 0.013) + 2 * Math.sin(x * -0.017 + z * 0.037) + 0.5 * Math.sin(x * 0.21 + z * 0.13) + 0.4 * Math.sin(x * 0.71 + z * 0.43) + 0.2 * Math.sin(x * -0.93 + z * 1.37);
    const phase = (t - (x * wayX + z * wayZ) / deep - late - wander / speed) / period;
    const n = Math.floor(phase);
    const f = phase - n;
    const across = x * wayZ - z * wayX;
    const now = sizeOf(n, across, least);
    const next = sizeOf(n + 1, across, least);

    // How tall each stands here: taller as it slows, no more than what's left of the swell, or the water lets it.
    const rises = height * (deep / speed) ** shoals;
    const held = Math.sqrt(swell);
    const most = limit * Math.max(depth, 0);
    const nowTall = Math.min(rises * Math.min(now, held), most);
    const nextTall = Math.min(rises * Math.min(next, held), most);
    const stands = nowTall + (nextTall - nowTall) * f;
    const dies = Math.exp(Math.min(reef, 0) / fall) * (1 - edge(fades[0], fades[1], reef));
    // A long round wave at sea; by the reef a peak with a steep face, and flat water ahead of it; round again as it dies on the flat.
    const peak = edge(0.15, 0.6, 1 - speed / deep) * Math.exp(Math.min(reef, 0) / fall);
    const behind = Math.exp(-((f / back) ** 2));
    const before = Math.exp(-(((1 - f) / front) ** 2));
    const round = 0.5 * stands * Math.cos(2 * Math.PI * f);
    const peaked = nowTall * behind + nextTall * before - 0.886 * (back + front) * stands;
    // It draws down no more than the shallows spare: the reef's crest stays under.
    out.height = Math.max(dies * (round + (peaked - round) * peak), -dips * Math.max(depth, 0));
    const roundly = -Math.PI * stands * Math.sin(2 * Math.PI * f);
    const peakedly = (-2 * f * nowTall * behind) / (back * back) + (2 * (1 - f) * nextTall * before) / (front * front);
    out.slope = (-dies * (roundly + (peakedly - roundly) * peak)) / (speed * period);

    // What the water took from it breaks, and whitens it as long as it does, less and less running in.
    const fading = Math.exp(-f * trail);
    const coming = Math.exp(-(((1 - f) / toe) ** 2));
    const lost = Math.max(now - swell, 0) * fading + Math.max(next - swell, 0) * coming;
    out.foam = breaks * edge(ahead, 0, reef) * edge(0, 0.05, swell) * Math.exp(Math.min(reef, 0) / run) * (always + wave * lost);
    return out;
  };
}
