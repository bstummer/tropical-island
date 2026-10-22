// The atmosphere: what it holds at every height and how light gets through it,
// after Hillaire, "A Scalable and Production Ready Sky and Atmosphere Rendering
// Technique" (2020), with Bruneton's mapping for the transmittance table.
// sky/atmosphere.js sets the uniforms from config.sky.atmosphere.
//
// Tables are read with textureLod: inside loops of varying length, the GPU
// can't take the derivatives that pick a mip level (and they have none).
//
// Lengths in km. h is a height above the ground (sea level), mu the cosine of a
// ray's angle to the local zenith. Functions take h rather than the distance
// from the planet's centre: next to the planet's radius, a float keeps a height
// of a few metres only to half a metre, and the horizon depends on it.

#include "/chunks/sky-view.glsl"

uniform float uTopRadius; // uGroundRadius comes with sky-view.glsl
uniform vec3 uRayleighScattering; // per km, at sea level
uniform float uRayleighHeight; // scale height
uniform float uMieScattering; // background aerosols
uniform float uMieExtinction;
uniform float uMieHeight;
uniform vec3 uHazeScattering; // the humid marine layer near the sea
uniform vec3 uHazeExtinction;
uniform float uHazeHeight;
uniform float uHazeAmount; // how much of the haze is there now (sky.js: less when the sun is low)
uniform float uMieG;
uniform float uHazeG;
uniform vec3 uOzoneAbsorption;
uniform vec3 uGroundAlbedo;
uniform vec3 uSunIlluminance;
uniform float uSunRadius; // radians: the disk's angular radius

uniform sampler2D uTransmittance;
uniform vec2 uTransmittanceSize;
uniform sampler2D uMultiscatter;
uniform vec2 uMultiscatterSize;

#ifndef PI
#define PI 3.14159265358979
#endif

struct Medium {
  vec3 rayleigh; // scattering
  float mie; // scattering by the background aerosols
  vec3 haze; // and by the haze, wetter, less forward-peaked and a little bluer
  vec3 extinction;
};

Medium medium(float h) {
  h = max(h, 0.0);
  float aerosol = exp(-h / uMieHeight);
  float haze = uHazeAmount * exp(-h / uHazeHeight);
  float ozone = max(0.0, 1.0 - abs(h - 25.0) / 15.0); // a layer around 25 km
  Medium m;
  m.rayleigh = uRayleighScattering * exp(-h / uRayleighHeight);
  m.mie = uMieScattering * aerosol;
  m.haze = uHazeScattering * haze;
  m.extinction = m.rayleigh + uMieExtinction * aerosol + uHazeExtinction * haze + uOzoneAbsorption * ozone;
  return m;
}

float rayleighPhase(float c) {
  return 3.0 / (16.0 * PI) * (1.0 + c * c);
}

// Cornette-Shanks.
float miePhase(float c, float g) {
  float g2 = g * g;
  return 3.0 / (8.0 * PI) * (1.0 - g2) * (1.0 + c * c) / ((2.0 + g2) * pow(max(1.0 + g2 - 2.0 * g * c, 1e-6), 1.5));
}

// Height at distance t along a ray that starts at height h with zenith cosine mu.
float heightAlong(float h, float mu, float t) {
  float r = uGroundRadius + h;
  float d = t * (t + 2.0 * r * mu); // the squared radius gained
  return h + d / (sqrt(max(r * r + d, 0.0)) + r);
}

// Distance to the top of the atmosphere, from inside it.
float distanceToTop(float h, float mu) {
  float r = uGroundRadius + h;
  float disc = r * r * (mu * mu - 1.0) + uTopRadius * uTopRadius;
  return max(0.0, -r * mu + sqrt(max(disc, 0.0)));
}

