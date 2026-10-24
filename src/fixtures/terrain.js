// Tool fixture (?fixture=terrain): the heights and the ground the GPU draws must
// be the ones JS knows (CLAUDE.md §5). Once the terrain's grids are in, it has
// the GPU sample them (chunks/terrain.glsl) at seeded points on every level: well
// inside each grid, in the bands along all four edges where one fades into
// the next, and exactly on samples. The points go in as world positions, so
// the cove's frame is checked too, and some are read from a coarser level, as
// the mesh's morph does. It compares them with world/heightmap.js's sampler,
// and the sampler's heights with the island itself, and leaves the worst
// differences in window.__TERRAIN__ for tools/screenshot.js: the ground's as
// shares of its limits (config.capture.terrain.ground), per field and the worst. It also samples half a metre
// off, a deliberate mistake the comparison has to catch. And the mesh's own
// height as drawn (chunks/terrain-mesh.glsl) against its JS twin
// (ctx.terrain.meshHeightAtCove), for cameras where the views stand and
// seeded ones, at points out to the island's far side, where the levels and
// their morphs change; its deliberate mistake: a camera 30 m off. And the
// ground's albedo the light from below reads (chunks/lighting.glsl
// groundAlbedo, from world/terrain.js's map and its layout) against
// world/albedo.js's map of the coarsest grid, filtered as the GPU filters it;
// its deliberate mistake: the map's layout half a texel off. The terrain
// draws as usual meanwhile. Not part of the island.
import * as THREE from 'three';
import vertexShader from '../post/output.vert';
import fragmentShader from './terrain.frag';
import meshShader from './terrain-mesh.frag';
import bounceShader from './terrain-bounce.frag';
import { views } from '../views.js';
import { createFullscreen } from '../post/fullscreen.js';
import { albedoMap } from '../world/albedo.js';

const PER_LEVEL = { inside: 48, edge: 32, samples: 16, coarser: 8 };
const MESH = { cameras: 6, points: 400, reach: 2500, off: 30 }; // seeded cameras; points per camera, within reach m
const BOUNCE = { points: 1024, off: 0.5 }; // seeded points over the island; the mistake, in texels

