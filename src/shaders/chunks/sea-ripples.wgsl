// The ripples the waves build on the sand under shallow water (PLAN.md 7.6): the beach's
// rumples run on under the sea into ripples whose crests lie along the shore, a hand apart in
// the shallows and wider deeper, wandering, forking and fading in patches. The terrain draws
// them on the sand just under the waterline (world/terrain.wgsl), the water on the floor beyond
// (water/water-seabed.wgsl): the same at the same place, so there is no seam between them.

#include "noise.wgsl"

// The two sets: m between crests, in the shallows and deeper; how steep they stand at most
// (ripples stand about 0.15 as tall as they are long).
const SEA_RIPPLES = vec2f(0.09, 0.15);
const SEA_RIPPLE_SLOPE: f32 = 0.4;

// Their slope (dh/dx, dh/dz, world) at world xz, `depth` m under the sea, their crests across
// `inland` (world, unit), for a pixel `footprint` m wide: each set drops out once a pixel
// can't hold it.
fn seaRipples(xz: vec2f, inland: vec2f, depth: f32, footprint: f32) -> vec2f {
  let shows = smoothstep(0.02, 0.08, depth) * (1.0 - smoothstep(4.0, 8.0, depth)) * (1.0 - smoothstep(SEA_RIPPLES.y / 6.0, SEA_RIPPLES.y / 2.5, footprint));
  var slope = vec2f(0.0);
  if (shows > 0.0) {
    // Their crests wander and fork, in wavelengths.
    let wander = 0.7 * gradientNoiseD(xz * 0.35 + vec2f(1.7, -3.1)) + 0.3 * gradientNoiseD(xz * 1.3 - vec2f(4.2, 0.6)) * vec3f(1.0, 1.3 / 0.35, 1.3 / 0.35);
    let patchy = smoothstep(-0.45, 0.4, gradientNoise(xz * 0.17 - vec2f(2.3, 7.9)));
    let deeper = smoothstep(0.3, 1.5, depth);
    for (var i = 0; i < 2; i++) {
      let apart = select(SEA_RIPPLES.x, SEA_RIPPLES.y, i == 1);
      let weight = select(1.0 - deeper, deeper, i == 1) * (1.0 - smoothstep(apart / 6.0, apart / 2.5, footprint));
      let k = 6.2831853 / apart;
      let phase = k * dot(xz, inland) + 6.2831853 * wander.x * (1.0 + 0.3 * f32(i));
      // Across the crests: the way inland, bent as they wander.
      let across = k * inland + 6.2831853 * (1.0 + 0.3 * f32(i)) * 0.35 * wander.yz;
      slope += weight * SEA_RIPPLE_SLOPE / k * cos(phase) * across;
    }
    slope *= shows * patchy;
  }
  return slope;
}
