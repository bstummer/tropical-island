// The maths fixture's test cases (fixtures/maths.js), shared with
// tools/screenshot.js, which checks the GPU's answers against sky/light.js.
// Pure: Node imports it.

// Directions to evaluate at (not unit length: both sides normalize them).
export const directions = [
  [0, 1, 0],
  [0.6, 0.8, 0],
  [-0.3, -0.4, 0.866],
  [0.48, 0.6, -0.64],
];

// Sky radiance as nine SH coefficients, [r, g, b] each: arbitrary, all different.
export const coefficients = [
  [0.5, 0.6, 0.8],
  [0.1, 0.12, 0.2],
  [-0.03, 0.02, 0.01],
  [0.04, -0.05, 0.06],
  [0.01, 0.02, -0.03],
  [-0.02, 0.01, 0.03],
  [0.05, 0.04, 0.03],
  [0.02, -0.01, 0.01],
  [-0.04, 0.03, 0.02],
];

// Texels of the result row: 9 basis values per direction, then an irradiance
// per direction, then the worst round-trip errors of the sky-view and the
// aerial-perspective mappings, in texels.
export const texels = { basis: 0, irradiance: 9 * directions.length, skyView: 10 * directions.length, aerial: 10 * directions.length + 1 };
export const texelCount = texels.aerial + 1;
