// Fixture: see light.js. A plain diffuse surface under the shared lighting.

#include "world-mesh.wgsl"
#include "chunks/scene-output.wgsl"
#include "chunks/lighting.wgsl"

struct Light {
  uAlbedo: vec3f, // linear
}

@group(1) @binding(0) var<uniform> light: Light;

@fragment
fn fragmentMain(in: Varyings) -> @location(0) vec4f {
  let n = normalize(in.vNormal);
  let radiance = light.uAlbedo / PI * (sunLight(in.vWorldPos, n) + skyIrradiance(in.vWorldPos, n));
  return sceneOutput(aerialPerspective(radiance, in.vWorldPos), 1.0);
}
