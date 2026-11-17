// The ripples the waves build on the sand under shallow water (PLAN.md 7.6): ripples whose
// crests lie along the shore, a hand apart in the shallows and wider deeper, wandering and
// fading in patches. Where the waves break and run in, over the last few tenths of a metre of
// depth, they plane the sand flat; seaward of that the ripples come in, their crests peaked over
// broad troughs, each rising and fading along its length, so they end and start again as a
// field of real ones does rather than run on in rows like corduroy. The terrain draws them on
// the sand just under the waterline (world/terrain.wgsl), the water on the floor beyond
// (water/water-seabed.wgsl): the same at the same place, so there is no seam between them.

#include "noise.wgsl"

// The two sets: m between crests, in the shallows and deeper; how steep they stand at most
// (ripples stand about 0.15 as tall as they are long).
const SEA_RIPPLES = vec2f(0.09, 0.15);
const SEA_RIPPLE_SLOPE: f32 = 0.4;
// m of depth over which they come in, seaward of where the waves plane the sand: the beach's
// waves break about 0.2 m deep (config.water.swash.bore.breaks), and run in as bores from there.
const SEA_RIPPLES_PLANED = vec2f(0.2, 0.55);
// How peaked their crests stand over their troughs: their second harmonic's share of their height.
const SEA_RIPPLE_PEAK: f32 = 0.2;

// Their slope (dh/dx, dh/dz, world) at world xz, `depth` m under the sea, their crests across
// `inland` (world, unit), for a pixel `footprint` m wide: each set drops out once a pixel
// can't hold it.
fn seaRipples(xz: vec2f, inland: vec2f, depth: f32, footprint: f32) -> vec2f {
  let shows = smoothstep(SEA_RIPPLES_PLANED.x, SEA_RIPPLES_PLANED.y, depth) * (1.0 - smoothstep(4.0, 8.0, depth)) * (1.0 - smoothstep(SEA_RIPPLES.y / 6.0, SEA_RIPPLES.y / 2.5, footprint));
  var slope = vec2f(0.0);
  if (shows > 0.0) {
    // Their crests wander, in wavelengths, over a few metres and over a metre; and the gradient of that, per m.
    let wide = gradientNoiseD(xz * 0.35 + vec2f(1.7, -3.1));
    let close = gradientNoiseD(xz * 1.3 - vec2f(4.2, 0.6));
    let wander = 1.5 * wide.x + 0.8 * close.x;
    let bends = 1.5 * 0.35 * wide.yz + 0.8 * 1.3 * close.yz;
    let patchy = smoothstep(-0.45, 0.4, gradientNoise(xz * 0.17 - vec2f(2.3, 7.9)));
    // Each crest rises and fades over a metre or so along its length, its neighbours a few
    // crests over elsewhere along theirs.
    let along = vec2f(-inland.y, inland.x);
    let lengths = smoothstep(-0.25, 0.4, gradientNoise(vec2f(2.2 * dot(xz, inland), 0.8 * dot(xz, along)) + vec2f(5.3, -1.7)));
    let deeper = smoothstep(0.3, 1.5, depth);
    for (var i = 0; i < 2; i++) {
      let apart = select(SEA_RIPPLES.x, SEA_RIPPLES.y, i == 1);
      let weight = select(1.0 - deeper, deeper, i == 1) * (1.0 - smoothstep(apart / 6.0, apart / 2.5, footprint));
      let k = 6.2831853 / apart;
      let turns = 6.2831853 * (1.0 + 0.3 * f32(i));
      let phase = k * dot(xz, inland) + turns * wander;
      // Across the crests: the way inland, bent as they wander.
      let across = k * inland + turns * bends;
      // The height sin(phase) - peak cos(2 phase), over 1 + peak: its crests sharpened, its troughs broadened.
      let rise = cos(phase) * (1.0 + 4.0 * SEA_RIPPLE_PEAK * sin(phase)) / (1.0 + SEA_RIPPLE_PEAK);
      slope += weight * SEA_RIPPLE_SLOPE / k * rise * across;
    }
    slope *= shows * patchy * lengths;
  }
  return slope;
}
