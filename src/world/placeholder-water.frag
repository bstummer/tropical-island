// TEMPORARY: placeholder water. A flat plane with gently drifting colour.
// Its only job is to prove that #include of shared chunks and uTime work.

#include "chunks/noise.glsl"

uniform float uTime;
uniform vec3 uDeep;
uniform vec3 uShallow;
uniform vec3 uHorizon;

varying vec3 vWorldPos;

void main() {
  vec2 p = vWorldPos.xz;
  float n = gradientNoise(p * 0.035 + vec2(0.05, 0.03) * uTime)
          + 0.5 * gradientNoise(p * 0.11 - vec2(0.07, -0.04) * uTime);

  float lagoon = 1.0 - smoothstep(85.0, 170.0, length(p));
  vec3 color = mix(uDeep, uShallow, clamp(0.25 + 0.6 * lagoon + 0.2 * n, 0.0, 1.0));

  vec3 viewDir = normalize(cameraPosition - vWorldPos);
  float fresnel = pow(1.0 - max(viewDir.y, 0.0), 5.0);
  color = mix(color, uHorizon, fresnel);

  gl_FragColor = vec4(color, 1.0);
  #include <colorspace_fragment>
}