// Distance to the ground, or -1 when the ray misses it.
float distanceToGround(float h, float mu) {
  if (mu >= 0.0) return -1.0;
  float r = uGroundRadius + h;
  float above = h * (r + uGroundRadius); // r^2 - ground^2
  float disc = r * r * mu * mu - above;
  if (disc < 0.0) return -1.0;
  return above / (-r * mu + sqrt(disc)); // the near root, without cancellation
}

// Where step i of n along a ray to tMax starts and ends. Steps crowd towards
// the start: rays leave the densest air there, and on a slant even rays to
// space cross the 150 m of haze in their first kilometre or two. Every march
// samples each step at its middle (fixtures/haze.js measures them against
// finer marches).
vec2 marchSpan(int i, int n, float tMax) {
  vec2 f = vec2(float(i), float(i + 1)) / float(n);
  return tMax * f * f;
}

// The optical depth along the first tMax km of a ray, in `steps` steps.
vec3 opticalDepth(float h, float mu, float tMax, int steps) {
  vec3 depth = vec3(0.0);
  for (int i = 0; i < steps; i++) {
    vec2 span = marchSpan(i, steps, tMax);
    depth += medium(heightAlong(h, mu, 0.5 * (span.x + span.y))).extinction * (span.y - span.x);
  }
  return depth;
}

// ---------------------------------------------------------------- transmittance table

// The table holds the transmittance from (h, mu) to the top of the atmosphere,
// for rays that miss the ground. Texel centres sit on the ends of both ranges.
vec2 transmittanceUv(float h, float mu) {
  float H = sqrt(uTopRadius * uTopRadius - uGroundRadius * uGroundRadius);
  float rho = sqrt(max(h * (2.0 * uGroundRadius + h), 0.0)); // distance to the horizon
  float dMin = uTopRadius - uGroundRadius - h;
  float dMax = rho + H;
  vec2 x = vec2((distanceToTop(h, mu) - dMin) / (dMax - dMin), rho / H);
  return (clamp(x, 0.0, 1.0) * (uTransmittanceSize - 1.0) + 0.5) / uTransmittanceSize;
}

void transmittanceParams(vec2 uv, out float h, out float mu) {
  vec2 x = (uv * uTransmittanceSize - 0.5) / (uTransmittanceSize - 1.0);
  float H = sqrt(uTopRadius * uTopRadius - uGroundRadius * uGroundRadius);
  float rho = H * x.y;
  float r = sqrt(rho * rho + uGroundRadius * uGroundRadius);
  h = rho * rho / (r + uGroundRadius);
  float dMin = uTopRadius - r;
  float dMax = rho + H;
  float d = dMin + x.x * (dMax - dMin);
  mu = d <= 0.0 ? 1.0 : clamp((H * H - rho * rho - d * d) / (2.0 * r * d), -1.0, 1.0);
}

// Transmittance from (h, mu) to space: zero where the ground is in the way.
vec3 transmittance(float h, float mu) {
  if (distanceToGround(h, mu) >= 0.0) return vec3(0.0);
  return textureLod(uTransmittance, transmittanceUv(h, mu), 0.0).rgb;
}

// ---------------------------------------------------------------- sunlight by height

// The sun's illuminance on a surface facing it at height h, with the sun at
// zenith cosine muSun: through the air towards the sun's centre, kept up to the
// horizon, times the share of the disk above it. The horizon dips as h grows,
// so hilltops keep the sun a little longer than the beach. The probe's sun at
// sea level is the same (probe.frag, light.js). In `steps` steps of a direct
// march: the transmittance table's rows lie too far apart near the sea, where
// the haze makes the light change fastest.
vec3 sunAtHeight(float h, float muSun, int steps) {
  float dip = horizonDip(h);
  float x = clamp((asinPrecise(clamp(muSun, -1.0, 1.0)) + dip) / uSunRadius, -1.0, 1.0);
  float disk = 1.0 - (acos(x) - x * sqrt(1.0 - x * x)) / PI; // the area of a circle above a chord
  float mu = max(muSun, -sin(dip));
  return uSunIlluminance * exp(-opticalDepth(h, mu, distanceToTop(h, mu), steps)) * disk;
}

