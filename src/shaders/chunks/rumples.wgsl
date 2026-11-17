// The rumples the backwash leaves on wet sand (chunks/sand.wgsl), from swells half a
// metre across to pits and crumbs of a few centimetres, too shallow to shade but
// enough to tilt the water in and on them: the sand's sheen, and the glassy film the
// water draws over it (water/water.wgsl), so a low sun mirrored in either breaks into
// the same streak of glints. The film lies in their hollows and drains off their crests
// first (rumplesFilmOver), the terrain's sheen showing where it has gone.

#include "noise.wgsl"

// The rumples at xz for a pixel `footprint` m wide, the largest `wavelength` m with `slope`, and two
// finer scales, each 0.3 the last and steeper: their slope (dh/dx, dh/dz, world), and the variance
// of the slopes of those too small for the pixel, which it can't hold, as GGX's alpha squared.
// Each scale drops out once a pixel can't hold it, so further away the glints merge into a broad
// path of glitter rather than sparkle. And from the same reads their heights, as the film over them
// takes them (rumplesFilmOver): what of them the pixel holds, and the variance of what it can't hold
// or what varies across it, per its noise's.
struct Rumples {
  slope: vec2f,
  lost: f32,
  height: f32,
  unheld: f32,
}

fn rumplesAt(xz: vec2f, footprint: f32, wavelength: f32, slope: f32) -> Rumples {
  var r = Rumples(vec2f(0.0), 0.0, 0.0, 0.0);
  var size = wavelength;
  for (var k = 0; k < 3; k++) {
    let steep = slope * (0.3 + 0.5 * f32(k)); // the smaller, the steeper
    let held = smoothstep(4.0, 10.0, size / footprint);
    let noise = gradientNoiseD(xz / size + 7.3 * f32(k));
    // The noise's slope is about 1.4 across a unit of it on average.
    r.slope += held * steep / 1.4 * noise.yz;
    r.lost += 2.0 * (1.0 - held * held) * steep * steep;
    rumplesHeld(&r, noise.x, held, (0.3 + 0.5 * f32(k)) * size / wavelength, footprint / size);
    size *= 0.3;
  }
  return r;
}

// Adds a size of them `tall` (as steep as rumplesAt makes it, per its slope, times its size)
// whose noise is `noise` here, `held` as much as the pixel holds it, the pixel `across` of its size wide.
fn rumplesHeld(r: ptr<function, Rumples>, noise: f32, held: f32, tall: f32, across: f32) {
  (*r).height += held * tall * noise;
  let varies = held * RUMPLES_ACROSS * across;
  (*r).unheld += (1.0 - held * held + varies * varies) * tall * tall;
}

// What all the rumples add to a roughness where a pixel holds none of them.
fn rumplesSpread(slope: f32) -> f32 {
  return 2.0 * slope * slope * (0.09 + 0.64 + 1.69);
}

// The deviation of gradientNoise's value, and of its slope along x or z per unit, and how
// much the film's heights vary across a pixel per its width over their size, per that
// deviation: the slope's two axes over a box (sqrt(2) 0.715 / sqrt(12) / 0.2463).
const RUMPLES_NOISE: f32 = 0.2463;
const RUMPLES_ACROSS: f32 = 1.19;
// The sum of the squares of the heights of the rumples' three sizes and the grains, per their noise's.
const RUMPLES_TALL: f32 = 0.16365;

// How much of a pixel a film of water covers, `film` of it on average, where the sand under it
// stands `height` above its mean and what the pixel can't hold of it varies by `lost`, both per
// the deviation of all of it: the hollows hold it, and the crests dry first. A logistic law
// (the sand's heights near enough one), so a pixel that holds none of them (height 0, lost 1)
// is covered `film`. water/swash.js filmCovers is its twin.
fn filmCovers(film: f32, height: f32, lost: f32) -> f32 {
  if (film <= 0.0 || film >= 1.0) {
    return clamp(film, 0.0, 1.0);
  }
  return 1.0 / (1.0 + exp(clamp((1.8138 * height - log(film / (1.0 - film))) / max(lost, 1e-3), -60.0, 60.0)));
}

// How much of the ground at xz the film the waves leave covers, `film` of it on average, for a
// pixel `footprint` m wide over rumples whose largest are `wavelength` m, `r` as rumplesAt() found
// them there: it lies in their hollows, and the grains' a third the size of their finest, and as it
// drains it breaks into glassy patches and specks of glint. Each size goes as rumplesAt's does once a
// pixel can't hold it, and a pixel too wide for any is covered `film`, so from afar it is as before.
fn rumplesFilmOver(film: f32, r: Rumples, xz: vec2f, footprint: f32, wavelength: f32) -> f32 {
  if (film <= 0.0 || film >= 1.0) {
    return clamp(film, 0.0, 1.0);
  }
  var all = r;
  let size = 0.027 * wavelength;
  let held = smoothstep(4.0, 10.0, size / footprint);
  var noise = 0.0;
  if (held > 0.0) {
    noise = gradientNoise(xz / size + 21.9);
  }
  rumplesHeld(&all, noise, held, 1.8 * 0.027, footprint / size);
  return filmCovers(film, all.height / (RUMPLES_NOISE * sqrt(RUMPLES_TALL)), sqrt(all.unheld / RUMPLES_TALL));
}

// The same where the rumples weren't read.
fn rumplesFilm(film: f32, xz: vec2f, footprint: f32, wavelength: f32) -> f32 {
  if (film <= 0.0 || film >= 1.0 || footprint * 4.0 >= wavelength) {
    return clamp(film, 0.0, 1.0);
  }
  return rumplesFilmOver(film, rumplesAt(xz, footprint, wavelength, 0.0), xz, footprint, wavelength);
}