export function create(ctx) {
  const { renderer, frame, config } = ctx;
  const { blend, samples } = config.world.terrain;
  const { offset, ground: groundLimits } = config.capture.terrain;

  const ready = ctx.terrain.ready.then(() => {
    const { heightmap, island } = ctx.terrain;
    const r = ctx.rng('fixtures/terrain');
    const points = []; // [a, o, level, from]: from 0 unless read from a coarser level
    const last = samples - 1;
    heightmap.levels.forEach(({ origin, texel }, k) => {
      const at = (fx, fy, from = 0) => [origin[0] + fx * texel, origin[1] + fy * texel, k, from];
      const coarsest = k === heightmap.levels.length - 1;
      // Where this level has its full say, and the bands where it fades out.
      const full = coarsest ? [1, last - 1] : [blend + 1, last - blend - 1];
      for (let i = 0; i < PER_LEVEL.inside; i++) points.push(at(r.range(...full), r.range(...full)));
      if (!coarsest) {
        for (let i = 0; i < PER_LEVEL.edge; i++) {
          const across = r.range(1, blend + 1);
          const along = r.range(full[0], full[1]);
          points.push([at(across, along), at(last - across, along), at(along, across), at(along, last - across)][i % 4]);
        }
      }
      for (let i = 0; i < PER_LEVEL.samples; i++) points.push(at(r.int(full[0], full[1]), r.int(full[0], full[1])));
      if (k > 0) for (let i = 0; i < PER_LEVEL.coarser; i++) points.push(at(r.range(...full), r.range(...full), k));
    });

    const count = points.length;
    const data = new Float32Array(4 * count);
    const world = points.map(([a, o, , from], i) => {
      const [x, z] = island.fromCove(a, o);
      data.set([x, z, from, 0], 4 * i);
      return [x, z];
    });
    const pointTexture = new THREE.DataTexture(data, count, 1, THREE.RGBAFormat, THREE.FloatType);
    pointTexture.needsUpdate = true;
    const pass = createFullscreen(
      new THREE.ShaderMaterial({
        name: 'fixture-terrain',
        vertexShader,
        fragmentShader,
        uniforms: { ...frame.uniforms, uPoints: { value: pointTexture }, uOffset: { value: 0 }, uRead: { value: 0 } },
      }),
    );
    const target = new THREE.WebGLRenderTarget(count, 1, { type: THREE.FloatType, depthBuffer: false });
    // Per point, the height, or with `ground` the ground: [sand, rock, band,
    // reef, lush, sandy], from two reads.
    const read = (shift, ground = false) => {
      pass.uniforms.uOffset.value = shift;
      const once = (what) => {
        pass.uniforms.uRead.value = what;
        pass.render(renderer, target);
        const pixels = new Float32Array(4 * count);
        renderer.readRenderTargetPixels(target, 0, 0, count, 1, pixels);
        renderer.setRenderTarget(null);
        return pixels;
      };
      if (!ground) {
        const pixels = once(0);
        return points.map((_, i) => pixels[4 * i]);
      }
      const first = once(1);
      const second = once(2);
      return points.map((_, i) => [...first.slice(4 * i, 4 * i + 4), ...second.slice(4 * i, 4 * i + 2)]);
    };
    const gpu = read(0);
    const mistaken = read(offset);
    const gpuGround = read(0, true);
    const mistakenGround = read(offset, true);
    target.dispose();
    pass.dispose();
    pointTexture.dispose();
    const mesh = meshCheck(ctx, r);
    const bounce = bounceCheck(ctx, ctx.rng('fixtures/terrain/bounce'));

    const out = {};
    const ground = {};
    let worstGpu = 0;
    let worstMistaken = 0;
    // Per field of the ground, how far the GPU's read lands from JS's, as a share of its limit.
    const fields = ['sand', 'rock', 'band', 'reef', 'lush', 'sandy'];
    const fieldLimits = [groundLimits.cover, groundLimits.cover, groundLimits.band, groundLimits.reef, groundLimits.cover, groundLimits.cover];
    const worstGround = fields.map(() => 0);
    let worstMistakenGround = 0;
    const groundOff = (read) => fields.map((field, c) => Math.abs(read[c] - ground[field]) / fieldLimits[c]);
    const misses = heightmap.levels.map(() => []);
    points.forEach(([a, o, k, from], i) => {
      const at = island.toCove(...world[i]);
      const drawn = heightmap.heightAtCove(...at, from);
      worstGpu = Math.max(worstGpu, Math.abs(gpu[i] - drawn));
      worstMistaken = Math.max(worstMistaken, Math.abs(mistaken[i] - drawn));
      heightmap.groundAtCove(...at, ground);
      groundOff(gpuGround[i]).forEach((off, c) => (worstGround[c] = Math.max(worstGround[c], off)));
      worstMistakenGround = Math.max(worstMistakenGround, ...groundOff(mistakenGround[i]));
      if (from === 0) misses[k].push(Math.abs(drawn - island.evaluate(a, o, out).height));
    });
    const median = (list) => list.sort((p, q) => p - q)[list.length >> 1];
    window.__TERRAIN__ = {
      points: count,
      gpu: worstGpu,
      mistaken: worstMistaken,
      ground: { gpu: Math.max(...worstGround), mistaken: worstMistakenGround, fields: Object.fromEntries(fields.map((f, c) => [f, worstGround[c]])) },
      // Per level: its spacing, and the drawn ground's median miss of the island's.
      island: heightmap.levels.map(({ texel }, k) => ({ texel, median: median(misses[k]) })),
      mesh,
      bounce,
    };
  });

  return {
    ready,
    update() {},
    dispose() {
      delete window.__TERRAIN__;
    },
  };
}

