// The swell's waves that reach the reef: water/surf.js's twin, which says what they
// are. How its foam looks: water-foam.wgsl.

#include "/chunks/pi.wgsl"

struct SurfSettings {
  uSurfTiming: vec4f, // s between waves; m/s over deep water; how far it stands in the open sea (m); how fast it rises as it slows
  uSurfWay: vec4f, // the swell's way (x, z); m seaward of the crest over which it fades into the open sea, from and to
  uSurfWave: vec4f, // the most it stands per m of water; the smallest wave's share; the shares of its period behind its crest, and in front
  uSurfFoam: vec4f, // m it dies over running in; m seaward its foam starts; m that dies over; how much foam always lies on the crest
  uSurfBreak: vec4f, // how much foam what it lost brings; how fast a wave's fades in its period; the share of its period its foam runs ahead of it; the most it draws down per m of water
}

@group(1) @binding(13) var<uniform> surf: SurfSettings;

// The share of a full wave, in its set and along its length.
fn surfSize(n: f32, across: f32) -> f32 {
  let beat = clamp(0.5 + 0.35 * sin(2.0 * PI * n / 8.0) + 0.35 * sin(2.0 * PI * n / 5.0), 0.0, 1.0);
  let along = 0.5 + 0.25 * sin(across * 0.031 + 2.0 * PI * 3.0 * n / 8.0) + 0.25 * sin(across * 0.0127 + 2.0 * PI * 2.0 * n / 5.0);
  return (surf.uSurfWave.y + (1.0 - surf.uSurfWave.y) * beat * beat) * (0.6 + 0.7 * along);
}

struct Surf {
  foam: f32,
  height: f32,
  slope: f32, // along the way it runs
}

// sea, shore, wave: seaAt(), seaShoreAt(), seaWaveAt() at xz; hides: how far (m) whitewater
// reaches past its ground as seen from here, as what stands off the water can; wide: how
// wide a pixel is along the water (m); t: wrapped as the waves' time is.
fn surfAt(sea: vec4f, shore: vec4f, wave: vec4f, hides: f32, wide: f32, xz: vec2f, t: f32) -> Surf {
  let reef = shore.w;
  if (sea.z <= 0.0 || reef >= surf.uSurfWay.w) {
    return Surf(0.0, 0.0, 0.0);
  }
  // Its front wanders a few metres, at sizes from hundreds of metres to a few.
  let wander = 3.0 * sin(dot(xz, vec2f(0.021, 0.013))) + 2.0 * sin(dot(xz, vec2f(-0.017, 0.037))) + 0.5 * sin(dot(xz, vec2f(0.21, 0.13))) + 0.4 * sin(dot(xz, vec2f(0.71, 0.43))) + 0.2 * sin(dot(xz, vec2f(-0.93, 1.37)));
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

  // What the water took from it breaks, and whitens it as long as it does, less and less running in.
  let fading = exp(-f * surf.uSurfBreak.y);
  let toe = (1.0 - f) / surf.uSurfBreak.z;
  let coming = exp(-toe * toe);
  // Seen from far off, what stands off the water hides the ground behind it, as if the wave broke sooner.
  let hidden = reef / max(hides, 1e-3);
  let swell = sea.z * (1.0 - smoothstep(0.0, 0.25, hidden) * (1.0 - smoothstep(0.25, 1.0, hidden)));
  // A pixel across more than a good part of a wave sees what it holds on average, or it would blink as each goes by.
  let melts = smoothstep(0.15, 0.7, wide / (speed * period));
  let whiter = max(now - swell, 0.0) * fading + max(next - swell, 0.0) * coming;
  let mean = max(mix(now, next, f) - swell, 0.0) * (1.0 - exp(-surf.uSurfBreak.y)) / surf.uSurfBreak.y;
  let lost = mix(whiter, mean, melts);
  let foam = shore.z * (1.0 - smoothstep(0.0, surf.uSurfFoam.y, reef - hides)) * smoothstep(0.0, 0.05, sea.z) * exp(min(reef + hides, 0.0) / surf.uSurfFoam.z) * (surf.uSurfFoam.w + surf.uSurfBreak.x * lost);
  // It draws down no more than the shallows spare: the reef's crest stays under.
  return Surf(foam, max(dies * height, -surf.uSurfBreak.w * max(sea.y, 0.0)), -(1.0 - melts) * dies * rising / (speed * period));
}
