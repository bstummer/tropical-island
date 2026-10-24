// The atmosphere: what it holds at every height and how light gets through it,
// after Hillaire, "A Scalable and Production Ready Sky and Atmosphere Rendering
// Technique" (2020), with Bruneton's mapping for the transmittance table.
// sky/atmosphere.js sets the uniforms from config.sky.atmosphere. Needs `frame`
// (frame.wgsl, or frame-values.wgsl in the table passes) for uGroundRadius.
//
// Tables are read with textureSampleLevel: inside loops of varying length, the
// GPU can't take the derivatives that pick a mip level (and they have none).
//
// Lengths in km. h is a height above the ground (sea level), mu the cosine of a
// ray's angle to the local zenith. Functions take h rather than the distance
// from the planet's centre: next to the planet's radius, a float keeps a height
// of a few metres only to half a metre, and the horizon depends on it.

#include "/chunks/sky-view.wgsl"

struct Atmosphere {
  uTopRadius: f32,
  uRayleighHeight: f32, // scale height
  uMieScattering: f32, // background aerosols
  uMieExtinction: f32,
  uRayleighScattering: vec3f, // per km, at sea level
  uMieHeight: f32,
  uHazeScattering: vec3f, // the humid marine layer near the sea
  uHazeHeight: f32,
  uHazeExtinction: vec3f,
  uHazeAmount: f32, // how much of the haze is there now (sky.js: less when the sun is low)
  uOzoneAbsorption: vec3f,
  uMieG: f32,
  uGroundAlbedo: vec3f,
  uHazeG: f32,
  uSunIlluminance: vec3f,
  uSunRadius: f32, // radians: the disk's angular radius
  uTransmittanceSize: vec2f,
  uMultiscatterSize: vec2f,
}

@group(1) @binding(10) var<uniform> atmosphere: Atmosphere;
@group(1) @binding(11) var uTransmittance: texture_2d<f32>;
@group(1) @binding(12) var uTransmittanceSampler: sampler;
@group(1) @binding(13) var uMultiscatter: texture_2d<f32>;
@group(1) @binding(14) var uMultiscatterSampler: sampler;

struct Medium {
  rayleigh: vec3f, // scattering
  mie: f32, // scattering by the background aerosols
  haze: vec3f, // and by the haze, wetter, less forward-peaked and a little bluer
  extinction: vec3f,
}

fn medium(hIn: f32) -> Medium {
  let h = max(hIn, 0.0);
  let aerosol = exp(-h / atmosphere.uMieHeight);
  let haze = atmosphere.uHazeAmount * exp(-h / atmosphere.uHazeHeight);
  let ozone = max(0.0, 1.0 - abs(h - 25.0) / 15.0); // a layer around 25 km
  var m: Medium;
  m.rayleigh = atmosphere.uRayleighScattering * exp(-h / atmosphere.uRayleighHeight);
  m.mie = atmosphere.uMieScattering * aerosol;
  m.haze = atmosphere.uHazeScattering * haze;
  m.extinction = m.rayleigh + atmosphere.uMieExtinction * aerosol + atmosphere.uHazeExtinction * haze + atmosphere.uOzoneAbsorption * ozone;
  return m;
}

fn rayleighPhase(c: f32) -> f32 {
  return 3.0f / (16.0f * PI) * (1.0 + c * c);
}

// Cornette-Shanks.
fn miePhase(c: f32, g: f32) -> f32 {
  let g2 = g * g;
  return 3.0f / (8.0f * PI) * (1.0 - g2) * (1.0 + c * c) / ((2.0 + g2) * pow(max(1.0 + g2 - 2.0 * g * c, 1e-6), 1.5));
}

// Height at distance t along a ray that starts at height h with zenith cosine mu.
fn heightAlong(h: f32, mu: f32, t: f32) -> f32 {
  let r = frame.uGroundRadius + h;
  let d = t * (t + 2.0 * r * mu); // the squared radius gained
  return h + d / (sqrt(max(r * r + d, 0.0)) + r);
}

// Distance to the top of the atmosphere, from inside it.
fn distanceToTop(h: f32, mu: f32) -> f32 {
  let r = frame.uGroundRadius + h;
  let disc = r * r * (mu * mu - 1.0) + atmosphere.uTopRadius * atmosphere.uTopRadius;
  return max(0.0, -r * mu + sqrt(max(disc, 0.0)));
}

