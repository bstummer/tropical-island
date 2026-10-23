// Sand (PLAN.md Stage 4): its albedo, normal and gloss at a point, for any
// wetness from dry to the mirror of a film of water just after a wave drains.
// Stage 7's waves will drive the wetness; until then sandWetness() takes it
// from the height above the sea (world/albedo.js sandWetness is its twin).
//
// The detail comes from the tiles of textures/sand.js, which repeat: the grain
// is read at two scales that never line up, and the ripples through a slow
// warp in world space that bends their field and hides the tile, patchy as
// sand is. Drifts of lighter and darker sand span metres, and the wind combs
// streaks along itself; bits of shell gather in patches; arcs of fine grit
// mark where waves ran out. Each fades once a pixel covers it, so far sand
// keeps its albedo and nothing sparkles, and all of it by uSandRange from the
// camera, beyond which world/terrain.js draws sand as its albedo alone.
// Textures are read with the pixel's derivatives, passed in (dpdx, dpdy: of
// world xz), so a caller can branch around it.

#include "noise.glsl"
#include "lighting.glsl"

uniform sampler2D uSandGrain;
uniform sampler2D uSandRipples;
uniform vec3 uSandGrainMean; // the grain's average factor, which the albedo keeps
uniform vec3 uSandTiles; // the grain's and the ripples' tiles, m; how strong the ripples stand
uniform vec2 uSandWind; // which way the wind blows the sand: world xz, unit
uniform vec3 uSandWet; // m above the sea: a film below .x, half wet at .y, dry above .z
uniform vec3 uSandRoughness; // dry, wet, and a film of water's
uniform float uSandRange; // m from the camera: beyond it sand is its albedo alone (sandAlbedo)

struct Sand {
  vec3 albedo;
  vec3 normal;
  float roughness; // the sand's; where a film covers it, the film's (uSandRoughness.z)
  float f0;
  float film; // how much of it a film of water covers, 0 to 1
};

// How much further up the beach than elsewhere the waves reach here, as a
// height above the sea (m): in arcs tens of metres across, and raggedly, so
// the wet sand's edge wanders. A caller takes it off the height it passes to
// sandWetness().
float sandReach(vec2 xz) {
  return 0.07 * (1.0 - 2.0 * abs(gradientNoise(xz * 0.06 + 1.7))) + 0.03 * gradientNoise(xz * 0.4 - 2.3);
}

// How wet sand is at this height above the sea: 1 under a film, 0 dry.
float sandWetness(float aboveSea) {
  if (aboveSea <= uSandWet.x) return 1.0;
  if (aboveSea <= uSandWet.y) return mix(1.0, 0.35, (aboveSea - uSandWet.x) / (uSandWet.y - uSandWet.x));
  return 0.35 * (1.0 - smoothstep(uSandWet.y, uSandWet.z, aboveSea));
}

// Sand's diffuse albedo once a film of water has mirrored its share.
vec3 sandDiffuse(Sand s, vec3 n, vec3 view) {
  return s.albedo * (1.0 - fresnel(s.f0, dot(n, view)) * s.film);
}

// The light sand mirrors towards the eye, beyond its diffuse share: a little
// from wet sand, a mirror's worth from a film of water; dry sand is too rough
// to show any. kernel: specularKernel() of n.
vec3 sandShine(Sand s, vec3 position, vec3 n, vec3 view, float kernel) {
  float glossy = 1.0 - smoothstep(0.7, 0.85, s.roughness);
  vec3 shine = vec3(0.0);
  if (glossy + s.film > 0.0) {
    shine = glossy * specularLight(position, n, view, filteredRoughness(s.roughness, kernel), s.f0);
    if (s.film > 0.0) shine = mix(shine, specularLight(position, n, view, filteredRoughness(uSandRoughness.z, kernel), s.f0), s.film);
  }
  return shine;
}

// Sand's albedo at this wetness, before its detail: wet sand darkens fast.
vec3 sandAlbedo(float wetness, vec3 dry, vec3 wet) {
  return mix(dry, wet, smoothstep(0.2, 0.5, wetness));
}

vec2 sandRotate(vec2 v, float c, float s) {
  return vec2(c * v.x - s * v.y, s * v.x + c * v.y);
}

