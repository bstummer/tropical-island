// Tool fixture (?fixture=waves): the waves the GPU sums are the ones JS knows
// (CLAUDE.md §5). Each cascade's fields in the waves' texture (water/waves.js)
// against the whole sum of its waves in JS (water/spectrum.js), at seeded texels
// and a few times, hours in among them; its deliberate mistakes: a time off, and a
// texel off. A mip level, the mean of the four texels over it, as far as half
// floats hold. A time and the same time a loop later, the same. What the sea knows
// on the GPU (water/sea-map.wgsl) against water/sea-map.js at seeded points; its
// mistake half a texel off. And the water's displacement at seeded points, as its
// vertex shader adds it up, against what JS's own smaller sum says
// (water/surface.js), which only has to be near; its mistake a time well off. And the
// surf, its foam and its height, where it breaks, against water/surf.js; its mistake a time off.
// window.__WAVES__ holds the worst differences for tools/screenshot.js. The island
// and the sea draw as usual meanwhile. Not part of the island.
import shader from './waves-check.wgsl';
import { Vector2 } from '../maths/index.js';
import { Material } from '../gpu/material.js';
import { createTarget, Texture } from '../gpu/texture.js';
import { wave } from '../water/spectrum.js';
import { surfUniforms } from '../water/water.js';

const TIMES = [0, 7.3, 3 * 3600 + 1.1];
const POINTS = 48; // texels per cascade per time
const AT_POINTS = 1024; // over the sea
const MISTAKE = { time: 0.05, surfaceTime: 2.5, surfTime: 2, texels: 1, layout: 0.5 };
const SURFACE_TIME = 12.5;

