// Light on the floor under shallow water (PLAN.md 7.6), in JS; water/water-caustics.wgsl is
// its twin, which draws it. Pure: a function of place, depth and time.
//
// The water's surface is never flat: ripples of a few centimetres to a few decimetres, running
// with the wind, tilt it, and each tilt bends the sun's light a little as it goes in. Where the
// surface curves like a lens the light gathers, and where it curves the other way it spreads, so
// the floor `depth` m down is lit by the light that went in over an area larger or smaller than
// its own: by the area's ratio, 1 / |det J|, J the derivative of where the light lands by where
// it went in (Wallace 2011, from the surface's own shape). In ankle-deep water the shortest ripples
// gather it into a fine bright net; deeper, they have crossed past their focus and blur, and the
// longer ones draw a wider, softer net: each ripple blurs out `beyond` times as deep as it gathers
// the light. The sun's own size blurs it too, the more the deeper. Longer waves carry the ripples
// to and fro, so they never lie in a lattice.
//
// A pixel too wide to hold a ripple's net drops it, the shortest first (`fade` of its length), so
// further off the net coarsens and melts into even light. Each floor point is lit by the light that
// went in at one point a step up the slope it came down, its brightest lines held to about `peak`
// times as bright as even light: the net is what this looks like, not the
// exact sum of every ray, so it is divided by its mean (means: at each of `depths` depths to
// `deepest` m, with each whole number of ripples dropped), and the floor is as bright on average
// as without it, at any depth and from any distance.
//
// createCaustics(settings, wind, loop, ior) -> { waves, means, at(x, z, depth, t, dropped) }:
// settings: config.water.caustics, its ripples shortest first; wind: the world way the ripples run
// (unit [x, z]); loop: s the waves come round in, whole turns of each ripple in it; ior: water's.
// at() -> how much of the sun's light reaches the floor there where it went in at x, z, per its mean
// (around 1), with `dropped` of the shortest ripples left out (dropped(footprint)), before its
// strength (water-caustics.wgsl causticLight).

import { Vector4 } from '../maths/index.js';

const G = 9.81;
const TENSION = 7.3e-5; // m3/s2: water's surface tension per its density, which speeds the shortest ripples

// The ripples: [wavelength m, steepness (amplitude x wave number), degrees off the wind] each.
export function causticWaves({ ripples }, [wx, wz], loop) {
  return ripples.map(([length, steepness, degrees], i) => {
    const k = (2 * Math.PI) / length;
    const t = (degrees * Math.PI) / 180;
    const [dx, dz] = [wx * Math.cos(t) - wz * Math.sin(t), wx * Math.sin(t) + wz * Math.cos(t)];
    // Capillary-gravity waves: whole turns in the loop, so nothing jumps as the time wraps.
    const w = Math.round((Math.sqrt(G * k + TENSION * k ** 3) * loop) / (2 * Math.PI)) * ((2 * Math.PI) / loop);
    return { kx: k * dx, kz: k * dz, a: steepness / k, w, phase: 2.399963 * i };
  });
}

// How many of the shortest ripples a pixel `footprint` m wide drops: none while it is under
// `fade` of the shortest's length, one more each time it grows by the ratio from one ripple's
// length to the next (the lengths go up evenly in ratio), all of them at last.
export function droppedBy(footprint, { ripples, fade }) {
  const shortest = ripples[0][0];
  const ratio = Math.log2(ripples.at(-1)[0] / shortest) / (ripples.length - 1);
  return Math.min(Math.max(Math.log2(Math.max(footprint, 1e-9) / (fade * shortest)) / ratio, 0), ripples.length);
}

