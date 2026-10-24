// The rock's detail (textures/rock.js), its second pass: the first pass's
// heights turned into a normal by differences across a texel. rg: the
// normal's x and y (tangent space, z up), b: the albedo's factor, halved; a:
// how much of it is the second mineral.

#include "chunks/fullscreen.wgsl"

struct RockForm {
  uTile: f32, // m
  uTexels: f32, // across the tile
}

@group(1) @binding(0) var<uniform> rockForm: RockForm;
@group(1) @binding(1) var uHeights: texture_2d<f32>; // the first pass (rock-tile.wgsl), repeating
@group(1) @binding(2) var uHeightsSampler: sampler;

@fragment
fn fragmentMain(in: Fullscreen) -> @location(0) vec4f {
  let e = 1.0 / rockForm.uTexels;
  let here = textureSample(uHeights, uHeightsSampler, in.vUv);
  let dx = textureSample(uHeights, uHeightsSampler, in.vUv + vec2f(e, 0.0)).r - textureSample(uHeights, uHeightsSampler, in.vUv - vec2f(e, 0.0)).r;
  let dy = textureSample(uHeights, uHeightsSampler, in.vUv + vec2f(0.0, e)).r - textureSample(uHeights, uHeightsSampler, in.vUv - vec2f(0.0, e)).r;
  let slope = vec2f(dx, dy) / (2.0 * rockForm.uTile * e);
  let n = normalize(vec3f(-slope, 1.0));
  return vec4f(n.xy * 0.5 + 0.5, clamp(here.g * 0.5, 0.0, 1.0), here.b);
}
