// How the sea looks by how deep it is: the water's own light and what is left
// of the seabed's. The twin of water/optics.js, whose header has the model; the
// water fixture holds them to each other. A file of its own, so the fixture's
// shader reads the same code the water does.

#include "/chunks/pi.wgsl"

struct WaterOptics {
  uDimming: vec3f, // per metre, per channel: how fast light dims on its way through the water
  uBody: vec3f, // linear: what deep water sends back of the light on it
  uThrough: f32, // the share of the seabed's light that leaves through the surface
  uIor: f32,
  uSeabedFade: vec2f, // m: how deep the seabed starts to fade, and is gone
}

const SKY_COSINE: f32 = 0.84; // the sky's light under the surface, on average: its way down, as a cosine
const SKY_THROUGH: f32 = 0.934; // and the share of it the surface lets through
const THROUGH_DEPTH: f32 = 0.08; // m: how deep the seabed's light starts to lose its share at the surface

// The cosine under the surface of a ray at cosine c above it.
fn cosineBelow(c: f32, ior: f32) -> f32 {
  return sqrt(max(1.0 - (1.0 - c * c) / (ior * ior), 0.0));
}

// The share of light a surface mirrors at cosine c (Schlick, water's 2% head-on).
fn surfaceMirror(c: f32) -> f32 {
  let m = 1.0 - clamp(c, 0.0, 1.0);
  return 0.02 + 0.98 * m * m * m * m * m;
}

// How much of the seabed shows under this much water, 1 to 0: it ends before the
// water hides it wholly, as nothing is drawn below that.
fn seabedSeen(depth: f32, fade: vec2f) -> f32 {
  return 1.0 - smoothstep(fade.x, fade.y, depth);
}

// The water's own light and what is left of the seabed's, coming up through the
// surface towards the eye, before it mirrors its share at the surface. seabed:
// the seabed's radiance in air; viewCos, sunCos: above the surface; sun, sky:
// the irradiance on the surface from each.
fn waterLeaving(optics: WaterOptics, seabed: vec3f, depth: f32, viewCos: f32, sunCos: f32, sun: vec3f, sky: vec3f) -> vec3f {
  let up = 1.0 / cosineBelow(viewCos, optics.uIor);
  let es = exp(-optics.uDimming * depth * (1.0 / cosineBelow(sunCos, optics.uIor) + up));
  let ek = exp(-optics.uDimming * depth * (1.0 / SKY_COSINE + up));
  let sunIs = sun * (1.0 - surfaceMirror(sunCos));
  let skyIs = sky * SKY_THROUGH;
  let seen = seabedSeen(depth, optics.uSeabedFade);
  let own = optics.uBody * (sunIs * (1.0 - es * seen) + skyIs * (1.0 - ek * seen)) / PI;
  // A film of water loses nothing at its surface; a pane of it its share.
  let through = mix(1.0, optics.uThrough, 1.0 - exp(-depth / THROUGH_DEPTH));
  let bed = through * seabed * seen * (sunIs * es + skyIs * ek) / max(sun + sky, vec3f(1e-6));
  return own + bed;
}
