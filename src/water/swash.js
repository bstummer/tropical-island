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
// wetness (chunks/wet.wgsl) holds what the sets did over minutes. Over the top of its run-up
// the water sinks into the sand as it stops, so no film is left there; low on the beach, where
// the water in the sand meets the beach's face (the seepage face: Turner 1993), the sand stays
// saturated and glassy between waves.
//
// The waves come in over the last metres of the shallows as at.bore() says, and break there.
// Each is one event from its break to the top of its run-up: its bore runs on to the waterline,
// as tall there as the sheet it runs up as, refilling the edge the last backwash drew down as
// its face passes, and its run-up starts from the waterline as it lands there, carrying its
// foam on up the sand. Each is a lens too: at.lens() says how it gathers the sun's light on
// the floor under it.
//
// createSwash(settings, surf, way, period, loop) -> at(here, a, o, ground, t, out, width, swell, fill),
// at.runs(here), how high a full wave runs up there, at.bore(here, a, o, t, out), the waves
// coming in (swell: the height that adds to the sea at the edge; fill: how much of the edge
// drawn down the next wave has refilled there, at.bore()'s), and at.lens(bore, ahead, d, soft,
// peak), the light a wave coming in gathers on the floor under it:
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
//   milk    0 to 1: how white with bubbles and sand the sheet over the ground is: just behind its front
//   runs    m: how high a full wave runs up this beach
//   top     m: as high as the waves wet the ground now, their sheet or what they left
import { waveSize } from './surf.js';
import { seededNoise } from '../world/noise.js';
import { Vector2, Vector3, Vector4 } from '../maths/index.js';

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
// How much film is the last of it: the ground beside it is bare, as it was drawn, and the
// water's surface over it may give the terrain back as it is (water/water.wgsl).
const FILM_GONE = 0.01;
// The share of its period past which a place's foam is the next wave's (bore()).
const BORE_NEXT = 0.9;
// The share of a wave's face's width over which its lens takes its curve (lens()), and how
// much at most it must bend the light (as a share of the floor it lands on) to be worked out,
// in full from twice that.
const LENS_ROUND = 0.5;
const LENS_LEAST = 0.05;

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
  const { height, full, least, sizes, lobes, pace, collapses, back, draws, sheet, edge, fray, frayAcross, film, filmPatches, filmAcross, dries, milk, milkWidth, front, frontWidth, lingers, lineWidth, linePatches, dragged } = settings;
  if (lobes.length !== LOBES) throw new Error(`config.water.swash: ${lobes.length} lobes; water/swash.wgsl holds ${LOBES}`);
  return {
    uSwashRun: { value: new Vector4(height, full, least, sizes) },
    uSwashLobes: { value: new Vector4(...lobes[0], ...lobes[1]) },
    uSwashTime: { value: new Vector4(pace, back, draws, period) },
    uSwashSheet: { value: new Vector4(sheet, edge, fray, frayAcross) },
    uSwashFilm: { value: new Vector4(film, filmPatches, filmAcross, dries) },
    uSwashFoam: { value: new Vector4(front, frontWidth, lingers, lineWidth) },
    uSwashMore: { value: new Vector4(dragged, Math.round(loop / period), way[0], way[1]) },
    uSwashLook: { value: new Vector4(milk, linePatches, highest(settings, surf), settings.bore.milk) },
    uSwashSets: { value: new Vector4(surf.sets[0], surf.sets[1], surf.beat, surf.least) },
    uSwashAlong: { value: new Vector4(...surf.along[0], ...surf.along[1]) },
    uSwashBore: { value: new Vector4(settings.bore.height, settings.bore.breaks, ...settings.bore.from) },
    uSwashBoreFace: { value: new Vector4(...settings.bore.faces, settings.bore.back, settings.bore.spread) },
    uSwashBoreFoam: { value: new Vector4(settings.bore.foam, settings.bore.trail, settings.bore.toe, settings.bore.flow) },
    uSwashBoreWithin: { value: new Vector4(...settings.bore.within, settings.bore.lean, settings.bore.steepens) },
    uSwashBoreRoll: { value: new Vector2(settings.bore.roll, settings.bore.holds) },
    uSwashBoreLook: { value: new Vector4(...settings.bore.stands, settings.bore.lip, settings.bore.foot) },
    uSwashStirred: { value: new Vector4(settings.stirred.always, settings.stirred.broken, settings.stirred.clouds, settings.stirred.within) },
    uSwashStirredAlbedo: { value: new Vector3(...settings.stirred.albedo) },
    uSwashStirredOnwards: { value: new Vector2(...settings.stirred.onwards) },
    uSwashUprush: { value: new Vector2(collapses, milkWidth) },
    uSwashSoaks: { value: new Vector4(settings.soaks, settings.seeps, settings.soakedTop, 0) },
    uSwashBreaks: { value: new Vector4(settings.bore.bores, ...settings.bore.surges, (G * period * period) / (2 * Math.PI)) },
  };
}

