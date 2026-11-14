// How the lagoon's waves end on the beach: water/swash.js's twin, which says what they
// are and what each value means. The terrain and the rocks wet the ground by it
// (swash-wet.wgsl), the water draws the sheet, its film and its foam by it. Needs
// `frame` (the waves' time) and terrainCove() (chunks/terrain.wgsl).

#include "/chunks/noise.wgsl"
#include "/chunks/pi.wgsl"
#include "sea-map.wgsl"

struct SwashSettings {
  uSwashRun: vec4f, // m a full wave runs up where the surf breaks hardest; how hard that is; the share where it breaks not at all; the power of a wave's size
  uSwashLobes: vec4f, // per lobe along the beach: its share, and m across
  uSwashTime: vec4f, // the uprush's pace; the backwash's, per the uprush's; how far it draws the sea down, per its run-up; s between waves
  uSwashSheet: vec4f, // the sheet's thickness, and how it thins to its edge, per the run-up; the edge's fray, m in height, and m across
  uSwashFilm: vec4f, // s the glassy film lasts at most; a share more or less in patches, m across; s the ground takes to dry
  uSwashFoam: vec4f, // how much foam its front carries, m in height; s what it strands lingers; the line's width, m in height
  uSwashMore: vec4f, // how much of the line the backwash drags back; waves in the loop; the way the swell runs (a, o)
  uSwashLook: vec4f, // how white the uprush is; m along the beach over which the line gathers in places; the highest a wave runs, per a full one; how white the water a wave broke in is
  uSwashSets: vec4f, // the surf's sets (water/surf.js): the waves each of two beats goes round over, how far each moves a size, the smallest's share
  uSwashAlong: vec4f, // per beat: how a wave's size varies along it, rad/m, and how many turns it moves along it
  // The waves coming in (water/swash.js bore): how tall in a metre of water per m it runs up; how tall per m of
  // water it breaks; m of depth over which it rises out of the lagoon's own waves, from and to
  uSwashBore: vec4f,
  uSwashBoreFace: vec4f, // the share of its period its face takes, before it breaks and once broken; that it falls over behind its crest; how much further in, per the depth it breaks at, it has broken in full
  uSwashBoreFoam: vec4f, // how much foam its break leaves; the shares of its period it trails over and runs ahead on its face; how fast it drifts inland, per its speed
  // m from the waterline nearest over which it fades out, from and to; m its water moves inland per m it
  // stands; from how many times as deep as it breaks its face steepens
  uSwashBoreWithin: vec4f,
  uSwashBoreRoll: vec2f, // the share of its period the roller at its front takes; how much of its foam the trail behind holds
  // The sand the waves stir up: how much it clouds the water near the shore always, per m the eye's
  // ray goes through it, and as much again per how much a wave just broke there; m across its clouds;
  // m from the waterline nearest by which the first is gone
  uSwashStirred: vec4f,
  uSwashStirredAlbedo: vec3f, // linear: what water thick with it sends back of the light on it
  uSwashStirredOnwards: vec2f, // the share of the sun's it sends mostly onwards, and how much onwards (Henyey-Greenstein g)
  uSwashUprush: vec2f, // s its front takes to speed up from its bore's speed as that collapses; m behind its front it is white
}

@group(1) @binding(23) var<uniform> swash: SwashSettings;

const SWASH_G: f32 = 9.81;
const SWASH_LOBE_SEED: u32 = 7919u;
const SWASH_FRAY_SEED: u32 = 7907u;
const SWASH_FILM_SEED: u32 = 7901u;
const SWASH_LINE_SEED: u32 = 7883u;
const SWASH_FADES = vec2f(1.6, 2.0);
const SWASH_STEEPEST: f32 = 1.0;
const SWASH_LEAST: f32 = 0.02;
const SWASH_SEA_DRAWN: f32 = 0.15;
const SWASH_FILM_GONE: f32 = 0.01;
// m of depth over which the waves coming in end at the waterline, where their run-up takes over.
const SWASH_BORE_ENDS: f32 = 0.01;
// The most foam at the sheet's front, per its `front` (swashFrontFoam()).
const SWASH_FRONT_MOST: f32 = 1.35;
// The share of its period past which a place's foam is the next wave's (swashBore).
const SWASH_BORE_NEXT: f32 = 0.9;
// How near a crest's top the eye starts to see through it, and sees only through it (water.wgsl).
const SWASH_THIN = vec2f(0.3, 0.9);

