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
  uSwashLook: vec4f, // how white the uprush is; m along the beach over which the line gathers in places
  uSwashSets: vec4f, // the surf's sets (water/surf.js): the waves each of two beats goes round over, how far each moves a size, the smallest's share
  uSwashAlong: vec4f, // per beat: how a wave's size varies along it, rad/m, and how many turns it moves along it
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
}

// Wave k, landed tau s ago, run up r m from d m below the still sea, where every wave of
// this beach leaves the edge, over ground g (frayed) on a beach rising `rise` per metre,
// its edges as soft as `width` m in height, a pixel's.
fn swashWave(tau: f32, r: f32, d: f32, rise: f32, g: f32, patches: f32, width: f32) -> SwashWave {
  let time = swash.uSwashTime;
  let sheet = swash.uSwashSheet;
  let foamLook = swash.uSwashFoam;
  let soft = max(width, 1e-4);
  let up = time.x * sqrt(2.0 * r / SWASH_G) / clamp(rise, SWASH_LEAST, SWASH_STEEPEST);
  let down = time.y * up;
  let fades = 1.0 - smoothstep(SWASH_FADES.x * time.w, SWASH_FADES.y * time.w, tau);
  var w = SwashWave(-d, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0);
  if (tau < up) {
    // Running up: fast at first, slowing to a stop at r.
    let s = tau / up;
    w.tip = -d + (r + d) * (1.0 - (1.0 - s) * (1.0 - s));
    let behind = w.tip - g;
    let under = smoothstep(-soft, soft, behind);
    let b = max(behind, 0.0);
    w.thick = under * sheet.x * r * (1.0 - exp(-b / (sheet.y * r)));
    // What it carries grows in as it starts: where it lands it takes over from the last wave, which carries none.
    let starts = smoothstep(0.0, 0.2, s);
    w.foam = starts * under * foamLook.x * (1.0 - 0.6 * s) * (exp(-b / foamLook.y) + 0.35 * exp(-b / (5.0 * foamLook.y)));
    w.film = under;
    w.soaked = under;
    w.milk = starts * under * swash.uSwashLook.x * (1.0 - 0.5 * s);
  } else {
    // Draining back, slow at first and gathering speed, to d below the still sea.
    let s = min((tau - up) / down, 1.0);
    if (tau - up < down) {
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
      let left = up + down * sqrt(max((r - g) / (r + d), 0.0));
      let since = max(tau - left, 0.0);
      film = exp(-since / (swash.uSwashFilm.x * (0.3 + 0.7 * smoothstep(0.0, r, r - g)) * patches));
      soaked = exp(-since / swash.uSwashFilm.w);
      drag = swash.uSwashMore.x * (1.0 - s) * exp(-(r - g) / (foamLook.y + 0.5 * (r - max(w.tip, -d))));
    }
    w.thick = under * sheet.x * r * (1.0 - 0.7 * s) * (1.0 - exp(-b / (sheet.y * r)));
    w.milk = under * swash.uSwashLook.x * 0.5 * (1.0 - s) * (1.0 - s);
    w.film = under + (1.0 - under) * film;
    w.soaked = under + (1.0 - under) * soaked;
    // Its foam where it turned, lingering, a line no thinner than the pixel and as much in all;
    // the backwash drags some of it back down.
    let lingering = exp(-(tau - up) / foamLook.z);
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
  let run = swash.uSwashRun;
  return run.x * (run.z + (1.0 - run.z) * smoothstep(0.0, run.y, seaBeachAt(xz).y));
}

// The beach at world xz, its ground `ground` m above the still sea, its edges as soft as
// `width` m in height; shore: m to the nearest waterline (seaAt().x), inland: the way
// inland (seaShoreAt().xy).
fn swashAt(xz: vec2f, ground: f32, shore: f32, inland: vec2f, width: f32) -> Swash {
  let beach = seaBeachAt(xz);
  let runs = swashRuns(xz);
  let ao = terrainCove(xz);
  let foot = ao + inland * shore;
  let sheet = swash.uSwashSheet;
  // The edge's fray, until a pixel is too tall to hold it.
  let fray = sheet.z * (1.0 - smoothstep(0.5, 1.5, width / max(sheet.z, 1e-6)));
  let g = ground + fray * seededNoise(ao / sheet.w, SWASH_FRAY_SEED);
  let patches = 1.0 + swash.uSwashFilm.y * seededNoise(ao / swash.uSwashFilm.z, SWASH_FILM_SEED);
  let period = swash.uSwashTime.w;
  let n = floor((frame.uWaveSeconds - beach.x) / period);
  var out = Swash(-1e9, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, runs, beach.z);
  var thick = 0.0;
  for (var j = 0; j < 2; j++) {
    let k = n - f32(j);
    let w = swashWave(frame.uWaveSeconds - beach.x - k * period, swashRunUp(k, runs, foot), swash.uSwashTime.z * runs, beach.z, g, patches, width);
    out.level = max(out.level, w.tip);
    thick = max(thick, w.thick);
    out.foam += w.foam;
    out.line += w.line;
    out.film = max(out.film, w.film);
    out.soaked = max(out.soaked, w.soaked);
    out.milk = max(out.milk, w.milk);
  }
  // What they strand gathers in places along the beach.
  out.line *= max(0.35 + 0.9 * seededNoise(ao / swash.uSwashLook.y, SWASH_LINE_SEED), 0.0);
  // The sea at the edge drawn down with it, less and less deeper out.
  let sea = min(out.level, 0.0) * exp(min(g, 0.0) / SWASH_SEA_DRAWN);
  out.cover = max(max(thick, sea - g), 0.0);
  return out;
}
