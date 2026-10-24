// The green's patches inland (chunks/green.wgsl): where the ground that is
// neither sand nor rock is living green and where bare. They lie where they
// lie, whatever the camera does, and JS knows them: world/green.js
// greenPatches is the twin, which the screenshot tool's patches fixture checks.

#include "noise.wgsl"

struct PatchesUniforms {
  uGreenPatches: vec2f, // the patches' size (m), and how sharp their edges are (0 to 1)
  uGreenSeeds: vec2f, // the patches' two octaves' seeds, whole numbers
}

@group(1) @binding(21) var<uniform> patchParams: PatchesUniforms;

// The patches at world xz: noise spread about evenly over 0 to 1, with its
// slope per metre; the green grows where it is below its share
// (chunks/green.wgsl greenCover). Two octaves, whose sum deviates by 0.182,
// which the logistic curve all but straightens.
fn greenPatches(xz: vec2f) -> vec3f {
  let p = xz / patchParams.uGreenPatches.x;
  let v = 0.65 * seededNoiseD(p, u32(patchParams.uGreenSeeds.x)) + 0.35 * seededNoiseD(3.1 * p, u32(patchParams.uGreenSeeds.y)) * vec3f(1.0, 3.1, 3.1);
  const K: f32 = 1.702f / 0.182f; // folded in f32, as GLSL did
  let u = 1.0 / (1.0 + exp(-K * v.x));
  return vec3f(u, K * u * (1.0 - u) * v.yz / patchParams.uGreenPatches.x);
}