struct Swash {
  level: f32,
  cover: f32,
  foam: f32, // what moves with the water: at the sheet's front, and what the backwash drags back
  line: f32, // what a wave stranded where it turned, which stays where it lies
  film: f32,
  soaked: f32,
  milk: f32, // how white with bubbles and sand the sheet over the ground is
  runs: f32, // m: how high a full wave runs up this beach
  rise: f32, // how steeply the beach rises at its waterline, per metre inland
  top: f32, // m: as high as the waves wet the ground now, their sheet or what they left
}

// A wave's share of a full one, in its set and along its length (water/surf.js waveSize).
fn swashWaveSize(n: f32, across: f32) -> f32 {
  let sets = swash.uSwashSets;
  let along = swash.uSwashAlong;
  let beat = clamp(0.5 + sets.z * sin(2.0 * PI * n / sets.x) + sets.z * sin(2.0 * PI * n / sets.y), 0.0, 1.0);
  let crest = 0.5 + 0.25 * sin(across * along.x + 2.0 * PI * along.y * n / sets.x) + 0.25 * sin(across * along.z + 2.0 * PI * along.w * n / sets.y);
  return (sets.w + (1.0 - sets.w) * beat * beat) * (0.6 + 0.7 * crest);
}

// How high wave k runs up a beach whose full wave runs `runs` m, its waterline at `foot` (cove frame).
fn swashRunUp(k: f32, runs: f32, foot: vec2f) -> f32 {
  let waves = swash.uSwashMore.y;
  let m = u32(k - waves * floor(k / waves));
  let seed = SWASH_LOBE_SEED + 2u * m;
  let lobes = swash.uSwashLobes;
  let lobe = 1.0 + lobes.x * seededNoise(foot / lobes.y, seed) + lobes.z * seededNoise(foot / lobes.w, seed + 1u);
  let across = foot.x * swash.uSwashMore.w - foot.y * swash.uSwashMore.z;
  return runs * pow(max(swashWaveSize(k, across), 0.0), swash.uSwashRun.w) * max(lobe, 0.2);
}

struct SwashWave {
  tip: f32,
  thick: f32,
  foam: f32,
  line: f32,
  film: f32,
  soaked: f32,
  milk: f32,
  top: f32, // as high as it wets the ground: its edge running up, then its run-up, while it lasts
}

// The foam at the front of the sheet, `behind` m in height behind its edge (- ahead of it).
fn swashFrontFoam(behind: f32, width: f32) -> f32 {
  let soft = max(width, 1e-4);
  let b = max(behind, 0.0);
  let foamLook = swash.uSwashFoam;
  return smoothstep(-soft, soft, behind) * foamLook.x * (exp(-b / foamLook.y) + 0.35 * exp(-b / (5.0 * foamLook.y)));
}

