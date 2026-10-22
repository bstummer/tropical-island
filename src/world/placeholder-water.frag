// TEMPORARY: placeholder water. A flat plane with gently drifting colour, lit
// by the shared lighting: light scattered out of the water, and the sky
// mirrored by its surface, more of it at grazing angles.

#include "chunks/noise.glsl"
#include "chunks/scene-output.glsl"
#include "chunks/lighting.glsl"

uniform float uTime;
uniform vec3 uDeep; // linear: how much light the water sends back, over deep water
uniform vec3 uShallow; // and over the sand near the shore

centroid varying vec3 vWorldPos;

const float WAVE_SLOPE = 0.07; // typical slope of the small waves on a calm lagoon

void main() {
  vec2 p = vWorldPos.xz;
  float n = gradientNoise(p * 0.035 + vec2(0.05, 0.03) * uTime)
          + 0.5 * gradientNoise(p * 0.11 - vec2(0.07, -0.04) * uTime);

  float lagoon = 1.0 - smoothstep(85.0, 170.0, length(p));
  vec3 body = mix(uDeep, uShallow, clamp(0.25 + 0.6 * lagoon + 0.2 * n, 0.0, 1.0));

  vec3 up = vec3(0.0, 1.0, 0.0);
  vec3 view = normalize(cameraPosition - vWorldPos);
  // Small waves tilt the surface by about WAVE_SLOPE: on average it mirrors sky
  // from higher up than a flat sea would, and less of it at grazing angles, so
  // the far sea reads darker and bluer than the pale sky at the horizon.
  float facing = sqrt(view.y * view.y + WAVE_SLOPE * WAVE_SLOPE);
  float fresnel = 0.02 + 0.98 * pow(1.0 - min(facing, 1.0), 5.0); // Schlick, water's 2% head-on
  vec3 mirrored = reflect(-view, up);
  mirrored.y = sqrt(mirrored.y * mirrored.y + 4.0 * WAVE_SLOPE * WAVE_SLOPE);
  vec3 radiance = (1.0 - fresnel) * body / PI * (sunLight(vWorldPos, up) + skyIrradiance(vWorldPos, up)) + fresnel * skyRadiance(normalize(mirrored));

  gl_FragColor = sceneOutput(aerialPerspective(radiance, vWorldPos), 1.0);
}
