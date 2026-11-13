// The swell's waves that reach the reef: water/surf.js's twin, which says what they
// are. How its foam looks: water-foam.wgsl.

#include "/chunks/pi.wgsl"
#include "/chunks/noise.wgsl"

struct SurfSettings {
  uSurfTiming: vec4f, // s between waves; m/s over deep water; how far it stands in the open sea (m); how fast it rises as it slows
  uSurfWay: vec4f, // the swell's way (x, z); m seaward of the crest over which it fades into the open sea, from and to
  uSurfWave: vec4f, // the most it stands per m of water; the smallest wave's share; the shares of its period behind its crest, and in front
  uSurfFoam: vec4f, // m it dies over running in; m seaward its foam starts; m that dies over; how much foam always lies on the crest
  uSurfBreak: vec4f, // how much foam what it lost brings; how fast a wave's fades in its period; the share of its period its foam runs ahead of it; the most it draws down per m of water
  uSurfSets: vec4f, // the waves each of a set's two beats goes round over; how far each moves a wave's size
  uSurfAlong: vec4f, // per beat: how a wave's size varies along its crest, rad/m, and how many turns it moves along it over the beat
  uSurfWander: array<vec4f, 5>, // its front's wander, per term: m, and rad/m along x and z
  uSurfStands: f32, // m: how high whitewater stands off the water where it breaks hardest
  uSurfLumps: vec3f, // how much more or less of a wave breaks in lumps along its crest; m across; waves in the loop
}

const SURF_LUMP_SEED: u32 = 7867u;

// How much more or less of wave n breaks at xz: lumps along its crest, each wave its own (water/surf.js).
fn surfLumps(n: f32, xz: vec2f) -> f32 {
  let waves = surf.uSurfLumps.z;
  return 1.0 + surf.uSurfLumps.x * seededNoise(xz / surf.uSurfLumps.y, SURF_LUMP_SEED + u32(n - waves * floor(n / waves)));
}

@group(1) @binding(13) var<uniform> surf: SurfSettings;

// The share of a full wave, in its set and along its length.
fn surfSize(n: f32, across: f32) -> f32 {
  let sets = surf.uSurfSets;
  let beat = clamp(0.5 + sets.z * sin(2.0 * PI * n / sets.x) + sets.z * sin(2.0 * PI * n / sets.y), 0.0, 1.0);
  let along = 0.5 + 0.25 * sin(across * surf.uSurfAlong.x + 2.0 * PI * surf.uSurfAlong.y * n / sets.x) + 0.25 * sin(across * surf.uSurfAlong.z + 2.0 * PI * surf.uSurfAlong.w * n / sets.y);
  return (surf.uSurfWave.y + (1.0 - surf.uSurfWave.y) * beat * beat) * (0.6 + 0.7 * along);
}

struct Surf {
  foam: f32,
  height: f32,
  slope: f32, // along the way it runs
}

