// TEMPORARY: placeholder water. A flat plane coloured by the depth of the
// ground below it, with gently drifting colour, lit by the shared lighting:
// light scattered out of the water, and the sky mirrored by its surface, more
// of it at grazing angles.

#include "chunks/noise.glsl"
#include "chunks/scene-output.glsl"
#include "chunks/lighting.glsl"
#include "chunks/terrain.glsl"

uniform float uTime;
uniform vec3 uDeep; // linear: how much light the water sends back, over deep water
uniform vec3 uShallow; // over a few metres of it
uniform vec3 uClear; // and over sand just under the surface

centroid varying vec3 vWorldPos;

const float WAVE_SLOPE = 0.07; // typical slope of the small waves on a calm lagoon

void main() {
  vec2 p = vWorldPos.xz;
  float n = gradientNoise(p * 0.035 + vec2(0.05, 0.03) * uTime)
          + 0.5 * gradientNoise(p * 0.11 - vec2(0.07, -0.04) * uTime);

  float depth = max(-terrainHeight(terrainCove(p), 0), 0.0);
  vec3 body = mix(uClear, uShallow, smoothstep(0.0, 3.0, depth));
  body = mix(body, uDeep, 1.0 - exp(-max(depth - 2.0, 0.0) / 6.0));
  body *= 1.0 + 0.12 * n;

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
