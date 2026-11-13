// How the lagoon's waves end on the beach (PLAN.md Stage 7): each wave of the swell that
// crosses the lagoon lands at the waterline when the sea map says (`lands`: the surf's
// own timing, so a set's big wave on the reef runs further up the beach a little later),
// runs up the beach as a thin sheet, slows, stops and drains back to a little below the
// still sea before the next one comes. Pure: a function of place and time, so the same
// however it got there. water/swash.wgsl is its twin, which the terrain, the rocks and
// the water draw by.
//
// How far a wave runs up, R (m above the still sea), is the beach's own (how hard the surf
// breaks at its waterline: the sea map's `exposure`), by the wave's size in its set
// (water/surf.js) and by lobes along the beach, each wave its own. It runs up as a stone
// thrown up the slope would, fast at first and slowing (Shen and Meyer's swash), in a time
// that grows with the root of R and with how gentle the beach is, and drains back slower,
// gathering speed. Its sheet is a few centimetres thick, thinning to nothing at its edge;
// its front carries foam, which it strands where it turns and partly drags back down. The
// ground it leaves keeps a glassy film for seconds, from the top down and in patches, and
// is soaked for longer; what a wave did fades within two waves, by when the ground's own
// wetness (chunks/wet.wgsl) holds what the sets did over minutes.
//
// createSwash(settings, surf, way, period, loop) -> at(here, a, o, ground, t, out, width), and
// at.runs(here), how high a full wave runs up there:
// settings: config.water.swash; surf: config.water.surf, whose sets the beach's waves keep;
// way: the way the swell runs in the cove's frame (unit); period: s between waves; loop:
// s the waves come round in. here: the sea map at a, o (water/sea-map.js at(), in the cove's
// frame); ground: m above the still sea; t: s, wrapped at the loop. Into out:
//   level   m: how high the water's edge stands on the beach (below 0 where it draws the sea down)
//   cover   m: how deep the water over the ground is here, 0 where it is bare: the sheet, and
//           the sea's edge drawn down
//   foam    how much foam moves with the water here, 0 to about 1: at the sheet's front, and dragged back
//   line    how much foam a wave stranded where it turned lies here, which stays where it lies
//   film    0 to 1: how much of the ground a glassy film of water covers, 1 under the water
//   soaked  0 to 1: how wet the waves have left the ground, 1 under them and just after
//   milk    0 to 1: how white with bubbles and sand the sheet over the ground is
//   runs    m: how high a full wave runs up this beach
import { waveSize } from './surf.js';
import { seededNoise } from '../world/noise.js';
import { Vector4 } from '../maths/index.js';

const G = 9.81;
// The noises' seeds: a wave's lobes take LOBE_SEED + LOBES x its number in the loop + octave.
const LOBE_SEED = 7919;
const LOBES = 2; // water/swash.wgsl holds this many
const FRAY_SEED = 7907;
const FILM_SEED = 7901;
const LINE_SEED = 7883;
// How long into the next-but-one wave what one did fades out, in periods.
const FADES = [1.6, 2];
const STEEPEST = 1; // the slope its timing is worked out for at most, and LEAST at least
const LEAST = 0.02;

const smoothstep = (a, b, x) => {
  const t = Math.min(Math.max((x - a) / (b - a), 0), 1);
  return t * t * (3 - 2 * t);
};

// The highest a wave can run up a beach, per a full wave's run-up there: the largest of
// a set, at the top of every lobe.
export function highest({ sizes, lobes }, { least }) {
  const largest = (least + (1 - least)) * (0.6 + 0.7);
  return largest ** sizes * (1 + lobes.reduce((sum, [share]) => sum + share, 0));
}

// The way the swell runs in the cove's frame (water/sea-map.js's), from config.
export function swellWay(config) {
  const t = (config.water.waves.swell.from * Math.PI) / 180;
  return [-config.world.island.cove.headlandSide * Math.sin(t), -Math.cos(t)];
}

