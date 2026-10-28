// The leaf litter's tones evened out, and its leaves' masks (textures/green.js).
// chunks/green.wgsl greenLeaves shows the litter tile's leaves by their tone,
// as many as a share asks, the lightest first (dead leaves) or the darkest
// (green ones), and greenShownTone takes those tones to spread evenly over 0
// to 1. As litter.wgsl draws them they don't: big leaves keep to middling
// tones, twigs are dark, and veins, rims and shade only darken, so the
// lightest leaves were few, and the scrub's dead leaves covered half their
// share, the sandy soil showing in their place (PLAN.md 4.8). Mapped through
// their own distribution, as measured, they spread evenly and keep their
// order. Nor can a pixel that sees a few leaves pick them by tone: it sees
// their tones mixed, of which the lightest and darkest are too few, so the
// leaves would fade or vanish as it grows. The masks say which leaves show
// for a few shares, and their mips how much of a pixel those cover at any
// distance. Pure and Node-importable.

export const TONES = 256; // the table's entries, at tones k / 255

// A texel's leaf tone, from its tone and cover as litter.wgsl gives them (0 to
// 1): where leaves cover part of it, the soil's 0.5 shows in the rest.
export function leafTone(tone, cover) {
  return (tone - (1 - cover) * 0.5) / Math.max(cover, 1e-3);
}

// The table that evens out the leaf tones of a tile's texels (`pixels`: RGBA
// bytes, tone in b, cover in a): for each tone k / 255, the share of the
// leaves (weighted by cover) lighter than it, those of its own tone counted
// half. Read between entries, it maps the tones onto 0 to 1 evenly.
export function evenTones(pixels) {
  const weights = new Float64Array(TONES);
  let total = 0;
  for (let i = 0; i < pixels.length; i += 4) {
    const cover = pixels[i + 3] / 255;
    if (cover === 0) continue;
    weights[Math.round(clamp(leafTone(pixels[i + 2] / 255, cover)) * (TONES - 1))] += cover;
    total += cover;
  }
  const table = new Float64Array(TONES);
  let below = 0;
  for (let k = 0; k < TONES; k++) {
    table[k] = total > 0 ? (below + weights[k] / 2) / total : k / (TONES - 1);
    below += weights[k];
  }
  return table;
}

// The litter tile as drawn (`pixels`, `size` texels across, a power of two)
// with its leaf tones evened out, and its leaves' masks: for each of up to
// four `shares` (0 to 1), how much of a texel the lightest leaves of that
// share cover (rgba, one share each), so the darkest ones' too, as what is
// left. Each with its mip levels, each texel the average of the four above
// it, rounded half to even (as gpu/mipmap.wgsl makes them): a pixel too large
// to tell the leaves apart reads how much of it they cover, so the same
// leaves show at every distance, shrinking with it. Returns { litter, leaves }:
// the levels' RGBA bytes, from the tile's own down to one texel.
export function litterLevels(pixels, size, shares = []) {
  const table = evenTones(pixels);
  let level = new Uint8Array(pixels);
  let masks = new Uint8Array(pixels.length);
  for (let i = 0; i < level.length; i += 4) {
    const cover = level[i + 3] / 255;
    const at = clamp(leafTone(level[i + 2] / 255, cover)) * (TONES - 1);
    const k = Math.min(Math.floor(at), TONES - 2);
    const even = table[k] + (table[k + 1] - table[k]) * (at - k);
    level[i + 2] = Math.round(255 * (cover * even + (1 - cover) * 0.5));
    shares.forEach((share, c) => (masks[i + c] = even < share ? level[i + 3] : 0));
  }
  const litter = [level];
  const leaves = [masks];
  for (let n = size; n > 1; n /= 2) {
    litter.push((level = halved(level, n)));
    leaves.push((masks = halved(masks, n)));
  }
  return { litter, leaves };
}

function halved(pixels, n) {
  const m = n / 2;
  const out = new Uint8Array(4 * m * m);
  for (let y = 0; y < m; y++) {
    for (let x = 0; x < m; x++) {
      const a = 4 * (2 * y * n + 2 * x);
      const b = a + 4 * n;
      for (let c = 0; c < 4; c++) out[4 * (y * m + x) + c] = halfEven((pixels[a + c] + pixels[a + 4 + c] + pixels[b + c] + pixels[b + 4 + c]) / 4);
    }
  }
  return out;
}

// Rounded to the nearest whole number, halves to the even one (WGSL's round()).
function halfEven(v) {
  const r = Math.round(v);
  return r - v === 0.5 && r % 2 !== 0 ? r - 1 : r;
}

function clamp(v) {
  return Math.min(Math.max(v, 0), 1);
}
