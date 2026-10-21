// The light state's maths, pure and Node-importable: the sky's light as
// spherical harmonics, the share of the sun's disk above the horizon, and the
// exposure. sky/probe.frag projects the sky with the same basis.
//
// All light is in units of the sun's illuminance above the atmosphere
// (config.sky.atmosphere.sunIlluminance).

// The nine real spherical harmonics up to l = 2 at unit direction [x, y, z]:
// chunks/sh.glsl's shBasis(), in the same order (fixtures/maths.js checks it).
export function shBasis([x, y, z]) {
  return [
    0.282095,
    0.488603 * y,
    0.488603 * z,
    0.488603 * x,
    1.092548 * x * y,
    1.092548 * y * z,
    0.315392 * (3 * z * z - 1),
    1.092548 * x * z,
    0.546274 * (x * x - y * y),
  ];
}

// How much of each band a cosine lobe keeps (Ramamoorthi and Hanrahan 2001).
const BAND = [Math.PI, ...Array(3).fill((2 * Math.PI) / 3), ...Array(5).fill(Math.PI / 4)];

// Irradiance [r, g, b] on a surface facing `normal`, from radiance given as nine
// [r, g, b] coefficients.
export function shIrradiance(coefficients, normal) {
  const y = shBasis(normal);
  const out = [0, 0, 0];
  coefficients.forEach((c, k) => {
    for (let i = 0; i < 3; i++) out[i] += BAND[k] * c[i] * y[k];
  });
  return out.map((v) => Math.max(v, 0));
}

export function luminance([r, g, b]) {
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

// The share of the sun's disk above the horizon, with its centre `elevation` up
// and an angular `radius` (radians): the area of a circle above a chord.
export function diskAbove(elevation, radius) {
  const x = Math.max(-1, Math.min(1, elevation / radius));
  return 1 - (Math.acos(x) - x * Math.sqrt(1 - x * x)) / Math.PI;
}

// How much of the haze is there with the sun `elevation` radians up (config.sky.haze).
// The marine haze that softens the horizon at noon would put out the low sun's
// light inside it, turning the band where sea meets sky grey at sunrise and
// sunset; like real haze, it changes over the day, and it thins as the sun sinks.
export function hazeAmount(elevation, { low, fullAbove }) {
  const x = Math.min(Math.max(elevation / ((fullAbove * Math.PI) / 180), 0), 1);
  return low + (1 - low) * x * x * (3 - 2 * x);
}

// The light state from the probe (probe.frag, 10 RGBA texels) for the sun at
// `sun` (sky/sun.js position()): the sun's radiance as it reaches the scene,
// the sky's light as SH, the illuminance the exposure is set for, and the
// exposure (config.sky.exposure).
//
// The illuminance is the mean of that on level ground and on an upright
// surface facing the sun: level ground alone loses the low sun long before
// the eye does, and sunlit walls, trunks and faces still catch it.
export function lightFromProbe(probe, sun, { atmosphere, exposure }) {
  const texel = (i) => [probe[4 * i], probe[4 * i + 1], probe[4 * i + 2]];
  const visible = diskAbove(sun.elevation, (atmosphere.sunRadius * Math.PI) / 180);
  const sunRadiance = texel(0).map((v) => v * visible);
  const sky = Array.from({ length: 9 }, (_, k) => texel(k + 1));
  const sunLuminance = luminance(sunRadiance);
  const [x, , z] = sun.direction;
  const across = Math.hypot(x, z) || 1;
  const level = sunLuminance * Math.max(Math.sin(sun.elevation), 0) + luminance(shIrradiance(sky, [0, 1, 0]));
  const facing = sunLuminance * Math.cos(sun.elevation) + luminance(shIrradiance(sky, [x / across, 0, z / across]));
  const illuminance = (level + facing) / 2;
  return { sunRadiance, sky, illuminance, exposure: exposure.key / Math.max(illuminance, 1e-6) ** exposure.compensation };
}
