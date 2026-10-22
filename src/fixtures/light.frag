// Fixture: see light.js. A plain diffuse surface under the shared lighting.

#include "chunks/scene-output.glsl"
#include "chunks/lighting.glsl"

uniform vec3 uAlbedo; // linear

centroid varying vec3 vWorldPos;
varying vec3 vNormal;

void main() {
  vec3 n = normalize(vNormal);
  vec3 radiance = uAlbedo / PI * (sunLight(vWorldPos, n) + skyIrradiance(vWorldPos, n));
  gl_FragColor = sceneOutput(aerialPerspective(radiance, vWorldPos), 1.0);
}