// The mesh's height as the GPU works it out, against its JS twin: for each
// camera (cove frame) and point, both; the worst difference in metres, and
// the worst with the twin's camera MESH.off metres away, which must show.
function meshCheck(ctx, r) {
  const { renderer, frame, terrain } = ctx;
  const { island } = terrain;
  const cameras = views.map((v) => island.toCove(v.position[0], v.position[2]));
  for (let i = 0; i < MESH.cameras; i++) cameras.push([r.range(-300, 600), r.range(-900, 300)]);
  const cases = [];
  for (const [ca, co] of cameras) {
    for (let i = 0; i < MESH.points; i++) {
      // More of them near, where the fine levels and their morphs are.
      const d = MESH.reach * r.next() ** 2;
      const angle = r.range(0, 2 * Math.PI);
      cases.push([ca + d * Math.cos(angle), co + d * Math.sin(angle), ca, co]);
    }
  }
  // In a square, row by row: a row of them all would outgrow the largest texture.
  const count = cases.length;
  const side = Math.ceil(Math.sqrt(count));
  const data = new Float32Array(4 * side * side);
  cases.forEach((c, i) => data.set(c, 4 * i));
  const input = new THREE.DataTexture(data, side, side, THREE.RGBAFormat, THREE.FloatType);
  input.needsUpdate = true;
  const pass = createFullscreen(
    new THREE.ShaderMaterial({
      name: 'fixture-terrain-mesh',
      vertexShader,
      fragmentShader: meshShader,
      uniforms: { ...frame.uniforms, ...terrain.mesh.uniforms, uCases: { value: input } },
      defines: terrain.mesh.defines,
    }),
  );
  const target = new THREE.WebGLRenderTarget(side, side, { type: THREE.FloatType, depthBuffer: false });
  pass.render(renderer, target);
  const pixels = new Float32Array(4 * side * side);
  renderer.readRenderTargetPixels(target, 0, 0, side, side, pixels);
  renderer.setRenderTarget(null);
  target.dispose();
  pass.dispose();
  input.dispose();

  let gpu = 0;
  let mistaken = 0;
  let points = 0;
  cases.forEach(([a, o, ca, co], i) => {
    const js = terrain.meshHeightAtCove(a, o, [ca, 0, co]);
    if (Number.isNaN(js)) return; // off the terrain
    points++;
    gpu = Math.max(gpu, Math.abs(pixels[4 * i] - js));
    mistaken = Math.max(mistaken, Math.abs(pixels[4 * i] - terrain.meshHeightAtCove(a, o, [ca + MESH.off, 0, co])));
  });
  return { points, gpu, mistaken };
}

