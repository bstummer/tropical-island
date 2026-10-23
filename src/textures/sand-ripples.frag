// Wind ripples on dry sand (textures/sand.js): a tile uTile metres across,
// the wind along x. Crests about uWavelength apart wander and fade in and
// out; each ripple rises gently on the side the wind comes from and falls
// steeply on the other. rgb: the normal (tangent space, z up) when the
// ripples stand uHeight metres high; a: height about its mean, 0.5 where the
// ripples die out, lower in the troughs and higher on the crests.

#include "tileable.glsl"

#ifndef PI
#define PI 3.14159265358979
#endif

uniform float uTile; // m
uniform float uWavelength; // m
uniform float uHeight; // m
uniform float uTexels; // across the tile
uniform vec2 uSeed;
uniform vec2 uShift; // tiles: shifted by whole ones, the texture is the same (fixtures/surfaces.js checks)

varying vec2 vUv;

// Height at uv in the tile, -0.5 to 0.5 about its mean.
float ripples(vec2 uv) {
  float cycles = floor(uTile / uWavelength + 0.5);
  // The crests wander: their phase shifts with slow noise, and faster noise
  // that bends them over a few wavelengths.
  float phase = cycles * uv.x;
  phase += 1.7 * tileFbm(uv * 3.0, 3.0, uSeed, 3);
  phase += 0.6 * tileNoise(uv * 21.0, 21.0, uSeed + 4.2);
  phase += 0.25 * tileNoise(uv * 53.0, 53.0, uSeed + 8.4);
  float t = fract(phase);
  // Gentle up the side the wind comes from, steep down the other; each side
  // averages a half, so the whole does too.
  float h = t < 0.68 ? sin(0.5 * PI * t / 0.68) : cos(0.5 * PI * (t - 0.68) / 0.32);
  h = h * h - 0.5;
  // Patches where the ripples die out, so crests end every few wavelengths
  // and the field isn't even.
  float strength = smoothstep(-0.55, 0.25, tileFbm(uv * 6.0, 6.0, uSeed + 9.1, 2));
  strength *= smoothstep(-0.7, 0.1, tileNoise(uv * 37.0, 37.0, uSeed + 2.6));
  return h * strength;
}

void main() {
  vec2 uv = vUv + uShift;
  float e = 0.5 / uTexels; // half a texel, in uv
  float metres = 2.0 * e * uTile;
  vec2 slope = vec2(ripples(uv + vec2(e, 0.0)) - ripples(uv - vec2(e, 0.0)), ripples(uv + vec2(0.0, e)) - ripples(uv - vec2(0.0, e))) * uHeight / metres;
  vec3 n = normalize(vec3(-slope, 1.0));
  gl_FragColor = vec4(n * 0.5 + 0.5, 0.5 + 0.5 * ripples(uv));
}
