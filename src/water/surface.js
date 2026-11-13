// The sea's surface in JS (CLAUDE.md §5): how high the water stands at any place
// and time, as water/water.wgsl draws it, for walking, swimming and sound. Pure.
// It sums the largest of the same waves the GPU sums by FFT (water/spectrum.js),
// each cascade scaled by how much of it reaches the point (water/sea-map.js). The
// small ones it leaves out don't move a swimmer; the water fixture holds the sum
// of them all to the GPU's textures at sample points.

import { largestWaves } from './spectrum.js';

// shallow: { share, groundAt(x, z) }: the waves draw the surface down no more than `share` of
// the water under it, to the ground as drawn (sea-map.wgsl troughFloor); none: as deep as they go.
// beach: { swash, band, wets } (water/swash.js's at(); config.water.swash): near a shore, as
// water/water.wgsl's vertices, the waves coming in over the last of the shallows (at.bore()),
// and the beach's water, the sheet a wave runs up and the sea's edge drawn down after it, which
// takes over from the sea's over `band` m of depth, as high up the beach as `wets` times a full
// wave's run-up; over that, bare ground has none. Needs shallow.
export function createSurface(spectrum, map, toCove, { rest, most }, ripplesLeast, ripplesDepth = 1, surf = null, chopWander = { reach: 0, across: 1 }, shallow = null, beach = null) {
  const waves = spectrum.cascades.map((c) => ({ waves: largestWaves(c, rest, most), choppy: c.choppy }));
  const here = {};
  const breaking = {};
  const wash = {};
  const coming = {};
  const smoothstep = (a, b, x) => {
    const t = Math.min(Math.max((x - a) / (b - a), 0), 1);
    return t * t * (3 - 2 * t);
  };

  // How the cascades reach a point (cascadeReach in water/sea-map.wgsl): the
  // swell as far as it arrives, the chop's long waves as the map says, its
  // ripples as much anywhere there is water to move, more where the chop is up,
  // dying out over the last of the water at the waterline.
  function reachInto(x, z, out) {
    map.at(...toCove(x, z), here);
    const t = Math.min(Math.max(here.depth / ripplesDepth, 0), 1);
    out[0] = here.swell;
    out[1] = here.chop;
    out[2] = Math.max(here.chop, ripplesLeast) * t * t * (3 - 2 * t);
    return out;
  }

  // Where the chop's tile is read (chopRest in water/sea-map.wgsl).
  const wanderAt = (2 * Math.PI) / chopWander.across;
  function chopRest(x, z, out) {
    const [a, b] = [x * wanderAt, z * wanderAt];
    out[0] = x + chopWander.reach * (Math.sin(0.946 * a + 0.324 * b) + 0.5 * Math.sin(-0.543 * a + 1.503 * b));
    out[1] = z + chopWander.reach * (Math.sin(-0.365 * a + 0.9 * b) + 0.5 * Math.sin(1.574 * a + 0.492 * b));
    return out;
  }
  const chopAt = [0, 0];

  // Height and sideways displacement of the sum of `list` at x, z (the point the
  // waves move, not where it ends up), into `out`.
  function displaced(list, choppy, x, z, wrapped, out, scale) {
    for (const { kx, kz, re, im, w } of list) {
      const phase = kx * x + kz * z - w * wrapped;
      const c = Math.cos(phase);
      const s = Math.sin(phase);
      // h0(k) e^(i(k.x - w t)) and its conjugate, the real field's own part.
      out[1] += scale * 2 * (re * c - im * s);
      const k = Math.hypot(kx, kz);
      // i k / |k| times it: a quarter of a wave off, so crests sharpen.
      const lean = -2 * (re * s + im * c);
      out[0] += scale * choppy * (kx / k) * lean;
      out[2] += scale * choppy * (kz / k) * lean;
    }
    return out;
  }

  const reach = [0, 0, 0];
  const moved = [0, 0, 0];

  // The displacement of the water at x, z at time t, from its largest waves, as
  // [x, height, z]: the sum, scaled per cascade as the GPU scales it.
  function displacement(x, z, t, out = [0, 0, 0]) {
    const wrapped = t - spectrum.loop * Math.floor(t / spectrum.loop);
    reachInto(x, z, reach);
    out[0] = out[1] = out[2] = 0;
    waves.forEach((cascade, c) => {
      if (reach[c] <= 0) return;
      if (c === 1) chopRest(x, z, chopAt);
      displaced(cascade.waves, cascade.choppy, c === 1 ? chopAt[0] : x, c === 1 ? chopAt[1] : z, wrapped, out, reach[c]);
    });
    if (surf) out[1] += surf(here, x, z, wrapped, breaking).height;
    coming.height = 0;
    if (beach) {
      const [a, o] = toCove(x, z);
      beach.swash.bore(here, a, o, wrapped, coming);
      out[1] += coming.height;
    }
    if (shallow) {
      const ground = shallow.groundAt(x, z);
      out[1] = Math.max(out[1], shallow.share * Math.min(ground, 0));
      if (beach && ground > -beach.band && ground < beach.wets * beach.swash.runs(here)) {
        const [a, o] = toCove(x, z);
        beach.swash(here, a, o, ground, wrapped, wash, 0, coming.height);
        const takes = 1 - smoothstep(0.5 * beach.band, beach.band, -ground);
        out[0] *= 1 - takes;
        out[2] *= 1 - takes;
        out[1] += (ground + wash.cover - out[1]) * takes;
      }
    }
    return out;
  }

  // How high the water stands above the still sea over x, z at time t: the
  // crest there came from a little way off, so it follows the sideways
  // displacement back, as far as it matters.
  function heightAt(x, z, t) {
    let [px, pz] = [x, z];
    for (let i = 0; i < 3; i++) {
      displacement(px, pz, t, moved);
      px = x - moved[0];
      pz = z - moved[2];
    }
    return displacement(px, pz, t, moved)[1];
  }

  return { heightAt, displacement, reachInto, waves };
}