// The ground's albedo the light from below reads on the GPU, against what JS
// expects there: world/albedo.js's map of the coarsest grid, its texel centres
// on the grid's samples, kept and read as the GPU keeps and reads it, at the
// mip level config.world.terrain.bounceReach asks for. For seeded points over
// the island: the worst difference over the three channels, and the worst
// with the map's layout BOUNCE.off texels off along both axes, which must show.
function bounceCheck(ctx, r) {
  const { renderer, frame, config, terrain } = ctx;
  const { heightmap, island } = terrain;
  const { samples, bounceReach, albedo, green, sand } = config.world.terrain;
  const coarsest = heightmap.levels.at(-1);
  const { origin, texel } = coarsest;
  const looks = { albedo, green, wetness: sand.wetness, wetHeight: config.world.island.zones.wetSand, sea: config.sky.atmosphere.groundAlbedo };
  const lod = Math.log2(bounceReach / texel);
  const mips = halfMips(albedoMap(coarsest, looks), samples, Math.floor(lod) + 2);
  const corner = [origin[0] - texel / 2, origin[1] - texel / 2];
  const size = samples * texel;

  const { minA, maxA, minO, maxO } = island.coveBounds;
  const end = (samples - 1) * texel;
  const world = Array.from({ length: BOUNCE.points }, () =>
    island.fromCove(r.range(Math.max(minA, origin[0]), Math.min(maxA, origin[0] + end)), r.range(Math.max(minO, origin[1]), Math.min(maxO, origin[1] + end))),
  );
  const data = new Float32Array(4 * BOUNCE.points);
  world.forEach(([x, z], i) => data.set([x, z, 0, 0], 4 * i));
  const input = new THREE.DataTexture(data, BOUNCE.points, 1, THREE.RGBAFormat, THREE.FloatType);
  input.needsUpdate = true;
  const pass = createFullscreen(
    new THREE.ShaderMaterial({ name: 'fixture-terrain-bounce', vertexShader, fragmentShader: bounceShader, uniforms: { ...frame.uniforms, uPoints: { value: input } } }),
  );
  const target = new THREE.WebGLRenderTarget(BOUNCE.points, 1, { type: THREE.FloatType, depthBuffer: false });
  const read = () => {
    pass.render(renderer, target);
    const pixels = new Float32Array(4 * BOUNCE.points);
    renderer.readRenderTargetPixels(target, 0, 0, BOUNCE.points, 1, pixels);
    renderer.setRenderTarget(null);
    return pixels;
  };
  const gpu = read();
  const off = frame.uniforms.uBounceLayout.value.clone();
  off.x -= BOUNCE.off * texel;
  off.y -= BOUNCE.off * texel;
  pass.uniforms.uBounceLayout = { value: off };
  const mistaken = read();
  target.dispose();
  pass.dispose();
  input.dispose();

  let worst = 0;
  let worstMistaken = 0;
  world.forEach((xz, i) => {
    const [a, o] = island.toCove(...xz);
    sampleMips(mips, (a - corner[0]) / size, (o - corner[1]) / size, lod).forEach((js, c) => {
      worst = Math.max(worst, Math.abs(gpu[4 * i + c] - js));
      worstMistaken = Math.max(worstMistaken, Math.abs(mistaken[4 * i + c] - js));
    });
  });
  return { points: BOUNCE.points, gpu: worst, mistaken: worstMistaken };
}

// An RGBA map of size x size texels as the GPU keeps it: half floats, and
// `count` levels of mips, each texel of one the mean of four of the one before.
function halfMips(map, size, count) {
  const half = (v) => THREE.DataUtils.fromHalfFloat(THREE.DataUtils.toHalfFloat(v));
  const mips = [{ size, texels: map.map(half) }];
  while (mips.length < count) {
    const { size: from, texels } = mips.at(-1);
    const n = from / 2;
    const next = new Float32Array(4 * n * n);
    const at = (i, j, c) => texels[4 * (j * from + i) + c];
    for (let j = 0; j < n; j++) {
      for (let i = 0; i < n; i++) {
        for (let c = 0; c < 4; c++) next[4 * (j * n + i) + c] = half((at(2 * i, 2 * j, c) + at(2 * i + 1, 2 * j, c) + at(2 * i, 2 * j + 1, c) + at(2 * i + 1, 2 * j + 1, c)) / 4);
      }
    }
    mips.push({ size: n, texels: next });
  }
  return mips;
}

// The colour of `mips` at u, v as textureLod reads it at `lod` (linear,
// mipmapped linearly, clamped at the edges): bilinear in the mips either side
// of lod, blended between them.
function sampleMips(mips, u, v, lod) {
  const d = Math.floor(lod);
  const bilinear = ({ size, texels }, c) => {
    const [x, y] = [u * size - 0.5, v * size - 0.5];
    const [i, j] = [Math.floor(x), Math.floor(y)];
    const edge = (k) => Math.min(Math.max(k, 0), size - 1);
    const at = (p, q) => texels[4 * (edge(q) * size + edge(p)) + c];
    const bottom = at(i, j) + (at(i + 1, j) - at(i, j)) * (x - i);
    const top = at(i, j + 1) + (at(i + 1, j + 1) - at(i, j + 1)) * (x - i);
    return bottom + (top - bottom) * (y - j);
  };
  return [0, 1, 2].map((c) => {
    const near = bilinear(mips[d], c);
    return near + (bilinear(mips[d + 1], c) - near) * (lod - d);
  });
}