// Wave k, landed tau s ago at the still waterline, where its bore arrived at `arrives` m/s as
// white as `white` times a full one's front, run up r m and drained back to d m below the
// still sea, where every wave of this beach leaves the edge, over ground g (frayed) on a beach
// rising `rise` per metre, its edges as soft as `width` m in height, a pixel's.
fn swashWave(tau: f32, r: f32, d: f32, rise: f32, g: f32, patches: f32, width: f32, arrives: f32, white: f32) -> SwashWave {
  let time = swash.uSwashTime;
  let sheet = swash.uSwashSheet;
  let foamLook = swash.uSwashFoam;
  let uprush = swash.uSwashUprush;
  let soft = max(width, 1e-4);
  let up = time.x * sqrt(2.0 * r / SWASH_G) / clamp(rise, SWASH_LEAST, SWASH_STEEPEST);
  // It sets off at its bore's speed and speeds up as the bore collapses, so it turns `lag` s
  // later than at its full speed from the start.
  let lag = uprush.x * (1.0 - min(arrives / max(sqrt(2.0 * SWASH_G * r) / time.x, 1e-3), 1.0));
  let turns = up + lag;
  let down = time.y * up;
  let fades = 1.0 - smoothstep(SWASH_FADES.x * time.w, SWASH_FADES.y * time.w, tau);
  // Its bubbles, just behind its front.
  let behindFront = uprush.y * max(rise, SWASH_LEAST);
  var w = SwashWave(-d, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, select(-d, r, fades > 0.0));
  if (tau < turns) {
    // Running up from the waterline, where its bore lands: fast at first, slowing to a stop at r.
    let s = min((tau - lag * (1.0 - exp(-tau / uprush.x))) / up, 1.0);
    w.tip = r * (1.0 - (1.0 - s) * (1.0 - s));
    w.top = w.tip;
    let behind = w.tip - g;
    let under = smoothstep(-soft, soft, behind);
    let b = max(behind, 0.0);
    w.thick = under * sheet.x * r * (1.0 - exp(-b / (sheet.y * r)));
    // Its front carries on the foam its bore broke into.
    w.foam = white * (1.0 - 0.6 * s) * swashFrontFoam(behind, width);
    w.film = under;
    w.soaked = under;
    w.milk = under * swash.uSwashLook.x * (1.0 - 0.5 * s) * exp(-b / behindFront);
  } else {
    // Draining back, slow at first and gathering speed, to d below the still sea.
    let s = min((tau - turns) / down, 1.0);
    if (tau - turns < down) {
      w.tip = r - (r + d) * s * s;
    }
    let behind = w.tip - g;
    let under = smoothstep(-soft, soft, behind);
    let b = max(behind, 0.0);
    // Left behind as it drained: glassy for seconds, from the top down, soaked for longer.
    var film = 0.0;
    var soaked = 0.0;
    var drag = 0.0;
    if (g < r) {
      let left = turns + down * sqrt(max((r - g) / (r + d), 0.0));
      let since = max(tau - left, 0.0);
      film = exp(-since / (swash.uSwashFilm.x * (0.3 + 0.7 * smoothstep(0.0, r, r - g)) * patches));
      soaked = exp(-since / swash.uSwashFilm.w);
      drag = swash.uSwashMore.x * (1.0 - s) * exp(-(r - g) / (foamLook.y + 0.5 * (r - max(w.tip, -d))));
    }
    w.thick = under * sheet.x * r * (1.0 - 0.7 * s) * (1.0 - exp(-b / (sheet.y * r)));
    w.milk = under * swash.uSwashLook.x * 0.5 * (1.0 - s) * (1.0 - s) * exp(-b / behindFront);
    w.film = under + (1.0 - under) * film;
    w.soaked = under + (1.0 - under) * soaked;
    // Its foam where it turned, lingering, a line no thinner than the pixel and as much in all;
    // the backwash drags some of it back down.
    let lingering = exp(-(tau - turns) / foamLook.z);
    let wide = sqrt(foamLook.w * foamLook.w + soft * soft);
    let across = (r - foamLook.w - g) / wide;
    w.line = lingering * exp(-across * across) * foamLook.w / wide;
    w.foam = lingering * drag;
  }
  w.thick *= fades;
  w.foam *= fades;
  w.line *= fades;
  w.film *= fades;
  w.soaked *= fades;
  w.milk *= fades;
  return w;
}

// How high a full wave runs up the beach whose waterline is nearest world xz (m).
fn swashRuns(xz: vec2f) -> f32 {
  return swashRunsBy(seaBeachAt(xz).y);
}

// The same, how hard the surf breaks at that waterline.
fn swashRunsBy(exposure: f32) -> f32 {
  let run = swash.uSwashRun;
  return run.x * (run.z + (1.0 - run.z) * smoothstep(0.0, run.y, exposure));
}

