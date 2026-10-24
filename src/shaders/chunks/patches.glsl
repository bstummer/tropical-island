// The green's patches inland (chunks/green.glsl): where the ground that is
// neither sand nor rock is living green and where bare. They lie where they
// lie, whatever the camera does, and JS knows them: world/green.js
// greenPatches is the twin, which the screenshot tool's patches fixture checks.

#include "noise.glsl"

uniform vec2 uGreenPatches; // the patches' size (m), and how sharp their edges are (0 to 1)
uniform vec2 uGreenSeeds; // the patches' two octaves' seeds, whole numbers

// The patches at world xz: noise spread about evenly over 0 to 1, with its
// slope per metre; the green grows where it is below its share
// (chunks/green.glsl greenCover). Two octaves, whose sum deviates by 0.182,
// which the logistic curve all but straightens.
vec3 greenPatches(vec2 xz) {
  vec2 p = xz / uGreenPatches.x;
  vec3 v = 0.65 * seededNoiseD(p, uint(uGreenSeeds.x)) + 0.35 * seededNoiseD(3.1 * p, uint(uGreenSeeds.y)) * vec3(1.0, 3.1, 3.1);
  const float K = 1.702 / 0.182;
  float u = 1.0 / (1.0 + exp(-K * v.x));
  return vec3(u, K * u * (1.0 - u) * v.yz / uGreenPatches.x);
}
