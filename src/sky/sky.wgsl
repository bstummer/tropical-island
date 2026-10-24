// The sky (sky.js): the sky as the light state holds it (chunks/lighting.wgsl),
// plus the sun: its disk, darker towards its edge (limb darkening), and its
// aureole, the sharp forward peak of the haze's scattering that glows a few
// degrees around it and that the sky-view table is too coarse to hold. Both
// are coloured by the air in front of them.
//
// One triangle over the whole view on the far plane, which the frame draws
// after every other opaque mesh, so only where nothing else drew.

#include "chunks/scene-output.wgsl"
#include "chunks/lighting.wgsl"
#include "atmosphere.wgsl"

struct Sky {
  uSunCeiling: f32, // the most the disk may reach once exposed
  uLimbDarkening: f32, // the disk's edge is 1 - this of its centre
  uAureoleG: f32, // how sharp the aureole's peak is (Henyey-Greenstein g)
  uAureole: f32, // its strength: the share of sunlight the peak scatters
}

@group(1) @binding(0) var<uniform> sky: Sky;

struct Varyings {
  @builtin(position) position: vec4f,
  @location(0) vDirection: vec3f,
}

// Passes the view ray through each corner on, in world space.
@vertex
fn vertexMain(@builtin(vertex_index) i: u32) -> Varyings {
  let corner = vec2f(f32(i == 1u) * 4.0 - 1.0, f32(i == 2u) * 4.0 - 1.0);
  let view = vec3f(corner.x / frame.projectionMatrix[0][0], corner.y / frame.projectionMatrix[1][1], -1.0);
  var out: Varyings;
  out.vDirection = (vec4f(view, 0.0) * frame.viewMatrix).xyz; // the camera's rotation, inverted
  out.position = vec4f(corner, 0.0, 1.0); // reversed depth: the far plane
  return out;
}

@fragment
fn fragmentMain(in: Varyings) -> @location(0) vec4f {
  let dir = normalize(in.vDirection);
  var radiance = skyRadiance(dir);

  // Angle to the sun's centre, precise near zero, and the disk's edge smoothed
  // over one pixel.
  let through = atmosphere.uSunIlluminance * transmittance(frame.uSkyViewHeight, dir.y);
  let g = sky.uAureoleG;
  radiance += through * sky.uAureole * (1.0 - g * g) / (4.0 * PI * pow(1.0 + g * g - 2.0 * g * dot(dir, frame.uSunDirection), 1.5));

  let angle = 2.0 * asin(min(length(dir - frame.uSunDirection) * 0.5, 1.0));
  let edge = max(fwidth(angle), 1e-7); // smoothstep's edges must differ
  let disk = 1.0 - smoothstep(atmosphere.uSunRadius - edge, atmosphere.uSunRadius + edge, angle);
  if (disk > 0.0) {
    let x = min(angle / atmosphere.uSunRadius, 1.0);
    let limb = (1.0 - sky.uLimbDarkening * (1.0 - sqrt(1.0 - x * x))) / (1.0 - sky.uLimbDarkening / 3.0); // mean 1 over the disk
    let sun = limb * through / (PI * atmosphere.uSunRadius * atmosphere.uSunRadius);
    // A camera clips the sun to white; the eye sees a low sun deep orange. So
    // the disk's exposed brightness is held softly under a ceiling, which keeps
    // its colour, and then its coverage of the pixel smooths its edge. Bloom
    // (PLAN.md Stage 11) will want the energy the ceiling holds back.
    let peak = max(sun.r, max(sun.g, sun.b)) * frame.uExposure;
    radiance += disk * sun / (1.0 + peak / sky.uSunCeiling);
  }

  return sceneOutput(radiance, 1.0);
}