// What the beach's water takes from where it is, all of which changes only over metres:
// the water's mesh works it out at its vertices and its pixels share it (water.wgsl), so
// they need none of its noises. When the waves land at the waterline nearest, its slope, how
// high a full wave runs up there; the edge's fray, -1 to 1, as much as a pixel holds of it;
// how long the film lasts here, per its usual; how much of what the waves strand gathers here;
// how high each of the six waves round the one landing now runs up, wave k in slot k mod 6, so
// the corners of a piece of the mesh agree on each wave a pixel between them needs, though a
// wave may land between them: the two last landed there, and the two coming in (swashBore).
struct SwashPlace {
  lands: f32,
  rise: f32,
  runs: f32,
  fray: f32,
  patches: f32,
  gathers: f32,
  runUps: vec4f, // slots 0 to 3
  runUp4: f32, // slots 4 and 5
  runUp5: f32,
}

const SWASH_SLOTS: i32 = 6;

fn swashSlot(k: f32) -> i32 {
  return (i32(k) % SWASH_SLOTS + SWASH_SLOTS) % SWASH_SLOTS;
}

// How high wave k runs up at a place whose slots hold it.
fn swashPlaceRunUp(place: SwashPlace, k: f32) -> f32 {
  let i = swashSlot(k);
  return select(select(select(select(select(place.runUp5, place.runUp4, i == 4), place.runUps.w, i == 3), place.runUps.z, i == 2), place.runUps.y, i == 1), place.runUps.x, i == 0);
}

// The place at world xz; shore: m to the nearest waterline (seaAt().x), inland: the way
// inland (seaShoreAt().xy).
fn swashPlace(xz: vec2f, shore: f32, inland: vec2f) -> SwashPlace {
  let beach = seaBeachAt(xz);
  let ao = terrainCove(xz);
  let foot = ao + inland * shore;
  var place: SwashPlace;
  place.lands = beach.x;
  place.rise = beach.z;
  place.runs = swashRunsBy(beach.y);
  place.fray = seededNoise(ao / swash.uSwashSheet.w, SWASH_FRAY_SEED);
  place.patches = 1.0 + swash.uSwashFilm.y * seededNoise(ao / swash.uSwashFilm.z, SWASH_FILM_SEED);
  place.gathers = max(0.35 + 0.9 * seededNoise(ao / swash.uSwashLook.y, SWASH_LINE_SEED), 0.0);
  let n = floor((frame.uWaveSeconds - beach.x) / swash.uSwashTime.w);
  var slots: array<f32, SWASH_SLOTS>;
  for (var i = -2; i <= 3; i++) {
    let k = n + f32(i);
    slots[swashSlot(k)] = swashRunUp(k, place.runs, foot);
  }
  place.runUps = vec4f(slots[0], slots[1], slots[2], slots[3]);
  place.runUp4 = slots[4];
  place.runUp5 = slots[5];
  return place;
}

// The beach at world xz, its ground `ground` m above the still sea, its edges as soft as
// `width` m in height; shore: m to the nearest waterline (seaAt().x), inland: the way
// inland (seaShoreAt().xy).
fn swashAt(xz: vec2f, ground: f32, shore: f32, inland: vec2f, width: f32) -> Swash {
  return swashFrom(swashPlace(xz, shore, inland), ground, width, 0.0, 0.0);
}

