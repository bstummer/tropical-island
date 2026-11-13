// Spray thrown off the reef's crest where the surf breaks hardest (water/spray.js): each
// instance one puff of droplets from one spot of the crest, thrown up and forward as the wave
// breaks there and falling back as it spreads and thins, a function of the waves' time. Its
// droplets light as the foam's do, glowing against a low sun. In the translucent pass.

#include "chunks/scene-output.wgsl"
#include "chunks/lighting.wgsl"
#include "chunks/planet.wgsl"
#include "sea-map.wgsl"
#include "water-surf.wgsl"

struct SpraySettings {
  uSprayTime: vec4f, // s a puff lasts; s between one spot's puffs as they go up; m/s up, at least and at most
  uSprayThrow: vec4f, // m/s forward, at least and at most; m/s2 it falls back (the air holds it); m above the still sea it starts
  uSpraySize: vec4f, // m across a puff as it starts, and m more each second, each half again more or less; m along the crest a spot's puffs spread over; how much wider than tall a puff is
  uSprayLook: vec4f, // linear albedo; the share of the spots each wave throws spray off
  uSprayLight: vec4f, // how much of the sun's light it takes with the sun on the horizon; how much its droplets send on, and how much of that onwards (Henyey-Greenstein g); how dense a puff is where it breaks hardest
  uSprayTakes: f32, // how much of a wave the water takes for it to throw any
}

@group(1) @binding(25) var<uniform> spray: SpraySettings;

struct VertexIn {
  @location(0) position: vec3f, // the puff's corner, -1 to 1 in x and y
  @location(1) aSpot: vec4f, // the spot's world x, z; its seed; which of its puffs
}

struct Varyings {
  @builtin(position) position: vec4f,
  @location(0) vWorld: vec3f,
  @location(1) vCorner: vec2f,
  @location(2) vDense: f32,
}

@vertex
fn vertexMain(in: VertexIn) -> Varyings {
  var out: Varyings;
  out.vCorner = in.position.xy;
  out.vDense = 0.0;
  out.vWorld = vec3f(0.0);
  out.position = vec4f(0.0, 0.0, -1.0, 1.0); // none: behind the eye
  let xz = in.aSpot.xy;
  let broke = surfBreak(seaAt(xz), seaShoreAt(xz), seaWaveAt(xz), xz, frame.uWaveSeconds);
  let age = broke.x - in.aSpot.w * spray.uSprayTime.y;
  let thrown = smoothstep(spray.uSprayTakes, 2.0 * spray.uSprayTakes + 0.2, broke.y);
  if (age <= 0.0 || age >= spray.uSprayTime.x || thrown <= 0.0) {
    return out;
  }
  // Each wave throws spray off some spots and not others, each as hard as it does, and each
  // puff its own way.
  let spot = 0.5 + 0.5 * noiseHash22(vec2f(1.7 * in.aSpot.z, 0.37 * broke.z + 5.1));
  if (spot.x > spray.uSprayLook.w) {
    return out;
  }
  let r = 0.5 + 0.5 * vec4f(noiseHash22(vec2f(in.aSpot.z, in.aSpot.w + 13.7 * broke.z)), noiseHash22(vec2f(in.aSpot.w - 7.1 * broke.z, in.aSpot.z + 3.3)));
  let way = surf.uSurfWay.xy;
  let along = vec2f(-way.y, way.x);
  let up = mix(spray.uSprayTime.z, spray.uSprayTime.w, r.x);
  let forward = mix(spray.uSprayThrow.x, spray.uSprayThrow.y, r.y);
  let height = spray.uSprayThrow.w + up * age - 0.5 * spray.uSprayThrow.z * age * age;
  if (height <= 0.0) {
    return out;
  }
  let ground = xz + along * spray.uSpraySize.z * (r.z - 0.5) + way * forward * age;
  var world = vec3f(ground.x, height, ground.y);
  world.y -= planetDrop(world.xz);
  let size = (spray.uSpraySize.x + spray.uSpraySize.y * age) * (0.5 + r.w);
  // Facing the eye.
  let right = vec3f(frame.viewMatrix[0][0], frame.viewMatrix[1][0], frame.viewMatrix[2][0]);
  let top = vec3f(frame.viewMatrix[0][1], frame.viewMatrix[1][1], frame.viewMatrix[2][1]);
  let corner = world + 0.5 * size * (spray.uSpraySize.w * in.position.x * right + in.position.y * top);
  let life = age / spray.uSprayTime.x;
  out.vWorld = corner;
  out.vDense = spray.uSprayLight.w * thrown * (0.4 + spot.y) * (1.0 - life) * (1.0 - life) * smoothstep(0.0, 0.1, life);
  out.position = frame.projectionMatrix * frame.viewMatrix * vec4f(corner, 1.0);
  return out;
}

@fragment
fn fragmentMain(in: Varyings) -> @location(0) vec4f {
  let p = in.vWorld;
  let up = vec3f(0.0, 1.0, 0.0);
  // A soft round puff, thinner at its edge.
  let d = length(in.vCorner);
  let alpha = in.vDense * (1.0 - smoothstep(0.15, 1.0, d)) * (1.0 - smoothstep(0.15, 1.0, d));
  shadeOnce(p, up, vec2f(0.0), vec2f(0.0), SHADE_HIGH);
  let view = normalize(frame.cameraPosition - p);
  let g = spray.uSprayLight.z;
  let onwards = (1.0 - g * g) / (4.0 * PI * pow(1.0 + g * g + 2.0 * g * dot(view, frame.uSunDirection), 1.5));
  let beam = sunLight(p, up) / max(frame.uSunDirection.y, 0.05);
  let radiance = spray.uSprayLook.rgb * (beam * (mix(spray.uSprayLight.x, 1.0, max(frame.uSunDirection.y, 0.0)) / PI + spray.uSprayLight.y * onwards) + shIrradiance(up) / PI);
  return sceneOutput(aerialPerspective(radiance, p), alpha);
}
