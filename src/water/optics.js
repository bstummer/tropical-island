// How the sea looks by how deep it is: the twin of water-optics.wgsl, which the
// water fixture checks it against, and what the light from below reads over
// water (world/albedo.js). Pure.
//
// The model remote sensing uses for clear shallow seas (Maritorena, Morel and
// Gentili 1994): light going down and coming back up dims per channel with the
// distance it travels through the water, so red goes in a few metres and blue
// lasts tens; what the seabed sends back is what is left of it, and what the
// water itself sends back makes up the difference, from nothing at the surface
// to its colour over deep water:
//
//   R(depth) = body x (1 - e) + through x seabed x e,  e = exp(-dimming x depth x paths)
//
// paths: how many times the depth the light's way down and back up comes to,
// each way as bent by the surface. config.water holds the numbers.

const SKY_COSINE = 0.84; // the sky's light under the surface, on average: its way down, as a cosine
const SKY_THROUGH = 0.934; // and the share of it the surface lets through
const THROUGH_DEPTH = 0.08; // m: how deep the seabed's light starts to lose its share at the surface

// The cosine under the surface of a ray at cosine c above it.
export function cosineBelow(c, ior) {
  const s = (1 - c * c) / (ior * ior);
  return Math.sqrt(Math.max(1 - s, 0));
}

// The share of light a surface mirrors at cosine c (Schlick, water's 2% head-on).
export function surfaceMirror(c) {
  const m = 1 - Math.min(Math.max(c, 0), 1);
  return 0.02 + 0.98 * m * m * m * m * m;
}

// How much of the seabed shows under this much water, 1 to 0 between
// seabedFade's depths: it ends before the water hides it wholly, as nothing is
// drawn below that.
export function seabedSeen(depth, seabedFade) {
  const x = Math.min(Math.max((depth - seabedFade[0]) / (seabedFade[1] - seabedFade[0]), 0), 1);
  return 1 - x * x * (3 - 2 * x);
}

// The water's own light and what is left of the seabed's, per channel, coming
// up through the surface towards the eye (before it mirrors its share at the
// surface): seabed is the radiance of the seabed in air; depth in metres;
// viewCos the view's cosine above the surface, sunCos the sun's; sun and sky
// the irradiance on the surface from each, per channel. Into `out`.
export function waterLeaving(seabed, depth, viewCos, sunCos, sun, sky, { dimming, body, through, ior, seabedFade }, out = [0, 0, 0]) {
  const up = 1 / cosineBelow(viewCos, ior);
  const sunWay = depth * (1 / cosineBelow(sunCos, ior) + up);
  const skyWay = depth * (1 / SKY_COSINE + up);
  const sunIn = 1 - surfaceMirror(sunCos);
  const seen = seabedSeen(depth, seabedFade);
  // A film of water loses nothing at its surface; a pane of it its share.
  const leaves = 1 + (through - 1) * (1 - Math.exp(-depth / THROUGH_DEPTH));
  for (let c = 0; c < 3; c++) {
    const sunIs = sun[c] * sunIn;
    const skyIs = sky[c] * SKY_THROUGH;
    const es = Math.exp(-dimming[c] * sunWay);
    const ek = Math.exp(-dimming[c] * skyWay);
    const own = (body[c] * (sunIs * (1 - es * seen) + skyIs * (1 - ek * seen))) / Math.PI;
    const bed = (leaves * seabed[c] * seen * (sunIs * es + skyIs * ek)) / Math.max(sun[c] + sky[c], 1e-6);
    out[c] = own + bed;
  }
  return out;
}

// What the sea sends back of the light on it, seen from above and averaged over
// the angles: for the light from below. Over deep water the sea's albedo `sea`
// (the surface's mirror and the water's own light together); over a seabed of
// this albedo, this deep, that plus what is left of the seabed's.
export function seaAlbedo(depth, seabed, sea, { dimming, through, ior, seabedFade }, out = [0, 0, 0]) {
  const way = depth * (1 / SKY_COSINE + 1 / cosineBelow(SKY_COSINE, ior));
  const seen = seabedSeen(depth, seabedFade);
  for (let c = 0; c < 3; c++) out[c] = sea[c] + through * seabed[c] * seen * Math.exp(-dimming[c] * way);
  return out;
}