// Distance to the ground, or -1 when the ray misses it.
fn distanceToGround(h: f32, mu: f32) -> f32 {
  if (mu >= 0.0) {
    return -1.0;
  }
  let r = frame.uGroundRadius + h;
  let above = h * (r + frame.uGroundRadius); // r^2 - ground^2
  let disc = r * r * mu * mu - above;
  if (disc < 0.0) {
    return -1.0;
  }
  return above / (-r * mu + sqrt(disc)); // the near root, without cancellation
}

// Where step i of n along a ray to tMax starts and ends. Steps crowd towards
// the start: rays leave the densest air there, and on a slant even rays to
// space cross the 150 m of haze in their first kilometre or two. Every march
// samples each step at its middle (fixtures/haze.js measures them against
// finer marches).
fn marchSpan(i: i32, n: i32, tMax: f32) -> vec2f {
  let f = vec2f(f32(i), f32(i + 1)) / f32(n);
  return tMax * f * f;
}

// The optical depth along the first tMax km of a ray, in `steps` steps.
fn opticalDepth(h: f32, mu: f32, tMax: f32, steps: i32) -> vec3f {
  var depth = vec3f(0.0);
  for (var i = 0; i < steps; i++) {
    let span = marchSpan(i, steps, tMax);
    depth += medium(heightAlong(h, mu, 0.5 * (span.x + span.y))).extinction * (span.y - span.x);
  }
  return depth;
}

// ---------------------------------------------------------------- transmittance table

// The table holds the transmittance from (h, mu) to the top of the atmosphere,
// for rays that miss the ground. Texel centres sit on the ends of both ranges.
fn transmittanceUv(h: f32, mu: f32) -> vec2f {
  let H = sqrt(atmosphere.uTopRadius * atmosphere.uTopRadius - frame.uGroundRadius * frame.uGroundRadius);
  let rho = sqrt(max(h * (2.0 * frame.uGroundRadius + h), 0.0)); // distance to the horizon
  let dMin = atmosphere.uTopRadius - frame.uGroundRadius - h;
  let dMax = rho + H;
  let x = vec2f((distanceToTop(h, mu) - dMin) / (dMax - dMin), rho / H);
  return (clamp(x, vec2f(0.0), vec2f(1.0)) * (atmosphere.uTransmittanceSize - 1.0) + 0.5) / atmosphere.uTransmittanceSize;
}

fn transmittanceParams(uv: vec2f, h: ptr<function, f32>, mu: ptr<function, f32>) {
  let x = (uv * atmosphere.uTransmittanceSize - 0.5) / (atmosphere.uTransmittanceSize - 1.0);
  let H = sqrt(atmosphere.uTopRadius * atmosphere.uTopRadius - frame.uGroundRadius * frame.uGroundRadius);
  let rho = H * x.y;
  let r = sqrt(rho * rho + frame.uGroundRadius * frame.uGroundRadius);
  *h = rho * rho / (r + frame.uGroundRadius);
  let dMin = atmosphere.uTopRadius - r;
  let dMax = rho + H;
  let d = dMin + x.x * (dMax - dMin);
  *mu = select(clamp((H * H - rho * rho - d * d) / (2.0 * r * d), -1.0, 1.0), 1.0, d <= 0.0);
}

// Transmittance from (h, mu) to space: zero where the ground is in the way.
fn transmittance(h: f32, mu: f32) -> vec3f {
  if (distanceToGround(h, mu) >= 0.0) {
    return vec3f(0.0);
  }
  return textureSampleLevel(uTransmittance, uTransmittanceSampler, transmittanceUv(h, mu), 0.0).rgb;
}

// ---------------------------------------------------------------- sunlight by height

// The sun's illuminance on a surface facing it at height h, with the sun at
// zenith cosine muSun: through the air towards the sun's centre, kept up to the
// horizon, times the share of the disk above it. The horizon dips as h grows,
// so hilltops keep the sun a little longer than the beach. The probe's sun at
// sea level is the same (probe.wgsl, light.js). In `steps` steps of a direct
// march: the transmittance table's rows lie too far apart near the sea, where
// the haze makes the light change fastest.
fn sunAtHeight(h: f32, muSun: f32, steps: i32) -> vec3f {
  let dip = horizonDip(h);
  let x = clamp((asinPrecise(clamp(muSun, -1.0, 1.0)) + dip) / atmosphere.uSunRadius, -1.0, 1.0);
  let disk = 1.0 - (acos(x) - x * sqrt(1.0 - x * x)) / PI; // the area of a circle above a chord
  let mu = max(muSun, -sin(dip));
  return atmosphere.uSunIlluminance * exp(-opticalDepth(h, mu, distanceToTop(h, mu), steps)) * disk;
}

