// Tool fixture: a sunset sky from 5 to over 400 times the bars' brightness. See silhouette.js.

#include "card.wgsl"
#include "chunks/scene-output.wgsl"

@fragment
fn fragmentMain(in: Varyings) -> @location(0) vec4f {
  let sky = mix(vec3f(6.0, 3.0, 1.5), vec3f(1.5, 1.5, 3.0), in.vUv.y);
  let sun = exp(-12.0 * length((in.vUv - vec2f(0.55, 0.45)) * vec2f(1.78, 1.0)));
  return sceneOutput(sky + vec3f(12.0, 8.0, 4.0) * sun, 1.0);
}