// The beach at a place, its ground `ground` m above the still sea, its edges as soft as
// `width` m in height; swell: how high the waves coming in stand there, and fill: how much of
// the edge drawn down the next has refilled there (swashBore).
fn swashFrom(place: SwashPlace, ground: f32, width: f32, swell: f32, fill: f32) -> Swash {
  let sheet = swash.uSwashSheet;
  let runs = place.runs;
  // The edge's fray, until a pixel is too tall to hold it.
  let fray = sheet.z * (1.0 - smoothstep(0.5, 1.5, width / max(sheet.z, 1e-6)));
  let g = ground + fray * place.fray;
  let period = swash.uSwashTime.w;
  // Its run-up starts as the foot of its bore's broken face reaches the waterline, a little before its crest.
  let since = frame.uWaveSeconds - place.lands + swash.uSwashBoreFace.y * period;
  let n = floor(since / period);
  var out = Swash(-1e9, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, runs, place.rise, -1e9);
  var thick = 0.0;
  let d = swash.uSwashTime.z * runs;
  // The waves coming in reach the waterline at c0, and cross the edge drawn down at about c0 and cD (swashBore).
  let scale = swash.uSwashBore.x * runs;
  let c0 = sqrt(SWASH_G * scale);
  let cD = sqrt(SWASH_G * (d + scale));
  // Its front as white as its bore's roller as it lands (swashBore): as much as it runs up, and in
  // places along the beach.
  let whitens = swash.uSwashBoreFoam.x * (0.4 + 0.6 * place.gathers) / (SWASH_FRONT_MOST * runs);
  for (var j = 0; j < 2; j++) {
    let k = n - f32(j);
    let r = swashPlaceRunUp(place, k);
    let w = swashWave(since - k * period, r, d, place.rise, g, place.patches, width, c0, whitens * r);
    out.level = max(out.level, w.tip);
    out.top = max(out.top, w.top);
    thick = max(thick, w.thick);
    out.foam += w.foam;
    out.line += w.line;
    out.film = max(out.film, w.film);
    out.soaked = max(out.soaked, w.soaked);
    out.milk = max(out.milk, w.milk);
  }
  // The next wave's bore crosses the edge drawn down, to reach the still waterline as it lands,
  // its front white with the foam it carries on into its run-up where its face has come (fill).
  let crosses = 2.0 * d / max(place.rise, SWASH_LEAST) / (cD + c0);
  let ahead = since - (n + 1.0) * period;
  if (ahead > -crosses) {
    let edge = d * ahead / crosses;
    out.level = max(out.level, edge);
    out.top = max(out.top, out.level);
    out.foam += whitens * swashPlaceRunUp(place, n + 1.0) * fill * smoothstep(-crosses, -0.5 * crosses, ahead) * swashFrontFoam(edge - g, width);
  }
  // The last of the film is gone, so the ground beside it is bare, as it was drawn.
  out.film = max(out.film - SWASH_FILM_GONE, 0.0) / (1.0 - SWASH_FILM_GONE);
  // What they strand gathers in places along the beach.
  out.line *= place.gathers;
  // The sea at the edge drawn down with it, less and less deeper out, until the next wave's face
  // refills it, and the waves coming in.
  let sea = min(out.level, 0.0) * exp(min(g, 0.0) / SWASH_SEA_DRAWN) * (1.0 - fill) + swell;
  out.cover = max(max(thick, sea - g), 0.0);
  return out;
}

struct SwashBore {
  height: f32, // m above the still sea
  slope: f32, // how it rises per m further out, as its face leans in
  foam: f32, // how much foam its break leaves, as the beach's
  milk: f32, // how white with sand and bubbles the water it broke in is
  along: f32, // m its foam has drifted inland
  lean: f32, // m the water here has moved inland, its top outrunning its foot
  drift: f32, // m what the last wave to pass stirred up has drifted inland with it
  wave: f32, // that wave's number
  crest: f32, // how near the top of the nearest crest the water here stands, 0 to 1
  across: f32, // m through that crest at this height, front to back
  fill: f32, // how much of the edge the last backwash drew down the next wave has refilled here (swashFrom)
}

