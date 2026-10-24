// TEMPORARY: placeholder water. Delete together with placeholder.js. A flat
// plane coloured by the depth of the ground below it, with gently drifting
// colour, lit by the shared lighting: light scattered out of the water, and the
// sky mirrored by its surface, more of it at grazing angles.

#include "chunks/noise.wgsl"
#include "chunks/scene-output.wgsl"
#include "chunks/lighting.wgsl"
#include "chunks/terrain.wgsl"
#include "chunks/planet.wgsl"
#include "chunks/object.wgsl"

struct Water {
  uTime: f32,
  uDeep: vec3f, // linear: how much light the water sends back, over deep water
  uShallow: vec3f, // over a few metres of it
  uClear: vec3f, // and over sand just under the surface
}

@group(1) @binding(0) var<uniform> water: Water;

const WAVE_SLOPE: f32 = 0.07; // typical slope of the small waves on a calm lagoon

struct Varyings {
  @builtin(position) position: vec4f,
  // Centroid: the far rim lies a fraction of a pixel below the plane's horizon,
  // where a pixel centre outside the triangle would extrapolate the position to
  // nonsense (a dark line along the horizon).
  @location(0) @interpolate(perspective, centroid) vWorldPos: vec3f,
}

@vertex
fn vertexMain(@location(0) position: vec3f) -> Varyings {
  var world = object.modelMatrix * vec4f(position, 1.0);
  world.y -= planetDrop(world.xz);
  var out: Varyings;
  out.vWorldPos = world.xyz;
  out.position = frame.projectionMatrix * frame.viewMatrix * world;
  return out;
}

@fragment
fn fragmentMain(in: Varyings) -> @location(0) vec4f {
  let p = in.vWorldPos.xz;
  let n = gradientNoise(p * 0.035 + vec2f(0.05, 0.03) * water.uTime)
        + 0.5 * gradientNoise(p * 0.11 - vec2f(0.07, -0.04) * water.uTime);

  let depth = max(-terrainHeight(terrainCove(p), 0), 0.0);
  var body = mix(water.uClear, water.uShallow, smoothstep(0.0, 3.0, depth));
  body = mix(body, water.uDeep, 1.0 - exp(-max(depth - 2.0, 0.0) / 6.0));
  body *= 1.0 + 0.12 * n;

  let up = vec3f(0.0, 1.0, 0.0);
  let view = normalize(frame.cameraPosition - in.vWorldPos);
  // Small waves tilt the surface by about WAVE_SLOPE: on average it mirrors sky
  // from higher up than a flat sea would, and less of it at grazing angles, so
  // the far sea reads darker and bluer than the pale sky at the horizon.
  let facing = sqrt(view.y * view.y + WAVE_SLOPE * WAVE_SLOPE);
  let fresnel = 0.02 + 0.98 * pow(1.0 - min(facing, 1.0), 5.0); // Schlick, water's 2% head-on
  var mirrored = reflect(-view, up);
  mirrored.y = sqrt(mirrored.y * mirrored.y + 4.0 * WAVE_SLOPE * WAVE_SLOPE);
  let radiance = (1.0 - fresnel) * body / PI * (sunLight(in.vWorldPos, up) + skyIrradiance(in.vWorldPos, up)) + fresnel * skyRadiance(normalize(mirrored));

  return sceneOutput(aerialPerspective(radiance, in.vWorldPos), 1.0);
}
