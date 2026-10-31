// What the sea's surface mirrors, as a far pixel holds many waves and a near one
// few: after Bruneton, Neyret and Holzschuch (2010), a wave too small for the
// pixel (water/spectrum.js unresolvedSlopes) doesn't vanish but widens what the
// surface mirrors, by the variance of its slopes. So the sun is glints up close,
// a smooth band of light far off, with the same light on average, and the far
// sea mirrors less sky at a grazing angle than a smooth one would.

#include "/chunks/pi.wgsl"

// The share of the light a surface with this variance of its slopes (per axis)
// mirrors on average at cosine c: Schlick's over Gaussian slopes, its moments in
// closed form, then held down towards the horizon, where waves hide their far sides
// from the eye (what Bruneton et al. fit); the near sea, which shows them, holds it
// to itself (the `sea light` check).
fn seaMirrored(c: f32, variance: f32) -> f32 {
  let m = 1.0 - clamp(c, 0.0, 1.0);
  let m2 = m * m;
  let mean = min(m2 * m2 * m + 10.0 * m2 * m * variance + 15.0 * m * variance * variance, 1.0);
  let hidden = mean * 40.0 * pow(variance, 0.75);
  return 0.02 + 0.98 * mean / pow(1.0 + hidden * hidden * hidden, 1.0 / 3.0);
}

// The sun's glow in direction dir, per unit of its light, as sky/sky.wgsl draws it:
// aureole holds how sharp its peak is and how strong. `blur`: the mean square angle
// (radians) over which waves spread what the surface mirrors of it.
fn sunGlow(dir: vec3f, aureole: vec2f, blur: f32) -> f32 {
  let g = aureole.x;
  return aureole.y * (1.0 - g * g) / (4.0 * PI * pow(1.0 + g * g - 2.0 * g * dot(dir, frame.uSunDirection) + g * blur, 1.5));
}

// Smith's shadowing of such a surface at cosine c.
fn seaShadowing(c: f32, variance: f32) -> f32 {
  let cosine = clamp(c, 0.01, 0.9999);
  let v = cosine / sqrt((1.0 - cosine * cosine) * 2.0 * variance);
  // As Walter et al. (2007) fit it.
  return select(0.0, (1.0 - 1.259 * v + 0.396 * v * v) / (3.535 * v + 2.181 * v * v), v < 1.6);
}

// The share of the sun's light sent towards the eye (view) by a surface with this
// mean normal and variance of its slopes: in the half vector's slope, Gaussian
// with a tenth of it in a Gaussian much wider, as real seas' slopes have heavier
// tails than a Gaussian's: what gives a path of sun its soft shoulders.
fn seaGlitter(n: vec3f, view: vec3f, sun: vec3f, variance: f32) -> f32 {
  let h = normalize(sun + view);
  let hn = max(dot(h, n), 0.01);
  let slope2 = max(1.0 / (hn * hn) - 1.0, 0.0);
  let wide = 6.0 * variance;
  let peak = 0.9 * exp(-0.5 * slope2 / variance) / (2.0 * PI * variance) + 0.1 * exp(-0.5 * slope2 / wide) / (2.0 * PI * wide);
  let vn = max(dot(view, n), 0.01);
  let ln = max(dot(sun, n), 0.01);
  let fresnel = 0.02 + 0.98 * pow(1.0 - clamp(dot(view, h), 0.0, 1.0), 5.0);
  return fresnel * peak / ((1.0 + seaShadowing(ln, variance) + seaShadowing(vn, variance)) * 4.0 * vn * hn * hn * hn * hn);
}

// Turned, so their rows run along neither the world's axes nor each other.
const GLINT_TURNS = array<mat2x2f, 3>(mat2x2f(0.8192, 0.5736, -0.5736, 0.8192), mat2x2f(0.9272, -0.3746, 0.3746, 0.9272), mat2x2f(0.6, 0.8, -0.8, 0.6));
const GLINT_CELLS = 128.0; // spots across the tile: textures/glints-tile.wgsl has the same
const GLINT_LEAST = 0.0005; // exposed, under which even its brightest flash wouldn't show
const GLINT_SPOT = 0.362; // how much of a cell a spot's light would fill: 2 pi times the square of its width there
// A pixel's width in cells, from which a spot, a little over half a cell across, has
// its say, and has it in full: no more than a point or two, never seen as a round dot.
const GLINT_SAY = vec2f(0.2, 0.4);

// Glints: the sun's smooth light comes from facets each a mirror of it, too few up
// close to average out. Three reads of a tile of sparse spots (textures/glints.js),
// drifting through each other, light up where their spots meet; as a pixel covers
// more of them the GPU's filtering melts them into the smooth light, the same on
// average, with nothing to pop as the eye moves. Close enough to see a spot's shape they
// give way, as there the surface's own waves are sharp enough to shape what they
// mirror. Brightness and how much of the pixel a glint covers kept apart, so the ceiling
// (as the sky's disk has) leaves its edge soft; what it takes from a flash stays in the
// smooth light, or the path would go dark where flashes stand far over it. `light`: the smooth light; `rest`, `dx`,
// `dy`: where on the water, and the pixel's sides there (m); `area`: its ground (m2);
// `seconds`, wrapped.
fn seaGlints(light: vec3f, rest: vec2f, dx: vec2f, dy: vec2f, area: f32, seconds: f32) -> vec3f {
  // Most of the sea has no sun in it to speak of, and these reads cost as much as all else.
  if (max(light.r, max(light.g, light.b)) * frame.uExposure < GLINT_LEAST) {
    return light;
  }
  var spots = 1.0;
  var peak = 1.0;
  for (var i = 0; i < 3; i++) {
    let size = water.uGlintSizes[i];
    let turn = GLINT_TURNS[i];
    let at = turn * rest / size + water.uGlintDrift[i].xy * seconds;
    let read = textureSampleGrad(uSurfaceTiles, uSurfaceTilesSampler, at, i32(TILE_GLINTS), turn * dx / size, turn * dy / size)[i % 2];
    let cells = area * GLINT_CELLS * GLINT_CELLS / (size * size);
    let say = smoothstep(GLINT_SAY.x, GLINT_SAY.y, sqrt(cells));
    spots *= mix(water.uGlintMean, read, say);
    // The brightest a pixel this wide can see one, down to the mean once it covers many.
    peak *= mix(water.uGlintMean, clamp(GLINT_SPOT / cells, water.uGlintMean, 1.0), say);
  }
  let flash = peak / (water.uGlintMean * water.uGlintMean * water.uGlintMean);
  let held = 1.0 + max(light.r, max(light.g, light.b)) * frame.uExposure / water.uSunCeiling;
  let kept = held / (1.0 + (held - 1.0) * flash + 0.0);
  return light / held * (flash * min(spots / peak, 1.0) * kept + 1.0 - kept);
}