export function createSwash(settings, surf, way, period, loop) {
  const { height, full, least, sizes, lobes, pace, collapses, back, draws, sheet, edge, fray, frayAcross, film, filmPatches, filmAcross, dries, soaks, soakedTop, seeps, milk, milkWidth, front, frontWidth, lingers, lineWidth, linePatches, dragged } = settings;
  const waves = Math.round(loop / period);
  const wave = {};
  // The foam at the front of the sheet, `behind` m in height behind its edge (- ahead of it).
  const frontFoam = (behind, width) => {
    const b = Math.max(behind, 0);
    return smoothstep(-Math.max(width, 1e-4), Math.max(width, 1e-4), behind) * front * (Math.exp(-b / frontWidth) + 0.35 * Math.exp(-b / (5 * frontWidth)));
  };
  // How high a full wave runs up the beach whose waterline is nearest (water/swash.wgsl swashRuns).
  const runsAt = ({ exposure }) => height * (least + (1 - least) * smoothstep(0, full, exposure));

  // How high wave k runs up a beach whose full wave runs `runs` m, its waterline at a, o.
  function runUp(k, runs, a, o) {
    const m = k - waves * Math.floor(k / waves);
    let lobe = 1;
    for (let i = 0; i < LOBES; i++) lobe += lobes[i][0] * seededNoise(a / lobes[i][1], o / lobes[i][1], LOBE_SEED + LOBES * m + i);
    return runs * Math.max(waveSize(k, a * way[1] - o * way[0], surf), 0) ** sizes * Math.max(lobe, 0.2);
  }

  // How a wave that runs R m up a beach rising `rise` per metre breaks: the depth (m) it breaks in,
  // and how white it breaks, 0 to 1: none as it surges up instead, by its surf-similarity number
  // there (Battjes 1974), the slope over the root of its height per its deep-water wavelength.
  const L0 = (G * period * period) / (2 * Math.PI);
  function breaking(R, rise) {
    const at = ((settings.bore.height * R) / settings.bore.breaks) ** 0.8;
    const similar = Math.min(Math.max(rise, LEAST), STEEPEST) / Math.sqrt((settings.bore.breaks * at) / L0);
    return { at, white: 1 - smoothstep(settings.bore.surges[0], settings.bore.surges[1], similar) };
  }

  // Wave k, landed tau s ago at the still waterline, where its bore arrived at `arrives` m/s
  // as white as `white` times a full one's front, having broken `broke` white (0 as it surged up),
  // run up R m and drained back to D m below the still sea, where every wave of this beach
  // leaves the edge, over ground g (frayed) on a beach rising `rise` per metre whose seepage face
  // stands `seep` m above the still sea, its edges as soft as `width` m in height: into `wave`,
  // its edge's height, the water over g, its foam there, and how much film and soaking it left at g.
  function oneWave(tau, R, D, rise, g, patches, width, arrives, white, broke, seep) {
    const soft = Math.max(width, 1e-4);
    const up = (pace * Math.sqrt((2 * R) / G)) / Math.min(Math.max(rise, LEAST), STEEPEST);
    // It sets off at its bore's speed and speeds up as the bore collapses, over `collapses` s, so
    // it turns `lag` s later than at its full speed from the start.
    const lag = collapses * (1 - Math.min(arrives / Math.max(Math.sqrt(2 * G * R) / pace, 1e-3), 1));
    const turns = up + lag;
    const down = back * up;
    const fades = 1 - smoothstep(FADES[0] * period, FADES[1] * period, tau);
    // Its bubbles, within `milkWidth` m behind its front.
    const behindFront = milkWidth * Math.max(rise, LEAST);
    let tip = -D;
    let top = fades > 0 ? R : -D;
    let thick = 0;
    let foam = 0;
    let line = 0;
    let wet = 0;
    let soaked = 0;
    let milky = 0;
    if (tau < turns) {
      // Running up from the waterline, where its bore lands: fast at first, slowing to a stop at R.
      const s = Math.min((tau - lag * (1 - Math.exp(-tau / collapses))) / up, 1);
      tip = R * (1 - (1 - s) * (1 - s));
      top = tip;
      const behind = tip - g;
      const under = smoothstep(-soft, soft, behind);
      const b = Math.max(behind, 0);
      thick = under * sheet * R * (1 - Math.exp(-b / (edge * R)));
      // Its front carries on the foam its bore broke into.
      foam = white * (1 - 0.6 * s) * frontFoam(behind, width);
      wet = soaked = under;
      milky = under * milk * (1 - 0.5 * s) * Math.exp(-b / behindFront);
    } else {
      // Draining back, slow at first and gathering speed, to D below the still sea.
      const s = Math.min((tau - turns) / down, 1);
      if (tau - turns < down) tip = R - (R + D) * s * s;
      const behind = tip - g;
      const under = smoothstep(-soft, soft, behind);
      const b = Math.max(behind, 0);
      // Left behind as it drained, as far as it ran, its edge no sharper than the pixel: glassy for
      // seconds, from the top down, soaked for longer; on the seepage face saturated, glassy until
      // the next wave. Over the top of its run-up it soaked in as it stopped: no film, and the sand
      // wet but matte, thinning to that over at least two pixels' height.
      let filmLeft = 0;
      let soakedLeft = 0;
      let drag = 0;
      if (g < R + soft) {
        const left = turns + down * Math.sqrt(Math.max((R - g) / (R + D), 0));
        const since = Math.max(tau - left, 0);
        const lasts = film * (0.3 + 0.7 * smoothstep(0, Math.max(R - seep, 1e-3), R - g)) * patches;
        const seeping = 1 - smoothstep(0.75 * seep - soft, 1.25 * seep + soft, g);
        const reached = smoothstep(-soft, soft, R - g);
        const below = smoothstep(0, Math.max(soaks * R, 2 * soft), R - g);
        filmLeft = Math.max(Math.exp(-since / lasts), seeping) * below;
        soakedLeft = Math.max(Math.exp(-since / dries), seeping) * (soakedTop + (1 - soakedTop) * below) * reached;
        drag = reached * dragged * (1 - s) * Math.exp(-Math.max(R - g, 0) / (frontWidth + 0.5 * (R - Math.max(tip, -D))));
      }
      thick = under * sheet * R * (1 - 0.7 * s) * (1 - Math.exp(-b / (edge * R)));
      milky = under * milk * 0.5 * (1 - s) * (1 - s) * Math.exp(-b / behindFront);
      wet = under + (1 - under) * filmLeft;
      soaked = under + (1 - under) * soakedLeft;
      // Its foam where it turned, lingering, a line no thinner than the pixel and as much
      // in all; the backwash drags some of it back down.
      const lingering = Math.exp(-(tau - turns) / lingers);
      const wide = Math.sqrt(lineWidth * lineWidth + soft * soft);
      const across = (R - lineWidth - g) / wide;
      // As much as its front carried: none where it surged up glassy.
      line = (broke * lingering * Math.exp(-across * across) * lineWidth) / wide;
      foam = broke * lingering * drag;
    }
    wave.tip = tip;
    wave.top = top;
    wave.thick = thick * fades;
    wave.foam = foam * fades;
    wave.line = line * fades;
    wave.wet = wet * fades;
    wave.soaked = soaked * fades;
    wave.milk = milky * fades;
    return wave;
  }

  // The waves as they come in over the last of the shallows (settings.bore), at a, o, where
  // the sea map (here) says the water is `depth` m deep and the waterline nearest `shore` m off:
  // into out, { height, slope, foam, milk, along, lean, drift, wave, crest, across, fill }: m above the still sea; how
  // it rises per m further out, as its face leans in; how much foam its break leaves, as the
  // beach's; how much of the sand it stirs up the water it broke in holds; how far (m) that foam
  // has drifted inland with it; how far (m) the water at a, o has moved inland, its top outrunning
  // its foot; how far (m) what the last wave to pass stirred up has drifted in, and its number;
  // how near the top of the nearest crest the water stands, 0 to 1, and m under its top; how much
  // of the edge the last backwash drew down the next wave has refilled here (at()); and its shape,
  // for at.lens(): how tall the last wave and the next stand here, their faces' shares of the period,
  // how far into the period it is, and how far that moves per m out to sea.
  // Each wave comes in as fast as water this shallow lets it, timed to reach the waterline
  // when it lands there, standing taller as the water shallows (Green's law), its face
  // steepening from `steepens` times as deep as it breaks, until it stands `breaks` times as
  // tall as the water is deep: there it breaks, a big wave further out and harder, a small
  // one barely, into a bore that runs on as tall as the water lets it, to the waterline, where
  // it collapses into its run-up as tall as the sheet it runs up as, its foam carried on. Its
  // water moves inland by `lean` of how far it stands (as a Gerstner wave's does), so its face
  // leans in, the more the steeper, near upright as a big one breaks. Its foam trails behind
  // its front, and runs ahead on its face.
  function bore(here, a, o, t, out = {}) {
    const { lands, shore, depth, inlandA, inlandO } = here;
    const { height: tall, breaks, bores, from, within, faces, back: falls, spread, foam: foamy, roll, holds, trail, toe, flow, milk: milky, lean, steepens } = settings.bore;
    out.height = out.slope = out.foam = out.milk = out.along = out.lean = out.drift = out.wave = out.crest = out.under = out.fill = 0;
    out.tallNow = out.tallNext = out.frontNow = out.frontNext = out.phase = out.perMetre = 0;
    if (depth >= from[0] || shore >= within[1]) return out;
    if (depth <= 0) {
      // Past the waterline as the map has it, only how near the next wave's face has come to it:
      // the ground as drawn may lie lower.
      const f = (t - lands) / period;
      out.fill = Math.exp(-(((1 - f + Math.floor(f)) / faces[1]) ** 2));
      return out;
    }
    const runs = runsAt(here);
    const fa = a + inlandA * shore;
    const fo = o + inlandO * shore;
    // How fast it comes in: as a bore as tall as a full wave in a metre of water, over water
    // shallowing evenly to the waterline (the time to it is 2 s / (c + c0) then).
    const scale = tall * runs;
    const c0 = Math.sqrt(G * scale);
    const c = Math.sqrt(G * (depth + scale));
    const phase = (t - lands + (2 * Math.max(shore, 0)) / (c + c0)) / period;
    const k = Math.floor(phase);
    const f = phase - k;
    // Out of the lagoon's own waves, by the last of the shallows: not over a reef's flat, far from
    // any beach; on to the waterline, its height ending over the last centimetre of water.
    const appear = (1 - smoothstep(from[1], from[0], depth)) * (1 - smoothstep(within[0], within[1], shore));
    const ends = smoothstep(0, BORE_ENDS, depth);
    const one = (j) => {
      const runsUp = runUp(j, runs, fa, fo);
      const comes = tall * runsUp; // how tall it stands in a metre of water
      const { at: breaksAt, white } = breaking(runsUp, here.rise);
      const broke = smoothstep(0, 1, (breaksAt - depth) / (spread * breaksAt + 0.01));
      // As tall as the water lets it, a bore once broken, but no lower than the sheet it collapses into at the waterline.
      const tallHere = appear * ends * Math.min(comes / Math.sqrt(Math.sqrt(depth)), Math.hypot((breaks + (bores - breaks) * broke) * depth, sheet * runsUp));
      const steep = Math.max(broke, 1 - smoothstep(breaksAt, steepens * breaksAt, depth));
      return { tall: tallHere, broke, white, share: comes / scale, front: faces[0] + (faces[1] - faces[0]) * steep };
    };
    const now = one(k);
    const next = one(k + 1);
    const behind = Math.exp(-((f / falls) ** 2));
    const before = Math.exp(-(((1 - f) / next.front) ** 2));
    // Less its mean over the period, so it raises the sea no higher on average.
    const mean = 0.886 * ((1 - f) * now.tall * (falls + now.front) + f * next.tall * (falls + next.front));
    const crests = now.tall * behind + next.tall * before;
    out.height = crests - mean;
    const rising = (-2 * f * now.tall * behind) / (falls * falls) + (2 * (1 - f) * next.tall * before) / (next.front * next.front);
    out.lean = lean * crests;
    const raw = rising / (period * c);
    out.slope = raw / Math.max(1 - lean * raw, 0.1);
    // How near the top of the nearest crest the water stands, and m under its top.
    const last = behind * now.tall > before * next.tall;
    out.crest = Math.max(now.tall, next.tall) > 0 ? (last ? behind : before) : 0;
    out.under = (last ? now.tall : next.tall) * (1 - out.crest);
    out.tallNow = now.tall;
    out.tallNext = next.tall;
    out.frontNow = now.front;
    out.frontNext = next.front;
    out.phase = f;
    out.perMetre = 1 / (period * c);
    // Its foam, thick in the roller at its front, then thinning behind it into patches; at the
    // waterline its run-up's front carries it on.
    const trails = appear * foamy * now.broke * now.white * now.share * ((1 - holds) * Math.exp(-f / roll) + holds * Math.exp(-f / trail));
    const leads = appear * foamy * next.broke * next.white * next.share * Math.exp(-(((1 - f) / toe) ** 2));
    // It breaks whiter in places along the beach, where the foam it strands gathers too.
    const gathers = 0.4 + 0.6 * Math.max(0.35 + 0.9 * seededNoise(a / linePatches, o / linePatches, LINE_SEED), 0);
    out.foam = (trails + leads) * gathers;
    out.milk = appear * milky * Math.min(now.broke * now.white * now.share * Math.exp(-f / (2 * trail)), 1);
    // The foam drifts with the wave that made it: the next one's on its face, ahead of it, once
    // what the last one left has gone (a blend of the two would stretch it across the front).
    const since = t - lands - k * period;
    out.along = flow * c0 * (f > BORE_NEXT ? since - period : since);
    out.drift = flow * c0 * since;
    out.wave = k;
    // The edge drawn down after the last wave fills as the next one's face passes; once its crest
    // has passed, until it lands at the waterline, it stays full.
    out.fill = k > Math.floor((t - lands + faces[1] * period) / period) ? 1 : before;
    return out;
  }

  function at(here, a, o, ground, t, out = {}, width = 0, swell = 0, fill = 0) {
    const { lands, rise, shore, inlandA, inlandO } = here;
    const runs = runsAt(here);
    // The waterline nearest, whose waves these are.
    const fa = a + inlandA * shore;
    const fo = o + inlandO * shore;
    // The edge's fray, until a pixel is too tall to hold it.
    const frays = fray * (1 - smoothstep(0.5, 1.5, width / Math.max(fray, 1e-6)));
    const g = ground + frays * seededNoise(a / frayAcross, o / frayAcross, FRAY_SEED);
    const patches = 1 + filmPatches * seededNoise(a / filmAcross, o / filmAcross, FILM_SEED);
    // Its run-up starts as the foot of its bore's broken face reaches the waterline, a little before its crest.
    const since = t - lands + settings.bore.faces[1] * period;
    const n = Math.floor(since / period);
    let level = -Infinity;
    let thick = 0;
    out.top = -Infinity;
    out.foam = 0;
    out.line = 0;
    out.film = 0;
    out.soaked = 0;
    out.milk = 0;
    const D = draws * runs;
    const seep = seeps * runs;
    // The waves coming in reach the waterline at c0, and cross the edge drawn down at about c0 and cD (bore()).
    const scale = settings.bore.height * runs;
    const c0 = Math.sqrt(G * scale);
    const cD = Math.sqrt(G * (D + scale));
    // Its front as white as its bore's roller as it lands (bore()): as much as it runs up, and in
    // places along the beach.
    const gathers = Math.max(0.35 + 0.9 * seededNoise(a / linePatches, o / linePatches, LINE_SEED), 0);
    const whitens = (settings.bore.foam * (0.4 + 0.6 * gathers)) / (FRONT_MOST * runs);
    for (const k of [n, n - 1]) {
      const R = runUp(k, runs, fa, fo);
      const { white } = breaking(R, rise);
      const w = oneWave(since - k * period, R, D, rise, g, patches, width, c0, whitens * R * white, white, seep);
      level = Math.max(level, w.tip);
      out.top = Math.max(out.top, w.top);
      thick = Math.max(thick, w.thick);
      out.foam += w.foam;
      out.line += w.line;
      out.film = Math.max(out.film, w.wet);
      out.soaked = Math.max(out.soaked, w.soaked);
      out.milk = Math.max(out.milk, w.milk);
    }
    // The next wave's bore crosses the edge drawn down, to reach the still waterline as it lands,
    // its front white with the foam it carries on into its run-up where its face has come (fill).
    const crosses = (2 * D) / Math.max(rise, LEAST) / (cD + c0);
    const ahead = since - (n + 1) * period;
    if (ahead > -crosses) {
      const edge = (D * ahead) / crosses;
      level = Math.max(level, edge);
      out.top = Math.max(out.top, level);
      const R = runUp(n + 1, runs, fa, fo);
      out.foam += whitens * R * breaking(R, rise).white * fill * smoothstep(-crosses, -0.5 * crosses, ahead) * frontFoam(edge - g, width);
    }
    out.film = Math.max(out.film - FILM_GONE, 0) / (1 - FILM_GONE);
    // What they strand gathers in places along the beach.
    out.line *= gathers;
    // The sea at the edge drawn down with it, less and less deeper out, until the next wave's face
    // refills it, and the waves coming in (bore()).
    const sea = Math.min(level, 0) * Math.exp(Math.min(g, 0) / SEA_DRAWN) * (1 - fill) + swell;
    out.level = level;
    out.cover = Math.max(thick, sea - g, 0);
    out.runs = runs;
    return out;
  }
  // How a wave coming in rises along the way out, per share of its period, phase f into the period
  // bore() told it at (its shape): the last wave's crest at 0 and the next's at 1, each falling over
  // its face's share of the period shoreward of it and over `back` behind it.
  function rises(shape, f) {
    const { back } = settings.bore;
    let rise = 0;
    for (const [x, tall, front] of [[f, shape.tallNow, shape.frontNow], [f - 1, shape.tallNext, shape.frontNext]]) {
      const w = x < 0 ? front : back;
      rise += ((-2 * x) / (w * w)) * tall * Math.exp(-((x / w) ** 2));
    }
    return rise;
  }

  // The light a wave coming in gathers on the floor, as a lens: how much of the sun's light that
  // level water would let through reaches the floor where it went in `ahead` m further out than
  // where bore() told the wave (`shape`, its out), the light going `d` m sideways per its rise
  // per m (1 - 1 / ior, times the depth it crosses). It lands at x + d h'(x) from where it went in
  // at x, over 1 + d h''(x) as much floor: a crest gathers it into a line, the hollow at its face's
  // foot spreads it. Along the way the wave runs only, as it lies along its crest; as the wave
  // stands, not as its face leans in, so no more light reaches the floor than went in. Its curve
  // over LENS_ROUND of its face's width, so where its face's curve meets its back's at its top
  // the line has no edge. Its lines as soft as `soft` and held to about `peak` times even light,
  // as the ripples' (caustics.js).
  function lens(shape, ahead, d, soft, peak) {
    const k = shape.perMetre;
    // The most it can gather: under a crest as tall as the taller and as narrow as the narrower face.
    // A swell out in the lagoon gathers too little to tell.
    const most = (2 * d * Math.max(shape.tallNow, shape.tallNext) * k * k) / Math.min(shape.frontNow, shape.frontNext) ** 2;
    if (!(most > LENS_LEAST)) return 1;
    const there = shape.phase + ahead * k;
    // Where the light it lands there with went in: one step back along its way.
    const entered = there - d * rises(shape, there) * k * k;
    const half = 0.5 * LENS_ROUND * (entered < 0.5 ? shape.frontNow : shape.frontNext);
    const j = 1 + (d * (rises(shape, entered + half) - rises(shape, entered - half)) * k * k) / (2 * half);
    const g = Math.sqrt((1 + soft * soft) / (j * j + soft * soft));
    return 1 + ((g / (1 + g / peak)) * (1 + 1 / peak) - 1) * smoothstep(LENS_LEAST, 2 * LENS_LEAST, most);
  }

  at.runs = runsAt;
  at.bore = bore;
  at.lens = lens;
  return at;
}

// m of depth over which the sea's edge drawn down by the backwash goes back to the still sea.
const SEA_DRAWN = 0.15;
// m of depth over which the waves coming in end at the waterline, where their run-up takes over.
const BORE_ENDS = 0.01;
// The most foam at the sheet's front, per its `front` (frontFoam()).
const FRONT_MOST = 1.35;