// ---------------------------------------------------------------- multiple scattering

// The multiple-scattering table by the sun's zenith cosine (x) and the height
// (y). Its columns crowd around the sun on the horizon, where the light changes
// fastest: evenly spaced, sunset's sky came out up to a quarter too bright.
vec2 multiscatterUv(float h, float muSun) {
  float m = clamp(muSun, -1.0, 1.0);
  vec2 x = clamp(vec2(0.5 + 0.5 * sign(m) * sqrt(abs(m)), h / (uTopRadius - uGroundRadius)), 0.0, 1.0);
  return (x * (uMultiscatterSize - 1.0) + 0.5) / uMultiscatterSize;
}

void multiscatterParams(vec2 uv, out float h, out float muSun) {
  vec2 x = (uv * uMultiscatterSize - 0.5) / (uMultiscatterSize - 1.0);
  float e = 2.0 * x.x - 1.0;
  muSun = sign(e) * e * e;
  h = x.y * (uTopRadius - uGroundRadius);
}

// Light scattered twice and more, per unit of sun illuminance, at height h with the
// sun at zenith cosine muSun (Hillaire's psi_ms).
vec3 multiscatter(float h, float muSun) {
  return textureLod(uMultiscatter, multiscatterUv(h, muSun), 0.0).rgb;
}

// ---------------------------------------------------------------- in-scattering

// Light scattered towards the viewer along a ray from height h in direction dir
// (y up) with the sun towards sun, over the first tMax km, in `steps` steps
// spaced closer near the start. Returns the radiance; throughput is the
// fraction of light from behind that gets through. A ray that runs on below
// the sea (the aerial-perspective table's do) follows the sea's surface there.
vec3 inscatter(float h, vec3 dir, vec3 sun, float tMax, int steps, out vec3 throughput) {
  float r = uGroundRadius + h;
  float cosTheta = dot(dir, sun);
  float phaseR = rayleighPhase(cosTheta);
  float phaseM = miePhase(cosTheta, uMieG);
  float phaseH = miePhase(cosTheta, uHazeG);
  vec3 radiance = vec3(0.0);
  vec3 through = vec3(1.0);
  for (int i = 0; i < steps; i++) {
    vec2 span = marchSpan(i, steps, tMax);
    float dt = span.y - span.x;
    float t = 0.5 * (span.x + span.y);
    float hs = heightAlong(h, dir.y, t);
    float muSun = dot(vec3(0.0, r, 0.0) + t * dir, sun) / (uGroundRadius + hs);
    hs = max(hs, 0.0);
    Medium m = medium(hs);
    vec3 sunlight = transmittance(hs, muSun);
    vec3 source = uSunIlluminance * (sunlight * (m.rayleigh * phaseR + m.mie * phaseM + m.haze * phaseH) + multiscatter(hs, muSun) * (m.rayleigh + m.mie + m.haze));
    vec3 stepThrough = exp(-m.extinction * dt);
    radiance += through * (source - source * stepThrough) / max(m.extinction, vec3(1e-9));
    through *= stepThrough;
  }
  throughput = through;
  return radiance;
}

// The sky's radiance from height h towards dir: everything scattered along the
// ray, plus the lit ground where the ray ends on it.
vec3 skyRadiance(float h, vec3 dir, vec3 sun, int steps) {
  float tGround = distanceToGround(h, dir.y);
  vec3 through;
  vec3 radiance = inscatter(h, dir, sun, tGround >= 0.0 ? tGround : distanceToTop(h, dir.y), steps, through);
  if (tGround >= 0.0) {
    vec3 p = vec3(0.0, uGroundRadius + h, 0.0) + tGround * dir;
    float muSun = dot(normalize(p), sun);
    radiance += through * uSunIlluminance * transmittance(0.0, muSun) * max(muSun, 0.0) * uGroundAlbedo / PI;
  }
  return radiance;
}
