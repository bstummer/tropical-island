// Tonemapping curves for the output pass: linear HDR (exposure already applied)
// to linear display colour in [0, 1]. TONEMAP picks one (values in config.post):
//   1 Khronos PBR Neutral: keeps colours as authored up to ~0.76, then rolls off
//   2 AgX (Blender, via Filament): filmic, bright saturated colours bleach to white
//   3 AgX with Blender's "punchy" look: more contrast and saturation
//   4 ACES filmic (Narkowicz/Hill fit): contrasty, shifts hues in bright colours
// Ported from three.js's tonemapping_pars_fragment (MIT), minus its exposure.

vec3 neutralTonemap(vec3 color) {
  const float startCompression = 0.8 - 0.04;
  const float desaturation = 0.15;
  float x = min(color.r, min(color.g, color.b));
  float offset = x < 0.08 ? x - 6.25 * x * x : 0.04;
  color -= offset;
  float peak = max(color.r, max(color.g, color.b));
  if (peak < startCompression) return color;
  float d = 1.0 - startCompression;
  float newPeak = 1.0 - d * d / (peak + d - startCompression);
  color *= newPeak / peak;
  float g = 1.0 - 1.0 / (desaturation * (peak - newPeak) + 1.0);
  return mix(color, vec3(newPeak), g);
}

const mat3 LINEAR_REC2020_TO_LINEAR_SRGB = mat3(
  vec3(1.6605, -0.1246, -0.0182),
  vec3(-0.5876, 1.1329, -0.1006),
  vec3(-0.0728, -0.0083, 1.1187)
);
const mat3 LINEAR_SRGB_TO_LINEAR_REC2020 = mat3(
  vec3(0.6274, 0.0691, 0.0164),
  vec3(0.3293, 0.9195, 0.0880),
  vec3(0.0433, 0.0113, 0.8956)
);

vec3 agxContrast(vec3 x) {
  vec3 x2 = x * x;
  vec3 x4 = x2 * x2;
  return 15.5 * x4 * x2 - 40.14 * x4 * x + 31.96 * x4 - 6.868 * x2 * x + 0.4298 * x2 + 0.1191 * x - 0.00232;
}

vec3 agxTonemap(vec3 color, bool punchy) {
  const mat3 inset = mat3(
    vec3(0.856627153315983, 0.137318972929847, 0.11189821299995),
    vec3(0.0951212405381588, 0.761241990602591, 0.0767994186031903),
    vec3(0.0482516061458583, 0.101439036467562, 0.811302368396859)
  );
  const mat3 outset = mat3(
    vec3(1.1271005818144368, -0.1413297634984383, -0.14132976349843826),
    vec3(-0.11060664309660323, 1.157823702216272, -0.11060664309660294),
    vec3(-0.016493938717834573, -0.016493938717834257, 1.2519364065950405)
  );
  const float minEv = -12.47393; // log2(2^-10 * 0.18)
  const float maxEv = 4.026069; // log2(2^6.5 * 0.18)

  color = inset * (LINEAR_SRGB_TO_LINEAR_REC2020 * color);
  color = clamp((log2(max(color, 1e-10)) - minEv) / (maxEv - minEv), 0.0, 1.0);
  color = agxContrast(color);
  if (punchy) {
    float luma = dot(color, vec3(0.2126, 0.7152, 0.0722));
    color = luma + 1.4 * (pow(max(color, 0.0), vec3(1.35)) - luma);
  }
  color = pow(max(outset * color, 0.0), vec3(2.2));
  return clamp(LINEAR_REC2020_TO_LINEAR_SRGB * color, 0.0, 1.0);
}

vec3 acesTonemap(vec3 color) {
  const mat3 inputMatrix = mat3(
    vec3(0.59719, 0.07600, 0.02840),
    vec3(0.35458, 0.90834, 0.13383),
    vec3(0.04823, 0.01566, 0.83777)
  );
  const mat3 outputMatrix = mat3(
    vec3(1.60475, -0.10208, -0.00327),
    vec3(-0.53108, 1.10813, -0.07276),
    vec3(-0.07367, -0.00605, 1.07602)
  );
  color = inputMatrix * (color / 0.6);
  vec3 a = color * (color + 0.0245786) - 0.000090537;
  vec3 b = color * (0.983729 * color + 0.4329510) + 0.238081;
  return clamp(outputMatrix * (a / b), 0.0, 1.0);
}

vec3 tonemap(vec3 color) {
  #if TONEMAP == 1
  return neutralTonemap(color);
  #elif TONEMAP == 2
  return agxTonemap(color, false);
  #elif TONEMAP == 3
  return agxTonemap(color, true);
  #else
  return acesTonemap(color);
  #endif
}