// sea, shore, wave: seaAt(), seaShoreAt(), seaWaveAt() at xz; wide: how wide a pixel is
// along the water (m), 0 for the surface's shape; t: wrapped as the waves' time is.
fn surfAt(sea: vec4f, shore: vec4f, wave: vec4f, wide: f32, xz: vec2f, t: f32) -> Surf {
  let reef = shore.w;
  if (sea.z <= 0.0 || reef >= surf.uSurfWay.w) {
    return Surf(0.0, 0.0, 0.0);
  }
  // Its front wanders a few metres, at sizes from hundreds of metres to a few.
  var wander = 0.0;
  for (var k = 0; k < 5; k++) {
    let term = surf.uSurfWander[k];
    wander += term.x * sin(dot(xz, term.yz));
  }
  let period = surf.uSurfTiming.x;
  let deep = surf.uSurfTiming.y;
  let speed = wave.w;
  let phase = (t - dot(xz, surf.uSurfWay.xy) / deep - wave.x - wander / speed) / period;
  let n = floor(phase);
  let f = phase - n;
  let across = xz.x * surf.uSurfWay.y - xz.y * surf.uSurfWay.x;
  let now = surfSize(n, across);
  let next = surfSize(n + 1.0, across);

  // How tall each stands here: taller as it slows, no more than what's left of the swell, or the water lets it.
  let rises = surf.uSurfTiming.z * pow(deep / speed, surf.uSurfTiming.w);
  let held = sqrt(sea.z);
  let most = surf.uSurfWave.x * max(sea.y, 0.0);
  let nowTall = min(rises * min(now, held), most);
  let nextTall = min(rises * min(next, held), most);
  let stands = mix(nowTall, nextTall, f);
  let dies = exp(min(reef, 0.0) / surf.uSurfFoam.x) * (1.0 - smoothstep(surf.uSurfWay.z, surf.uSurfWay.w, reef));
  // A long round wave at sea; by the reef a peak with a steep face, and flat water ahead of it; round again as it dies on the flat.
  let peak = smoothstep(0.15, 0.6, 1.0 - speed / deep) * exp(min(reef, 0.0) / surf.uSurfFoam.x);
  let back = surf.uSurfWave.z;
  let front = surf.uSurfWave.w;
  let behind = exp(-(f / back) * (f / back));
  let before = exp(-((1.0 - f) / front) * ((1.0 - f) / front));
  let height = mix(0.5 * stands * cos(2.0 * PI * f), nowTall * behind + nextTall * before - 0.886 * (back + front) * stands, peak);
  let rising = mix(-PI * stands * sin(2.0 * PI * f), -2.0 * f * nowTall * behind / (back * back) + 2.0 * (1.0 - f) * nextTall * before / (front * front), peak);

  // What the water took from it breaks, and whitens it as long as it does, less and less running
  // in, and none of it is left when the next one comes.
  let last = exp(-surf.uSurfBreak.y);
  let fading = (exp(-f * surf.uSurfBreak.y) - last) / (1.0 - last);
  let toe = (1.0 - f) / surf.uSurfBreak.z;
  let coming = exp(-toe * toe);
  let swell = sea.z;
  // A pixel across more than a good part of a wave sees what it holds on average, or it would blink as each goes by.
  let melts = smoothstep(0.15, 0.7, wide / (speed * period));
  let breaking = shore.z * (1.0 - smoothstep(0.0, surf.uSurfFoam.y, reef)) * smoothstep(0.0, 0.05, sea.z) * exp(min(reef, 0.0) / surf.uSurfFoam.z);
  var behindLost = 0.0;
  var aheadLost = 0.0;
  if (breaking > 0.0) {
    behindLost = max(now - swell, 0.0) * surfLumps(n, xz);
    aheadLost = max(next - swell, 0.0) * surfLumps(n + 1.0, xz);
  }
  let whiter = behindLost * fading + aheadLost * coming;
  // On average over a period: what follows a crest, and what runs ahead of the next, whose mean is toe x root pi / 2.
  let mean = max(mix(now, next, f) - swell, 0.0) * (((1.0 - last) / surf.uSurfBreak.y - last) / (1.0 - last) + 0.8862 * surf.uSurfBreak.z);
  let lost = mix(whiter, mean, melts);
  let foam = breaking * (surf.uSurfFoam.w + surf.uSurfBreak.x * lost);
  // What breaks stands up off the water, as tall as uSurfStands where it breaks hardest, and
  // hides what lies behind it itself.
  let standing = surf.uSurfStands * breaking * exp(-surf.uSurfBreak.x * whiter);
  let losing = -surf.uSurfBreak.y * behindLost * exp(-f * surf.uSurfBreak.y) / (1.0 - last) + 2.0 * toe / surf.uSurfBreak.z * aheadLost * coming;
  // It draws down no more than the shallows spare: the reef's crest stays under.
  let surface = max(dies * height, -surf.uSurfBreak.w * max(sea.y, 0.0)) + surf.uSurfStands * breaking * (1.0 - exp(-surf.uSurfBreak.x * whiter));
  return Surf(foam, surface, -(1.0 - melts) * (dies * rising + standing * surf.uSurfBreak.x * losing) / (speed * period));
}
