// Tool fixture (?fixture=patches): the green's patches the GPU draws
// (chunks/patches.wgsl) must be the ones JS knows (world/green.js), which
// placement reads (Stage 9). At boot it has the GPU evaluate them at seeded
// points, out past the island's far side and on both sides of zero, for
// seeded seeds, and leaves in window.__PATCHES__ how far the GPU's values
// land from JS's at worst, and how far they land with the points shifted by
// a tenth of a patch, a deliberate mistake the comparison has to catch.
//
// And the green as drawn (chunks/green.wgsl, with its detail, and where it
// gives way to sand) must lie where it lies from wherever it is seen: what is
// green, what bare and what sand, and their colours. It has the GPU draw
// seeded cells of ground, half a metre across, as cameras at eye height from
// 2.5 m to 100 m off and one high up see them, through the same pixel, at
// three sizes of it from a blade's to the detail's end; the detail fades with
// the distance, keeping its average. Cells where green meets sand, of scrub
// on sandy ground and of the palm belt and jungle. Per cell it compares each
// camera's average with the nearest's, and leaves the worst in
// window.__PATCHES__.seen: of the sand's share, and of the albedo (the largest
// change of a channel); its deliberate mistake: the far camera's cells a tenth
// of a patch off. The albedo's limit is absolute and the green's albedos are
// low, so it sees green or bare turning to sand, and not a change between green
// and bare as small as the old slant's in the palm belt and jungle (about 0.1).
// Draws nothing. Not part of the island.
import { Vector2, Vector3 } from '../maths/index.js';
import shader from './patches.wgsl';
import seenShader from './patches-seen.wgsl';
import { Material } from '../gpu/material.js';
import { createTarget, Texture } from '../gpu/texture.js';
import { greenCover, greenPatches } from '../world/green.js';
import { createSurfaceTiles, tilesUniforms } from '../textures/surfaces.js';
import { sandUniforms } from '../textures/sand.js';
import { greenUniforms } from '../textures/green.js';

const POINTS = 1024;
const REACH = 4000; // m either side of the origin
// The seen check: cells, half a metre across, of SAMPLES x SAMPLES samples
// (as patches-seen.wgsl), within reach m of the origin; the cameras ([m off,
// m up]), the first the one the others are held to; the pixel's sizes (m
// along x and z: a slanting view's).
const SEEN = {
  cells: 1024,
  cell: 0.5,
  samples: 8,
  reach: 600,
  cameras: [[2.5, 1.7], [6, 1.7], [15, 1.7], [40, 1.7], [100, 1.7], [30, 25]],
  footprints: [[0.002, 0.005], [0.006, 0.014], [0.015, 0.04]],
};

export function create(ctx) {
  const { renderer, config, gpu } = ctx;
  const { green } = config.world.terrain;
  const r = ctx.rng('fixtures/patches');
  const seeds = [r.int(0, 0xffffff), r.int(0, 0xffffff)];
  const points = Array.from({ length: POINTS }, () => [r.range(-REACH, REACH), r.range(-REACH, REACH)]);
  const data = new Float32Array(4 * POINTS);
  points.forEach((p, i) => data.set([...p, 0, 0], 4 * i));
  const pointTexture = new Texture(gpu, { name: 'fixture-patches points', width: POINTS, height: 1, format: 'rgba32float', data: true }).upload(data);
  const pass = renderer.fullscreen(
    new Material({
      name: 'fixture-patches',
      shader,
      uniforms: {
        uPoints: { value: pointTexture },
        uOffset: { value: 0 },
        uGreenPatches: { value: new Vector2(green.patches.size, green.patches.sharp) },
        uGreenSeeds: { value: new Vector2(...seeds) },
      },
    }),
  );
  const target = createTarget(gpu, { name: 'fixture-patches', width: POINTS, height: 1, format: 'rgba32float' });
  const read = (offset) => {
    pass.uniforms.uOffset.value = offset;
    pass.render(target);
    return target.color.read();
  };

  const ready = (async () => {
    const gpuValues = await read(0);
    const mistaken = await read(0.1 * green.patches.size);
    target.dispose();
    pass.dispose();
    pointTexture.destroy();

    const patches = greenPatches(green, seeds);
    let worst = 0;
    let worstMistaken = 0;
    points.forEach(([x, z], i) => {
      const rank = patches.rank(x, z);
      worst = Math.max(worst, Math.abs(gpuValues[4 * i] - rank));
      worstMistaken = Math.max(worstMistaken, Math.abs(mistaken[4 * i] - rank));
    });
    const seen = await seenCheck(ctx, seeds, r);
    window.__PATCHES__ = { points: POINTS, gpu: worst, mistaken: worstMistaken, seen };
  })();

  return {
    ready,
    update() {},
    dispose() {
      delete window.__PATCHES__;
    },
  };
}