// The uniforms of water/swash.wgsl, which the terrain, the rocks and the water bind.
export function swashUniforms(settings, surf, way, period, loop) {
  const { height, full, least, sizes, lobes, pace, back, draws, sheet, edge, fray, frayAcross, film, filmPatches, filmAcross, dries, milk, front, frontWidth, lingers, lineWidth, linePatches, dragged } = settings;
  if (lobes.length !== LOBES) throw new Error(`config.water.swash: ${lobes.length} lobes; water/swash.wgsl holds ${LOBES}`);
  return {
    uSwashRun: { value: new Vector4(height, full, least, sizes) },
    uSwashLobes: { value: new Vector4(...lobes[0], ...lobes[1]) },
    uSwashTime: { value: new Vector4(pace, back, draws, period) },
    uSwashSheet: { value: new Vector4(sheet, edge, fray, frayAcross) },
    uSwashFilm: { value: new Vector4(film, filmPatches, filmAcross, dries) },
    uSwashFoam: { value: new Vector4(front, frontWidth, lingers, lineWidth) },
    uSwashMore: { value: new Vector4(dragged, Math.round(loop / period), way[0], way[1]) },
    uSwashLook: { value: new Vector4(milk, linePatches, highest(settings, surf), 0) },
    uSwashSets: { value: new Vector4(surf.sets[0], surf.sets[1], surf.beat, surf.least) },
    uSwashAlong: { value: new Vector4(...surf.along[0], ...surf.along[1]) },
  };
}

