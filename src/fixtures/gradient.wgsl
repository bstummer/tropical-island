// Tool fixture: two slow horizontal gradients (linear radiance). See gradient.js.

#include "card.wgsl"
#include "chunks/scene-output.wgsl"

@fragment
fn fragmentMain(in: Varyings) -> @location(0) vec4f {
  let grey = vec3f(mix(0.20, 0.26, in.vUv.x));
  let sky = mix(vec3f(0.10, 0.25, 0.60), vec3f(0.12, 0.29, 0.66), in.vUv.x);
  return sceneOutput(select(sky, grey, in.vUv.y > 0.5), 1.0);
}
