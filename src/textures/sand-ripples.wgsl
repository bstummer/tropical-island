// Wind ripples on dry sand (textures/sand.js): a tile uTile metres across,
// the wind along x. Crests about uWavelength apart wander and fade in and
// out; each ripple rises gently on the side the wind comes from and falls
// steeply on the other. rgb: the normal (tangent space, z up) when the
// ripples stand uHeight metres high; a: height about its mean, 0.5 where the
// ripples die out, lower in the troughs and higher on the crests.

#include "chunks/fullscreen.wgsl"
#include "chunks/pi.wgsl"
#include "tileable.wgsl"

struct SandRipples {
  uTile: f32, // m
  uWavelength: f32, // m
  uHeight: f32, // m
  uTexels: f32, // across the tile
  uSeed: vec2f,
  uShift: vec2f, // tiles: shifted by whole ones, the texture is the same (fixtures/surfaces.js checks)
}

@group(1) @binding(0) var<uniform> sandRipples: SandRipples;

// Height at uv in the tile, -0.5 to 0.5 about its mean.
fn ripples(uv: vec2f) -> f32 {
  let cycles = floor(sandRipples.uTile / sandRipples.uWavelength + 0.5);
  // The crests wander: their phase shifts with slow noise, and faster noise
  // that bends them over a few wavelengths.
  var phase = cycles * uv.x;
  phase += 1.7 * tileFbm(uv * 3.0, 3.0, sandRipples.uSeed, 3);
  phase += 0.6 * tileNoise(uv * 21.0, 21.0, sandRipples.uSeed + 4.2);
  phase += 0.25 * tileNoise(uv * 53.0, 53.0, sandRipples.uSeed + 8.4);
  let t = fract(phase);
  // Gentle up the side the wind comes from, steep down the other; each side
  // averages a half, so the whole does too.
  var h = select(cos(0.5 * PI * (t - 0.68) / 0.32), sin(0.5 * PI * t / 0.68), t < 0.68);
  h = h * h - 0.5;
  // Patches where the ripples die out, so crests end every few wavelengths
  // and the field isn't even.
  var strength = smoothstep(-0.55, 0.25, tileFbm(uv * 6.0, 6.0, sandRipples.uSeed + 9.1, 2));
  strength *= smoothstep(-0.7, 0.1, tileNoise(uv * 37.0, 37.0, sandRipples.uSeed + 2.6));
  return h * strength;
}

@fragment
fn fragmentMain(in: Fullscreen) -> @location(0) vec4f {
  let uv = in.vUv + sandRipples.uShift;
  let e = 0.5 / sandRipples.uTexels; // half a texel, in uv
  let metres = 2.0 * e * sandRipples.uTile;
  let slope = vec2f(ripples(uv + vec2f(e, 0.0)) - ripples(uv - vec2f(e, 0.0)), ripples(uv + vec2f(0.0, e)) - ripples(uv - vec2f(0.0, e))) * sandRipples.uHeight / metres;
  let n = normalize(vec3f(-slope, 1.0));
  return vec4f(n * 0.5 + 0.5, 0.5 + 0.5 * ripples(uv));
}