// The seen check (see the top): { cells, share, albedo, mistaken: { share, albedo } }.
async function seenCheck(ctx, seeds, r) {
  const { renderer, config, gpu, quality } = ctx;
  const { terrain } = config.world;
  const { cells, cell, samples, reach, cameras, footprints } = SEEN;
  // Cells of scrub on sandy ground, where green meets sand behind a beach and
  // where green meets bare ground, and of the palm belt and the jungle where
  // green meets bare: [sand, band, lush, sandy]. The edge runs through the
  // cell (JS knows the patches: world/green.js), and in every other one
  // through noise that is flat there, where a slip in its units moves the
  // edge by metres.
  const patches = greenPatches(terrain.green, seeds);
  const steep = (x, z, u) => Math.hypot(patches.rank(x + 0.05, z) - u, patches.rank(x, z + 0.05) - u) / 0.05; // per metre
  const scrub = () => [r.range(0, 0.6), r.range(0, 0.3), r.range(0.7, 1)];
  const kinds = [
    () => [-1, ...scrub()], // the sand's share set by the patches at the cell
    () => [0, ...scrub()],
    () => [0, r.range(0.8, 3), r.range(0, 1), r.range(0, 0.3)],
  ];
  const data = new Float32Array(4 * 2 * cells);
  for (let i = 0; i < cells; i++) {
    let [sand, band, lush, sandy] = kinds[i % kinds.length]();
    const flat = i % 2 === 0;
    const at = [0, 0];
    for (let tries = 0; tries < 100000; tries++) {
      at[0] = r.range(-reach, reach);
      at[1] = r.range(-reach, reach);
      // Green below `edge`; the sand lies where its share is over 1 - u (chunks/green.wgsl greenSandShare).
      const u = patches.rank(...at);
      const edge = sand < 0 ? u : greenCover(band, lush, terrain.green);
      if (Math.abs(u - edge) > 0.03 || edge < 0.05 || edge > 0.95) continue;
      if (flat && steep(...at, u) > 0.15) continue;
      if (sand < 0) sand = Math.min(Math.max(1 - u + r.range(-0.03, 0.03), 0.05), 0.95);
      break;
    }
    const angle = r.range(0, 2 * Math.PI);
    data.set([...at, sand, band], 4 * i);
    data.set([lush, sandy, Math.cos(angle), Math.sin(angle)], 4 * (cells + i));
  }
  const cellTexture = new Texture(gpu, { name: 'fixture-patches cells', width: cells, height: 2, format: 'rgba32float', data: true }).upload(data);
  // The surfaces' tiles and the green's settings, as the island has them at this preset (world/terrain.js).
  const tiles = createSurfaceTiles(renderer, ctx.rng, 'fixtures/patches', terrain, quality.surfaceTexture);
  const averages = await tiles.ready;
  const ranged = (surface) => ({ ...surface, range: surface.range * quality.groundDetail });
  const pass = renderer.fullscreen(
    new Material({
      name: 'fixture-patches-seen',
      shader: seenShader,
      overrides: { GREEN_DETAIL: true },
      uniforms: {
        ...tilesUniforms(tiles),
        ...sandUniforms(averages.sand, ranged(terrain.sand), config.world.island.zones.wetSand, config.sky.sun.sunsetYaw),
        ...greenUniforms(averages.green, terrain.albedo, ranged(terrain.green), seeds),
        uCells: { value: cellTexture },
        uDrySand: { value: new Vector3(...terrain.albedo.drySand) },
        uDistance: { value: 0 },
        uHeight: { value: 0 },
        uFootprint: { value: new Vector2() },
        uCell: { value: cell },
        uOffset: { value: 0 },
      },
    }),
  );
  const target = createTarget(gpu, { name: 'fixture-patches-seen', width: cells * samples, height: samples, format: 'rgba32float' });
  // Per cell, its average [r, g, b, sand] as this camera sees it through this pixel.
  const look = async ([distance, height], footprint, offset = 0) => {
    pass.uniforms.uDistance.value = distance;
    pass.uniforms.uHeight.value = height;
    pass.uniforms.uFootprint.value.fromArray(footprint);
    pass.uniforms.uOffset.value = offset;
    pass.render(target);
    const texels = await target.color.read();
    const width = cells * samples;
    const out = Array.from({ length: cells }, () => [0, 0, 0, 0]);
    for (let y = 0; y < samples; y++) {
      for (let x = 0; x < width; x++) {
        const sum = out[Math.floor(x / samples)];
        for (let c = 0; c < 4; c++) sum[c] += texels[4 * (y * width + x) + c] / samples ** 2;
      }
    }
    return out;
  };
  // The worst change of the sand's share, and of a channel of the albedo, from `base`'s.
  const worst = { share: 0, albedo: 0 };
  const compare = (base, other, into) => {
    base.forEach((b, i) => {
      into.share = Math.max(into.share, Math.abs(other[i][3] - b[3]));
      for (let c = 0; c < 3; c++) into.albedo = Math.max(into.albedo, Math.abs(other[i][c] - b[c]));
    });
  };
  const mistaken = { share: 0, albedo: 0 };
  for (const footprint of footprints) {
    const base = await look(cameras[0], footprint);
    for (const camera of cameras.slice(1)) compare(base, await look(camera, footprint), worst);
    compare(base, await look(cameras[cameras.length - 2], footprint, 0.1 * terrain.green.patches.size), mistaken);
  }
  target.dispose();
  pass.dispose();
  tiles.dispose();
  cellTexture.destroy();
  return { cells, ...worst, mistaken };
}