// n: the ground's normal; dry, wet: the albedos (config.world.terrain.albedo).
Sand sand(vec3 position, float aboveSea, vec3 n, float wetness, vec3 dry, vec3 wet, vec2 dpdx, vec2 dpdy) {
  vec2 xz = position.xz;
  float footprint = max(length(dpdx), length(dpdy)); // metres a pixel spans on the ground
  float near = 1.0 - smoothstep(0.75 * uSandRange, uSandRange, length(position - cameraPosition));
  float dark = smoothstep(0.2, 0.5, wetness);
  float soaked = smoothstep(0.45, 0.7, wetness); // water up to the surface: a sheen
  float film = smoothstep(0.75, 1.0, wetness);
  float dryness = 1.0 - smoothstep(0.4, 0.7, wetness); // ripples stand on dry and damp sand, not wet

  Sand s;
  s.albedo = sandAlbedo(wetness, dry, wet);
  s.normal = n;
  s.roughness = mix(1.0, mix(mix(uSandRoughness.x, uSandRoughness.y, dark), 0.4, soaked), near);
  s.f0 = 0.02; // water's, and near enough dry sand's, which is too rough to show it
  s.film = film * near;

  // Drifts of lighter and darker sand over metres, and streaks the wind combs
  // along itself, metres long and a hand or two wide.
  vec2 across = vec2(-uSandWind.y, uSandWind.x);
  float broad = gradientNoise(xz * 0.13);
  float drift = 0.6 * broad + 0.4 * gradientNoise(xz * 0.47 + 7.1);
  float streak = gradientNoise(vec2(dot(xz, uSandWind) * 0.08, dot(xz, across) * 1.2) + 9.0);
  s.albedo *= 1.0 + (0.1 * drift + 0.05 * streak * (1.0 - smoothstep(0.15, 0.5, footprint))) * near;

  // Grain, near the camera: two reads of the tile, one turned and smaller.
  if (footprint < 0.02) {
    float tile = uSandTiles.x;
    const float C = 0.8;
    const float S = 0.6;
    vec2 uv2 = sandRotate(xz, C, S) / (0.37 * tile) + 0.31;
    vec3 a = textureGrad(uSandGrain, xz / tile, dpdx / tile, dpdy / tile).rgb;
    vec3 b = textureGrad(uSandGrain, uv2, sandRotate(dpdx, C, S) / (0.37 * tile), sandRotate(dpdy, C, S) / (0.37 * tile)).rgb;
    vec3 grain = (a + b) / uSandGrainMean;
    float fine = 1.0 - smoothstep(0.006, 0.02, footprint);
    s.albedo *= mix(vec3(1.0), grain, fine);
    // Soaked sand's sheen is grainy: each grain sits a little higher or lower in the water.
    s.roughness *= 1.0 + 0.6 * soaked * fine * (grain.g - 1.0) * 4.0;
  }

  // Bits of bleached shell, the odd one pink or a dark pebble: one or none in
  // each cell of a grid, kept inside its cell so a pixel looks at one only.
  // Most are small, all angular and half buried, and they gather in patches.
  if (footprint < 0.01) {
    const float CELL = 0.17;
    vec2 cell = floor(xz / CELL);
    vec2 h = noiseHash22(cell + 71.3) * 0.5 + 0.5;
    if (h.x < 0.4 * smoothstep(-0.2, 0.6, drift)) {
      vec2 k = noiseHash22(cell + 13.7) * 0.5 + 0.5;
      vec2 d = xz - (cell + 0.3 + 0.4 * k) * CELL;
      float radius = mix(0.003, 0.016, h.y * h.y * h.y);
      float turn = 6.2832 * k.x;
      d = sandRotate(d, cos(turn), sin(turn)) * vec2(1.0, 1.5);
      float angle = atan(d.y, d.x);
      float edge = 1.0 + 0.25 * sin(5.0 * angle + 9.0 * k.y) + 0.15 * sin(3.0 * angle + 4.0 * h.y);
      float r = length(d) / (radius * edge);
      float soft = footprint / radius;
      float inside = (1.0 - smoothstep(1.0 - soft, 1.0 + soft, r)) * (1.0 - smoothstep(0.004, 0.01, footprint));
      vec3 tint = k.y < 0.82 ? vec3(1.22, 1.2, 1.14) : k.y < 0.93 ? vec3(1.18, 1.07, 1.03) : vec3(0.55, 0.52, 0.5);
      s.albedo *= mix(vec3(1.0), tint, inside);
      vec2 tilt = sandRotate(d / radius, cos(turn), -sin(turn));
      s.normal = normalize(s.normal - 0.3 * inside * vec3(tilt.x, 0.0, tilt.y));
    }
  }

  // Ripples, where the sand is dry and level enough, until a pixel covers one.
  float rippled = dryness * near * (1.0 - smoothstep(0.025, 0.07, footprint)) * (1.0 - smoothstep(0.25, 0.45, 1.0 - n.y));
  if (rippled > 0.0) {
    vec2 w = vec2(dot(xz, uSandWind), dot(xz, across)); // the wind's frame
    vec2 warp = 0.9 * vec2(gradientNoise(xz * 0.11 + 3.3), gradientNoise(xz * 0.11 - 5.1));
    float tile = uSandTiles.y;
    vec2 gx = vec2(dot(dpdx, uSandWind), dot(dpdx, across)) / tile;
    vec2 gy = vec2(dot(dpdy, uSandWind), dot(dpdy, across)) / tile;
    vec4 r = textureGrad(uSandRipples, (w + warp) / tile, gx, gy);
    vec3 t = r.xyz * 2.0 - 1.0;
    // Fields of stronger and fainter ripples.
    float patchy = 0.3 + 0.7 * smoothstep(-0.3, 0.4, broad);
    vec2 slope = -t.xy / max(t.z, 0.25) * uSandTiles.z * rippled * patchy;
    vec2 g = slope.x * uSandWind + slope.y * across; // dh/dx, dh/dz
    s.normal = normalize(n - vec3(g.x, 0.0, g.y));
    // The wind sorts the grains: dark heavy ones from the volcano settle in the
    // troughs, pale shell gathers on the crests; it shows when the sun is too
    // high for the ripples' shading to.
    // The tile's height averages out, so this keeps the sand's albedo.
    float sorted = rippled * patchy * (4.0 * r.a - 2.0); // -1 in the deepest trough, 1 on the highest crest
    s.albedo *= 1.0 + sorted * vec3(0.13, 0.13, 0.12);
  }

  // Swash marks: thin lines of fine grit where waves ran out, short arcs that
  // bulge up the beach and overlap, a few across the wet band.
  float marks = smoothstep(0.35, 0.6, wetness) * near * (1.0 - smoothstep(0.02, 0.08, footprint));
  if (marks > 0.0) {
    // A line every 7 cm of height, about 0.7 m up the beach, each a couple of
    // centimetres wide, wider as the pixel grows so it never aliases.
    float lobes = 1.0 - abs(gradientNoise(xz * 0.35 - 6.0));
    float reach = (aboveSea - uSandWet.x) * 14.0 - 0.6 * lobes;
    float line = 1.0 - smoothstep(0.012, 0.03 + 1.4 * footprint, abs(fract(reach) - 0.5));
    float broken = smoothstep(0.0, 0.4, gradientNoise(xz * 0.9 + 4.0));
    s.albedo *= 1.0 - 0.08 * line * broken * marks;
  }

  // Wet sand isn't quite flat: the backwash leaves it gently rumpled, which
  // breaks a mirrored sun into a streak of glints; under a film, less so.
  float rumpled = smoothstep(0.45, 0.75, wetness) * (1.0 - 0.6 * film) * near * (1.0 - smoothstep(0.05, 0.3, footprint));
  if (rumpled > 0.0) {
    vec2 q = xz * 1.7;
    vec2 slope = gradientNoiseD(q).yz + 0.5 * 2.7 * gradientNoiseD(q * 2.7 + 5.0).yz;
    vec2 g = 0.0007 * 1.7 * slope * rumpled; // under a millimetre over decimetres: half a degree or so
    s.normal = normalize(s.normal - vec3(g.x, 0.0, g.y));
  }
  return s;
}