export function createCaustics(settings, wind, loop, ior) {
  const { ripples, depths, deepest } = settings;
  for (let i = 1; i < ripples.length; i++) if (!(ripples[i][0] > ripples[i - 1][0])) throw new Error('config.water.caustics: the ripples go from the shortest up');
  const waves = causticWaves(settings, wind, loop);
  const bend = 1 - 1 / ior;
  const [blur, blurDeeper] = settings.blur;
  const [carried, over] = settings.wander;
  const turn = (2 * Math.PI) / over;
  const reach = new Float64Array(waves.length);

  // The light reaching the floor `depth` m down where it went in at x, z, at time t (the waves'
  // time, wrapped), with `dropped` of the shortest ripples left out, as drawn before its mean.
  function raw(x, z, depth, t, dropped) {
    const d = bend * depth;
    // How much of each ripple's tilt reaches the floor this deep: a ripple gathers the light
    // 1 / (a k^2) down, as the water bends it, and blurs out `beyond` times as deep; and none of a
    // ripple the pixel drops.
    waves.forEach(({ a, kx, kz }, i) => {
      reach[i] = Math.exp(-(((d * a * (kx * kx + kz * kz)) / settings.beyond) ** 2)) * Math.min(Math.max(i + 1 - dropped, 0), 1);
    });
    // Carried to and fro by the longer waves.
    const [cx, cz] = [x + carried * Math.sin(turn * (0.8 * x + 0.6 * z) + 1.3), z + carried * Math.sin(turn * (-0.6 * x + 0.8 * z) - 0.7)];
    // Where it went in: a step up the slope from straight above.
    let gx = 0;
    let gz = 0;
    waves.forEach(({ kx, kz, a, w, phase }, i) => {
      const c = reach[i] * a * Math.cos(kx * cx + kz * cz - w * t + phase);
      gx += c * kx;
      gz += c * kz;
    });
    const [px, pz] = [cx + d * gx, cz + d * gz];
    let hxx = 0;
    let hxz = 0;
    let hzz = 0;
    waves.forEach(({ kx, kz, a, w, phase }, i) => {
      const s = -reach[i] * a * Math.sin(kx * px + kz * pz - w * t + phase);
      hxx += s * kx * kx;
      hxz += s * kx * kz;
      hzz += s * kz * kz;
    });
    const det = (1 - d * hxx) * (1 - d * hzz) - d * d * hxz * hxz;
    const soft = blur + blurDeeper * depth;
    // Its brightest lines held to about `peak` times as bright as even light.
    const gathered = 1 / Math.sqrt(det * det + soft * soft);
    return gathered / (1 + gathered / settings.peak);
  }

  // The mean of raw() at each depth, for each whole number of ripples dropped ([dropped][depth]),
  // at points strewn over a patch of the floor many of the longest ripples across, at times strewn
  // over a minute: on a grid they would fall in step with the ripples.
  const span = 13.7 * ripples.at(-1)[0];
  const samples = 1200;
  const strewn = Array.from({ length: samples }, (_, n) => [((n * 0.618034) % 1) * span, ((n * 0.754878) % 1) * span, ((n * 0.569840) % 1) * 61]);
  const means = [];
  for (let dropped = 0; dropped <= waves.length; dropped++) {
    const row = [];
    for (let j = 0; j < depths; j++) {
      const depth = (j / (depths - 1)) * deepest;
      let sum = 0;
      for (const [x, z, t] of strewn) sum += raw(x, z, depth, t, dropped);
      row.push(sum / samples);
    }
    means.push(row);
  }

  // The mean at `depth` with `dropped` ripples left out, between the table's entries as the GPU's twin reads it.
  function meanAt(depth, dropped) {
    const at = (Math.min(Math.max(depth, 0), deepest) / deepest) * (depths - 1);
    const j = Math.min(Math.floor(at), depths - 2);
    const i = Math.min(Math.floor(dropped), waves.length - 1);
    const along = (row) => row[j] + (row[j + 1] - row[j]) * (at - j);
    return along(means[i]) + (along(means[i + 1]) - along(means[i])) * (dropped - i);
  }

  return { waves, means, at: (x, z, depth, t, dropped = 0) => raw(x, z, depth, t, dropped) / meanAt(depth, dropped) };
}

const WAVES = 8; // water-caustics.wgsl holds this many ripples
const DEPTHS = 16; // and this many depths of their means

// The uniforms of water-caustics.wgsl.
export function causticUniforms(settings, { waves, means }, ior) {
  if (waves.length !== WAVES) throw new Error(`config.water.caustics: ${waves.length} ripples; water-caustics.wgsl holds ${WAVES}`);
  if (settings.depths !== DEPTHS) throw new Error(`config.water.caustics: ${settings.depths} depths; water-caustics.wgsl holds ${DEPTHS}`);
  const fours = (values) => Array.from({ length: values.length / 4 }, (_, i) => new Vector4(...values.slice(4 * i, 4 * i + 4)));
  const { ripples, fade } = settings;
  return {
    uCausticWaves: { value: waves.map(({ kx, kz, a, w }) => new Vector4(kx, kz, a, w)) },
    uCausticPhases: { value: fours(waves.map(({ phase }) => phase)) },
    uCausticMeans: { value: fours(means.flat()) },
    uCaustic: { value: new Vector4(...settings.blur, settings.beyond, settings.deepest) },
    uCausticWander: { value: new Vector4(settings.wander[0], (2 * Math.PI) / settings.wander[1], settings.strength, 1 - 1 / ior) },
    uCausticFade: { value: new Vector4(fade * ripples[0][0], Math.log2(ripples.at(-1)[0] / ripples[0][0]) / (ripples.length - 1), settings.peak, 0) },
  };
}