// The waves as they come in over the last of the shallows at a place, `shore` m out from
// the waterline nearest, over `depth` m of water as the sea map has it (water/swash.js bore).
fn swashBore(place: SwashPlace, shore: f32, depth: f32) -> SwashBore {
  var out = SwashBore(0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0);
  let bore = swash.uSwashBore;
  let face = swash.uSwashBoreFace;
  let foam = swash.uSwashBoreFoam;
  let within = swash.uSwashBoreWithin;
  let period = swash.uSwashTime.w;
  if (depth >= bore.z || shore >= within.y) {
    return out;
  }
  if (depth <= 0.0) {
    // Past the waterline as the map has it, only how near the next wave's face has come to it:
    // the ground as drawn may lie lower.
    let f = fract((frame.uWaveSeconds - place.lands) / period);
    out.fill = exp(-((1.0 - f) / face.y) * ((1.0 - f) / face.y));
    return out;
  }
  let scale = bore.x * place.runs;
  let c0 = sqrt(SWASH_G * scale);
  let c = sqrt(SWASH_G * (depth + scale));
  let phase = (frame.uWaveSeconds - place.lands + 2.0 * max(shore, 0.0) / (c + c0)) / period;
  let k = floor(phase);
  let f = phase - k;
  // Out of the lagoon's own waves, by the last of the shallows: not over a reef's flat, far from
  // any beach; on to the waterline, its height ending over the last centimetre of water.
  let appear = (1.0 - smoothstep(bore.w, bore.z, depth)) * (1.0 - smoothstep(within.x, within.y, shore));
  let ends = smoothstep(0.0, SWASH_BORE_ENDS, depth);
  var tall = vec2f(0.0);
  var broke = vec2f(0.0);
  var share = vec2f(0.0);
  var fronts = vec2f(0.0);
  for (var j = 0; j < 2; j++) {
    let runsUp = swashPlaceRunUp(place, k + f32(j));
    let comes = bore.x * runsUp;
    let breaksAt = pow(comes / bore.y, 0.8);
    // Broken, as tall as the water is deep, but no lower than the sheet it collapses into at the waterline.
    tall[j] = appear * ends * min(comes / sqrt(sqrt(depth)), length(vec2f(bore.y * depth, swash.uSwashSheet.x * runsUp)));
    broke[j] = smoothstep(0.0, 1.0, (breaksAt - depth) / (face.w * breaksAt + 0.01));
    share[j] = comes / scale;
    // Its face steepens as it nears where it breaks, and stays steep once it has.
    fronts[j] = mix(face.x, face.y, max(broke[j], 1.0 - smoothstep(breaksAt, within.w * breaksAt, depth)));
  }
  let behind = exp(-(f / face.z) * (f / face.z));
  let before = exp(-((1.0 - f) / fronts.y) * ((1.0 - f) / fronts.y));
  // Less its mean over the period, so it raises the sea no higher on average.
  let mean = 0.886 * ((1.0 - f) * tall.x * (face.z + fronts.x) + f * tall.y * (face.z + fronts.y));
  let crests = tall.x * behind + tall.y * before;
  out.height = crests - mean;
  let rising = -2.0 * f * tall.x * behind / (face.z * face.z) + 2.0 * (1.0 - f) * tall.y * before / (fronts.y * fronts.y);
  // Its top outruns its foot: the water moves inland as far as it stands, so its face leans in,
  // squeezed steeper than its height alone makes it, the steeper the more, and its back eases.
  out.lean = within.z * crests;
  let raw = rising / (period * c);
  out.slope = raw / max(1.0 - within.z * raw, 0.1);
  // Near its top a crest is thin: m through it at this height, its face's width and its back's.
  let nearest = select(before, behind, behind * tall.x > before * tall.y);
  out.crest = select(0.0, nearest, max(tall.x, tall.y) > 0.0);
  out.across = sqrt(max(-log(max(out.crest, 1e-4)), 0.0)) * (select(fronts.y, fronts.x, behind * tall.x > before * tall.y) + face.z) * period * c;
  // Its foam, thick in the roller at its front, then thinning behind it into patches; at the
  // waterline its run-up's front carries it on.
  let roll = swash.uSwashBoreRoll;
  let trails = appear * foam.x * broke.x * share.x * mix(exp(-f / roll.x), exp(-f / foam.y), roll.y);
  let leads = appear * foam.x * broke.y * share.y * exp(-((1.0 - f) / foam.z) * ((1.0 - f) / foam.z));
  // It breaks whiter in places along the beach, where the foam it strands gathers too.
  out.foam = (trails + leads) * (0.4 + 0.6 * place.gathers);
  out.milk = appear * swash.uSwashLook.w * min(broke.x * share.x * exp(-f / (2.0 * foam.y)), 1.0);
  // The foam drifts with the wave that made it: the next one's on its face, ahead of it, once
  // what the last one left has gone (a blend of the two would stretch it across the front).
  let since = frame.uWaveSeconds - place.lands - k * period;
  out.along = foam.w * c0 * select(since, since - period, f > SWASH_BORE_NEXT);
  out.drift = foam.w * c0 * since;
  out.wave = k;
  // The edge drawn down after the last wave fills as the next one's face passes; once its crest
  // has passed, until it lands at the waterline, it stays full.
  out.fill = select(before, 1.0, k > floor((frame.uWaveSeconds - place.lands + face.y * period) / period));
  return out;
}
