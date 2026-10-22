// The sky (sky.js): the sky as the light state holds it (chunks/lighting.glsl),
// plus the sun: its disk, darker towards its edge (limb darkening), and its
// aureole, the sharp forward peak of the haze's scattering that glows a few
// degrees around it and that the sky-view table is too coarse to hold. Both
// are coloured by the air in front of them.

#include "chunks/scene-output.glsl"
#include "chunks/lighting.glsl"
#include "atmosphere.glsl"

uniform float uSunCeiling; // the most the disk may reach once exposed
uniform float uLimbDarkening; // the disk's edge is 1 - this of its centre
uniform float uAureoleG; // how sharp the aureole's peak is (Henyey-Greenstein g)
uniform float uAureole; // its strength: the share of sunlight the peak scatters

varying vec3 vDirection;

void main() {
  vec3 dir = normalize(vDirection);
  vec3 radiance = skyRadiance(dir);

  // Angle to the sun's centre, precise near zero, and the disk's edge smoothed
  // over one pixel.
  vec3 through = uSunIlluminance * transmittance(uSkyViewHeight, dir.y);
  float g = uAureoleG;
  radiance += through * uAureole * (1.0 - g * g) / (4.0 * PI * pow(1.0 + g * g - 2.0 * g * dot(dir, uSunDirection), 1.5));

  float angle = 2.0 * asin(min(length(dir - uSunDirection) * 0.5, 1.0));
  float edge = max(fwidth(angle), 1e-7); // smoothstep's edges must differ
  float disk = 1.0 - smoothstep(uSunRadius - edge, uSunRadius + edge, angle);
  if (disk > 0.0) {
    float x = min(angle / uSunRadius, 1.0);
    float limb = (1.0 - uLimbDarkening * (1.0 - sqrt(1.0 - x * x))) / (1.0 - uLimbDarkening / 3.0); // mean 1 over the disk
    vec3 sun = limb * through / (PI * uSunRadius * uSunRadius);
    // A camera clips the sun to white; the eye sees a low sun deep orange. So
    // the disk's exposed brightness is held softly under a ceiling, which keeps
    // its colour, and then its coverage of the pixel smooths its edge. Bloom
    // (PLAN.md Stage 11) will want the energy the ceiling holds back.
    float peak = max(sun.r, max(sun.g, sun.b)) * uExposure;
    radiance += disk * sun / (1.0 + peak / uSunCeiling);
  }

  gl_FragColor = sceneOutput(radiance, 1.0);
}
