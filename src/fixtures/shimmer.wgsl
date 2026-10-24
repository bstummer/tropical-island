// Tool fixture: aliases on purpose on the left half. See shimmer.js.

#include "card.wgsl"
#include "chunks/scene-output.wgsl"

@fragment
fn fragmentMain(in: Varyings) -> @location(0) vec4f {
  // About 1.8 px per stripe at 1600 x 900, sampled once per pixel with no filtering.
  let stripes = step(0.5, fract((in.vUv.x + 0.6 * in.vUv.y) * 1400.0));
  let value = select(mix(0.2, 0.8, in.vUv.y), mix(0.1, 0.9, stripes), in.vUv.x < 0.5);
  return sceneOutput(vec3f(value), 1.0);
}