export function create(ctx) {
  const { renderer, gpu, config } = ctx;
  const ready = ctx.water.ready.then(async () => {
    const { waves, spectrum, map, surface } = ctx.water;
    const { island } = ctx.terrain;
    const r = ctx.rng('fixtures/waves');
    const { size, cascades, loop } = spectrum;
    const result = { fields: { points: 0, gpu: 0, time: 0, texel: 0 }, mips: 0, looped: 0, map: { points: 0, gpu: 0, off: 0 }, surface: { points: 0, gpu: 0, time: 0 } };

    const readLayer = (layer, level = 0) => waves.texture.read({ layer, level });
    // The eight fields' expected values at a texel: the sum by its definition.
    const expected = (c, i, j, t) => {
      const dk = (2 * Math.PI) / c.patch;
      const x = (i * c.patch) / size;
      const z = (j * c.patch) / size;
      const out = new Float64Array(8);
      for (let b = 0; b < size; b++) {
        for (let a = 0; a < size; a++) {
          const n = b * size + a;
          const re = c.amplitudes[4 * n];
          const im = c.amplitudes[4 * n + 1];
          if (re === 0 && im === 0) continue;
          const kx = wave(a, size) * dk;
          const kz = wave(b, size) * dk;
          const k = Math.hypot(kx, kz);
          const phase = kx * x + kz * z - c.frequencies[n] * t;
          const cos = 2 * (re * Math.cos(phase) - im * Math.sin(phase));
          const sin = 2 * (re * Math.sin(phase) + im * Math.cos(phase));
          const L = c.choppy / k;
          out[0] -= kx * L * sin; // Dx
          out[1] += cos; // h
          out[2] -= kz * L * sin; // Dz
          out[3] -= kx * kz * L * cos; // Dxz
          out[4] -= kx * sin; // hx
          out[5] -= kz * sin; // hz
          out[6] -= kx * kx * L * cos; // Dxx
          out[7] -= kz * kz * L * cos; // Dzz
        }
      }
      return out;
    };

    for (const t of TIMES) {
      waves.compute(t);
      const layers = await Promise.all(Array.from({ length: 2 * cascades.length }, (_, layer) => readLayer(layer)));
      cascades.forEach((c, index) => {
        const [first, second] = [layers[2 * index], layers[2 * index + 1]];
        for (let n = 0; n < POINTS; n++) {
          const [i, j] = [r.int(0, size - 1), r.int(0, size - 1)];
          const wrapped = t - loop * Math.floor(t / loop);
          const want = expected(c, i, j, wrapped);
          const off = expected(c, i, j, wrapped + MISTAKE.time);
          const k = 4 * (j * size + i);
          const next = 4 * (j * size + ((i + MISTAKE.texels) % size));
          const got = [first[k], first[k + 1], first[k + 2], first[k + 3], second[k], second[k + 1], second[k + 2], second[k + 3]];
          const beside = [first[next], first[next + 1], first[next + 2], first[next + 3], second[next], second[next + 1], second[next + 2], second[next + 3]];
          result.fields.points++;
          for (let f = 0; f < 8; f++) {
            result.fields.gpu = Math.max(result.fields.gpu, Math.abs(got[f] - want[f]));
            result.fields.time = Math.max(result.fields.time, Math.abs(got[f] - off[f]));
            result.fields.texel = Math.max(result.fields.texel, Math.abs(beside[f] - want[f]));
          }
        }
      });
    }

    // The mips: each texel of level 1 the mean of the four of level 0 over it.
    const fine = await readLayer(0, 0);
    const coarse = await readLayer(0, 1);
    for (let n = 0; n < 256; n++) {
      const half = size / 2;
      const [i, j] = [r.int(0, half - 1), r.int(0, half - 1)];
      for (let f = 0; f < 4; f++) {
        const at = (x, y) => fine[4 * (y * size + x) + f];
        const mean = 0.25 * (at(2 * i, 2 * j) + at(2 * i + 1, 2 * j) + at(2 * i, 2 * j + 1) + at(2 * i + 1, 2 * j + 1));
        result.mips = Math.max(result.mips, Math.abs(coarse[4 * (j * half + i) + f] - mean));
      }
    }

    // A loop later, the same.
    waves.compute(7.3);
    const once = await readLayer(1);
    waves.compute(7.3 + loop);
    const again = await readLayer(1);
    for (let n = 0; n < once.length; n++) result.looped = Math.max(result.looped, Math.abs(once[n] - again[n]));

    // Seeded points for the map and the surface: world x, z, over the sea.
    const span = (map.samples - 1) * map.texel;
    const points = [];
    while (points.length < AT_POINTS) {
      const a = map.origin[0] + r.range(0.02, 0.98) * span;
      const o = map.origin[1] + r.range(0.02, 0.98) * span;
      if (map.at(a, o).shore > 1) points.push({ a, o, xz: island.fromCove(a, o) });
    }
    const data = new Float32Array(4 * AT_POINTS);
    points.forEach(({ xz }, n) => data.set([xz[0], xz[1], 0, 0], 4 * n));
    const input = new Texture(gpu, { name: 'fixture-waves points', width: AT_POINTS, height: 1, format: 'rgba32float', data: true, sampler: { mag: 'nearest', min: 'nearest' } }).upload(data);
    const target = createTarget(gpu, { name: 'fixture-waves', width: AT_POINTS, height: 1, format: 'rgba32float' });
    const layout = ctx.water.seaLayout;
    const material = new Material({
      name: 'fixture-waves',
      shader,
      uniforms: { uPoints: { value: input }, uSeaMap: { value: ctx.water.seaTexture }, uSeaLayout: { value: layout }, uRipplesDepth: { value: ctx.config.water.waves.ripplesDepth }, uChopWander: { value: new Vector2(ctx.config.water.waves.chopWander.reach, (2 * Math.PI) / ctx.config.water.waves.chopWander.across) }, ...surfUniforms(ctx.config.water.surf, ctx.water.swellWay), uSeconds: { value: SURFACE_TIME }, uMode: { value: 0 }, uPatches: { value: ctx.water.patches }, uWaves: { value: waves.texture } },
    });
    const pass = renderer.fullscreen(material);
    const run = async (mode, offset = 0) => {
      material.uniforms.uMode.value = mode;
      material.uniforms.uSeaLayout.value = layout.clone();
      material.uniforms.uSeaLayout.value.x -= offset * map.texel;
      material.uniforms.uSeaLayout.value.y -= offset * map.texel;
      pass.render(target);
      const read = await target.color.read();
      material.uniforms.uSeaLayout.value = layout;
      return read;
    };

    // What the sea knows, on the GPU and in JS: shore, depth, swell, wind.
    const seen = await run(0);
    const shifted = await run(0, MISTAKE.layout);
    const here = {};
    points.forEach(({ a, o }, n) => {
      map.at(a, o, here);
      const want = [here.shore, here.depth, here.swell, here.wind];
      // How much a metre or a share is worth: a metre in a hundred, a share in a hundred.
      const scale = [100, 100, 1, 1];
      result.map.points++;
      for (let c = 0; c < 4; c++) {
        result.map.gpu = Math.max(result.map.gpu, Math.abs(seen[4 * n + c] - want[c]) / scale[c]);
        result.map.off = Math.max(result.map.off, Math.abs(shifted[4 * n + c] - want[c]) / scale[c]);
      }
    });

    // The surface as its vertex shader adds it up, and as JS sums it.
    const t = SURFACE_TIME;
    waves.compute(t);
    const moved = await run(1);
    const inJs = [0, 0, 0];
    points.forEach(({ xz }, n) => {
      surface.displacement(xz[0], xz[1], t, inJs);
      result.surface.points++;
      result.surface.gpu = Math.max(result.surface.gpu, Math.abs(moved[4 * n + 1] - inJs[1]));
      surface.displacement(xz[0], xz[1], t + MISTAKE.surfaceTime, inJs);
      result.surface.time = Math.max(result.surface.time, Math.abs(moved[4 * n + 1] - inJs[1]));
    });

    // The surf, at points where it breaks: its twin to a little, as both read the map.
    const span2 = (map.samples - 1) * map.texel;
    const breaking = [];
    for (let tries = 0; tries < 200000 && breaking.length < AT_POINTS; tries++) {
      const a = map.origin[0] + r.range(0.02, 0.98) * span2;
      const o = map.origin[1] + r.range(0.02, 0.98) * span2;
      const here = map.at(a, o);
      if (here.breaks > 0.1 && here.reef < config.water.surf.ahead) breaking.push({ xz: island.fromCove(a, o) });
    }
    const surfInput = new Texture(gpu, { name: 'fixture-waves surf points', width: AT_POINTS, height: 1, format: 'rgba32float', data: true, sampler: { mag: 'nearest', min: 'nearest' } });
    const surfData = new Float32Array(4 * AT_POINTS);
    breaking.forEach(({ xz }, n) => surfData.set([xz[0], xz[1], 0, 0], 4 * n));
    surfInput.upload(surfData);
    material.uniforms.uPoints.value = surfInput;
    const surfSeen = await run(2);
    const seams = await run(3);
    material.uniforms.uPoints.value = input;
    result.surf = { points: breaking.length, foam: 0, height: 0, slope: 0, seam: 0, time: 0 };
    breaking.forEach(({ xz }, n) => {
      const twin = ctx.water.surfAt(xz[0], xz[1], SURFACE_TIME);
      const later = ctx.water.surfAt(xz[0], xz[1], SURFACE_TIME + MISTAKE.surfTime);
      result.surf.foam = Math.max(result.surf.foam, Math.abs(surfSeen[4 * n] - twin.foam));
      result.surf.height = Math.max(result.surf.height, Math.abs(surfSeen[4 * n + 1] - twin.height));
      result.surf.slope = Math.max(result.surf.slope, Math.abs(surfSeen[4 * n + 2] - twin.slope));
      result.surf.seam = Math.max(result.surf.seam, seams[4 * n]);
      result.surf.time = Math.max(result.surf.time, Math.abs(surfSeen[4 * n] - later.foam));
    });
    surfInput.destroy();

    window.__WAVES__ = result;
    pass.dispose();
    target.dispose();
    input.destroy();
  });
  return {
    ready,
    update() {},
    dispose() {
      delete window.__WAVES__;
    },
  };
}