// ---------------------------------------------------------------- multiple scattering

// The multiple-scattering table by the sun's zenith cosine (x) and the height
// (y). Its columns crowd around the sun on the horizon, where the light changes
// fastest: evenly spaced, sunset's sky came out up to a quarter too bright.
fn multiscatterUv(h: f32, muSun: f32) -> vec2f {
  let m = clamp(muSun, -1.0, 1.0);
  let x = clamp(vec2f(0.5 + 0.5 * sign(m) * sqrt(abs(m)), h / (atmosphere.uTopRadius - frame.uGroundRadius)), vec2f(0.0), vec2f(1.0));
  return (x * (atmosphere.uMultiscatterSize - 1.0) + 0.5) / atmosphere.uMultiscatterSize;
}

fn multiscatterParams(uv: vec2f, h: ptr<function, f32>, muSun: ptr<function, f32>) {
  let x = (uv * atmosphere.uMultiscatterSize - 0.5) / (atmosphere.uMultiscatterSize - 1.0);
  let e = 2.0 * x.x - 1.0;
  *muSun = sign(e) * e * e;
  *h = x.y * (atmosphere.uTopRadius - frame.uGroundRadius);
}

// Light scattered twice and more, per unit of sun illuminance, at height h with the
// sun at zenith cosine muSun (Hillaire's psi_ms).
fn multiscatter(h: f32, muSun: f32) -> vec3f {
  return textureSampleLevel(uMultiscatter, uMultiscatterSampler, multiscatterUv(h, muSun), 0.0).rgb;
}

// ---------------------------------------------------------------- in-scattering

// Light scattered towards the viewer along a ray from height h in direction dir
// (y up) with the sun towards sun, over the first tMax km, in `steps` steps
// spaced closer near the start. Returns the radiance; throughput is the
// fraction of light from behind that gets through. A ray that runs on below
// the sea (the aerial-perspective table's do) follows the sea's surface there.
fn inscatter(h: f32, dir: vec3f, sun: vec3f, tMax: f32, steps: i32, throughput: ptr<function, vec3f>) -> vec3f {
  let r = frame.uGroundRadius + h;
  let cosTheta = dot(dir, sun);
  let phaseR = rayleighPhase(cosTheta);
  let phaseM = miePhase(cosTheta, atmosphere.uMieG);
  let phaseH = miePhase(cosTheta, atmosphere.uHazeG);
  var radiance = vec3f(0.0);
  var through = vec3f(1.0);
  for (var i = 0; i < steps; i++) {
    let span = marchSpan(i, steps, tMax);
    let dt = span.y - span.x;
    let t = 0.5 * (span.x + span.y);
    var hs = heightAlong(h, dir.y, t);
    let muSun = dot(vec3f(0.0, r, 0.0) + t * dir, sun) / (frame.uGroundRadius + hs);
    hs = max(hs, 0.0);
    let m = medium(hs);
    let sunlight = transmittance(hs, muSun);
    let source = atmosphere.uSunIlluminance * (sunlight * (m.rayleigh * phaseR + m.mie * phaseM + m.haze * phaseH) + multiscatter(hs, muSun) * (m.rayleigh + m.mie + m.haze));
    let stepThrough = exp(-m.extinction * dt);
    radiance += through * (source - source * stepThrough) / max(m.extinction, vec3f(1e-9));
    through *= stepThrough;
  }
  *throughput = through;
  return radiance;
}

// The sky's radiance from height h towards dir: everything scattered along the
// ray, plus the lit ground where the ray ends on it. (GLSL's skyRadiance(h, dir,
// sun, steps); WGSL has no overloads, and lighting.wgsl's skyRadiance(dir) reads the table.)
fn skyRadianceAt(h: f32, dir: vec3f, sun: vec3f, steps: i32) -> vec3f {
  let tGround = distanceToGround(h, dir.y);
  var through: vec3f;
  var radiance = inscatter(h, dir, sun, select(distanceToTop(h, dir.y), tGround, tGround >= 0.0), steps, &through);
  if (tGround >= 0.0) {
    let p = vec3f(0.0, frame.uGroundRadius + h, 0.0) + tGround * dir;
    let muSun = dot(normalize(p), sun);
    radiance += through * atmosphere.uSunIlluminance * transmittance(0.0, muSun) * max(muSun, 0.0) * atmosphere.uGroundAlbedo / PI;
  }
  return radiance;
}