export function createSwash(settings, surf, way, period, loop) {
  const { height, full, least, sizes, lobes, pace, back, draws, sheet, edge, fray, frayAcross, film, filmPatches, filmAcross, dries, milk, front, frontWidth, lingers, lineWidth, linePatches, dragged } = settings;
  const waves = Math.round(loop / period);
  const wave = {};
  // How high a full wave runs up the beach whose waterline is nearest (water/swash.wgsl swashRuns).
  const runsAt = ({ exposure }) => height * (least + (1 - least) * smoothstep(0, full, exposure));

  // How high wave k runs up a beach whose full wave runs `runs` m, its waterline at a, o.
  function runUp(k, runs, a, o) {
    const m = k - waves * Math.floor(k / waves);
    let lobe = 1;
    for (let i = 0; i < LOBES; i++) lobe += lobes[i][0] * seededNoise(a / lobes[i][1], o / lobes[i][1], LOBE_SEED + LOBES * m + i);
    return runs * Math.max(waveSize(k, a * way[1] - o * way[0], surf), 0) ** sizes * Math.max(lobe, 0.2);
  }

  // Wave k, landed tau s ago, run up R m from D m below the still sea, where every wave
  // of this beach leaves the edge, over ground g (frayed) on a beach rising `rise` per
  // metre, its edges as soft as `width` m in height: into `wave`, its edge's height, the
  // water over g, its foam there, and how much film and soaking it left at g.
  function oneWave(tau, R, D, rise, g, patches, width) {
    const soft = Math.max(width, 1e-4);
    const up = (pace * Math.sqrt((2 * R) / G)) / Math.min(Math.max(rise, LEAST), STEEPEST);
    const down = back * up;
    const fades = 1 - smoothstep(FADES[0] * period, FADES[1] * period, tau);
    let tip = -D;
    let thick = 0;
    let foam = 0;
    let line = 0;
    let wet = 0;
    let soaked = 0;
    let milky = 0;
    if (tau < up) {
      // Running up: fast at first, slowing to a stop at R.
      const s = tau / up;
      tip = -D + (R + D) * (1 - (1 - s) * (1 - s));
      const behind = tip - g;
      const under = smoothstep(-soft, soft, behind);
      const b = Math.max(behind, 0);
      thick = under * sheet * R * (1 - Math.exp(-b / (edge * R)));
      // What it carries grows in as it starts: where it lands it takes over from the last wave, which carries none.
      const starts = smoothstep(0, 0.2, s);
      foam = starts * under * front * (1 - 0.6 * s) * (Math.exp(-b / frontWidth) + 0.35 * Math.exp(-b / (5 * frontWidth)));
      wet = soaked = under;
      milky = starts * under * milk * (1 - 0.5 * s);
    } else {
      // Draining back, slow at first and gathering speed, to D below the still sea.
      const s = Math.min((tau - up) / down, 1);
      if (tau - up < down) tip = R - (R + D) * s * s;
      const behind = tip - g;
      const under = smoothstep(-soft, soft, behind);
      const b = Math.max(behind, 0);
      // Left behind as it drained: glassy for seconds, from the top down, soaked for longer.
      let filmLeft = 0;
      let soakedLeft = 0;
      let drag = 0;
      if (g < R) {
        const left = up + down * Math.sqrt(Math.max((R - g) / (R + D), 0));
        const since = Math.max(tau - left, 0);
        filmLeft = Math.exp(-since / (film * (0.3 + 0.7 * smoothstep(0, R, R - g)) * patches));
        soakedLeft = Math.exp(-since / dries);
        drag = dragged * (1 - s) * Math.exp(-(R - g) / (frontWidth + 0.5 * (R - Math.max(tip, -D))));
      }
      thick = under * sheet * R * (1 - 0.7 * s) * (1 - Math.exp(-b / (edge * R)));
      milky = under * milk * 0.5 * (1 - s) * (1 - s);
      wet = under + (1 - under) * filmLeft;
      soaked = under + (1 - under) * soakedLeft;
      // Its foam where it turned, lingering, a line no thinner than the pixel and as much
      // in all; the backwash drags some of it back down.
      const lingering = Math.exp(-(tau - up) / lingers);
      const wide = Math.sqrt(lineWidth * lineWidth + soft * soft);
      const across = (R - lineWidth - g) / wide;
      line = (lingering * Math.exp(-across * across) * lineWidth) / wide;
      foam = lingering * drag;
    }
    wave.tip = tip;
    wave.thick = thick * fades;
    wave.foam = foam * fades;
    wave.line = line * fades;
    wave.wet = wet * fades;
    wave.soaked = soaked * fades;
    wave.milk = milky * fades;
    return wave;
  }

  function at(here, a, o, ground, t, out = {}, width = 0) {
    const { lands, rise, shore, inlandA, inlandO } = here;
    const runs = runsAt(here);
    // The waterline nearest, whose waves these are.
    const fa = a + inlandA * shore;
    const fo = o + inlandO * shore;
    // The edge's fray, until a pixel is too tall to hold it.
    const frays = fray * (1 - smoothstep(0.5, 1.5, width / Math.max(fray, 1e-6)));
    const g = ground + frays * seededNoise(a / frayAcross, o / frayAcross, FRAY_SEED);
    const patches = 1 + filmPatches * seededNoise(a / filmAcross, o / filmAcross, FILM_SEED);
    const n = Math.floor((t - lands) / period);
    let level = -Infinity;
    let thick = 0;
    out.foam = 0;
    out.line = 0;
    out.film = 0;
    out.soaked = 0;
    out.milk = 0;
    for (const k of [n, n - 1]) {
      const w = oneWave(t - lands - k * period, runUp(k, runs, fa, fo), draws * runs, rise, g, patches, width);
      level = Math.max(level, w.tip);
      thick = Math.max(thick, w.thick);
      out.foam += w.foam;
      out.line += w.line;
      out.film = Math.max(out.film, w.wet);
      out.soaked = Math.max(out.soaked, w.soaked);
      out.milk = Math.max(out.milk, w.milk);
    }
    // What they strand gathers in places along the beach.
    out.line *= Math.max(0.35 + 0.9 * seededNoise(a / linePatches, o / linePatches, LINE_SEED), 0);
    // The sea at the edge drawn down with it, less and less deeper out.
    const sea = Math.min(level, 0) * Math.exp(Math.min(g, 0) / SEA_DRAWN);
    out.level = level;
    out.cover = Math.max(thick, sea - g, 0);
    out.runs = runs;
    return out;
  }
  at.runs = runsAt;
  return at;
}

// m of depth over which the sea's edge drawn down by the backwash goes back to the still sea.
const SEA_DRAWN = 0.15;
