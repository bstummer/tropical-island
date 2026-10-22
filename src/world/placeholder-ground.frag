// TEMPORARY: placeholder mound, a plain diffuse sand lit by the shared lighting.

#include "chunks/scene-output.glsl"
#include "chunks/lighting.glsl"

uniform vec3 uAlbedo; // linear

varying vec3 vWorldPos;
varying vec3 vNormal;

void main() {
  vec3 n = normalize(vNormal);
  vec3 radiance = uAlbedo / PI * (sunLight(vWorldPos, n) + skyIrradiance(vWorldPos, n));
  gl_FragColor = sceneOutput(aerialPerspective(radiance, vWorldPos), 1.0);
}
