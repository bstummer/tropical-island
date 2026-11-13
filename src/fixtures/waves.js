// Tool fixture (?fixture=waves): the waves the GPU sums are the ones JS knows
// (CLAUDE.md §5). Each cascade's fields in the waves' texture (water/waves.js)
// against the whole sum of its waves in JS (water/spectrum.js), at seeded texels
// and a few times, hours in among them; its deliberate mistakes: a time off, and a
// texel off. A mip level, the mean of the four texels over it, as far as half
// floats hold. A time and the same time a loop later, given to the GPU as it is, the
// same: the waves turn whole times in the loop. What the sea knows
// on the GPU (water/sea-map.wgsl) against water/sea-map.js at seeded points; its
// mistake half a texel off. And the water's displacement at seeded points, as its
// vertex shader adds it up, against the whole sum of its waves in JS (water/surface.js
// with nothing left out); its mistakes a time well off, and the waves read half a texel
// off, where the texels' corners lie; and against the game's own smaller sum, which
// only has to be near. And the surf, its foam and its height, where it breaks, against
// water/surf.js; its mistake a time off. And the beach's water where the waves wash,
// its edge, its depth, its foam and its film, against water/swash.js (ctx.water.swashAt);
// its mistake a time off.
// window.__WAVES__ holds the worst differences for tools/screenshot.js. The island
// and the sea draw as usual meanwhile. Not part of the island.
import shader from './waves-check.wgsl';
import { Material } from '../gpu/material.js';
import { createTarget, Texture } from '../gpu/texture.js';
import { wave } from '../water/spectrum.js';
import { createSurface } from '../water/surface.js';
import { createSurf } from '../water/surf.js';
import { surfUniforms } from '../water/water.js';
import { swashUniforms, swellWay } from '../water/swash.js';

const TIMES = [0, 7.3, 3 * 3600 + 1.1];
const POINTS = 48; // texels per cascade per time
const AT_POINTS = 1024; // over the sea
const MISTAKE = { time: 0.05, surfaceTime: 2.5, surfTime: 2, texels: 1, layout: 0.5, swashTime: 0.5 };
const SURFACE_TIME = 12.5;
const SWASH_TIME = 437.3; // s, the waves' time, wrapped

export function create(ctx) {
  const { renderer, gpu, config } = ctx;
  const ready = ctx.water.ready.then(async () => {
    const { waves, spectrum, map, surface } = ctx.water;
    const { island } = ctx.terrain;
    const r = ctx.rng('fixtures/waves');
    const { size, cascades, loop } = spectrum;
    const result = { fields: { points: 0, gpu: 0, time: 0, texel: 0 }, mips: 0, looped: 0, map: { points: 0, gpu: 0, off: 0 }, surface: { points: 0, gpu: 0, time: 0, texel: 0, inJs: 0 } };

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

    // A loop later, the same: the time as the GPU is given it, not wrapped first.
    waves.compute(7.3);
    const once = await readLayer(1);
    waves.compute(7.3 + loop, { wrap: false });
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
      uniforms: { uPoints: { value: input }, ...swashUniforms(config.water.swash, config.water.surf, swellWay(config), config.water.surf.period, config.water.waves.loop), ...surfUniforms(ctx.config.water.surf, ctx.water.swellWay), uSeconds: { value: SURFACE_TIME }, uMode: { value: 0 }, uPatches: { value: ctx.water.patches }, uWaveTexels: { value: size }, uWaves: { value: waves.texture } },
    });
    const pass = renderer.fullscreen(material);
    // The map's layout is the frame's (chunks/frame.wgsl), shifted for a run and put back.
    const run = async (mode, offset = 0) => {
      material.uniforms.uMode.value = mode;
      const { x, y } = layout;
      layout.x -= offset * map.texel;
      layout.y -= offset * map.texel;
      pass.render(target);
      layout.x = x;
      layout.y = y;
      return target.color.read();
    };

    // What the sea knows, on the GPU and in JS: shore, depth, swell, chop.
    const seen = await run(0);
    const shifted = await run(0, MISTAKE.layout);
    const here = {};
    points.forEach(({ a, o }, n) => {
      map.at(a, o, here);
      const want = [here.shore, here.depth, here.swell, here.chop];
      // How much a metre or a share is worth: a metre in a hundred, a share in a hundred.
      const scale = [100, 100, 1, 1];
      result.map.points++;
      for (let c = 0; c < 4; c++) {
        result.map.gpu = Math.max(result.map.gpu, Math.abs(seen[4 * n + c] - want[c]) / scale[c]);
        result.map.off = Math.max(result.map.off, Math.abs(shifted[4 * n + c] - want[c]) / scale[c]);
      }
    });

    // The surface as its vertex shader adds it up, against the whole sum of every wave in
    // JS, which leaves nothing out; and against what the game's JS sums (water/surface.js),
    // its largest waves, which only has to be near.
    const t = SURFACE_TIME;
    waves.compute(t);
    const moved = await run(1);
    const cornered = await run(4);
    const { waves: waveSettings } = config.water;
    const shallow = { share: config.water.shallowTroughs, groundAt: (await ctx.terrain.grids).heightAt };
    const whole = createSurface(spectrum, map, island.toCove, { rest: 0, most: Infinity }, waveSettings.ripplesLeast, waveSettings.ripplesDepth, createSurf(config.water.surf, ctx.water.swellWay), waveSettings.chopWander, shallow);
    const [all, later, inJs] = [[0, 0, 0], [0, 0, 0], [0, 0, 0]];
    points.forEach(({ xz }, n) => {
      whole.displacement(xz[0], xz[1], t, all);
      whole.displacement(xz[0], xz[1], t + MISTAKE.surfaceTime, later);
      surface.displacement(xz[0], xz[1], t, inJs);
      result.surface.points++;
      result.surface.gpu = Math.max(result.surface.gpu, Math.abs(moved[4 * n + 1] - all[1]));
      result.surface.texel = Math.max(result.surface.texel, Math.abs(cornered[4 * n + 1] - all[1]));
      result.surface.time = Math.max(result.surface.time, Math.abs(moved[4 * n + 1] - later[1]));
      result.surface.inJs = Math.max(result.surface.inJs, Math.abs(moved[4 * n + 1] - inJs[1]));
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

    // The beach's water, at points where the waves wash, at a time and that time a little later.
    const washing = [];
    const ground = (await ctx.terrain.grids).heightAt;
    for (let tries = 0; tries < 400000 && washing.length < AT_POINTS; tries++) {
      const a = map.origin[0] + r.range(0.02, 0.98) * span2;
      const o = map.origin[1] + r.range(0.02, 0.98) * span2;
      const xz = island.fromCove(a, o);
      const here = map.at(a, o);
      const g = ground(xz[0], xz[1]);
      if (Math.abs(here.shore) < 8 && g > -0.3 && g < 0.8) washing.push({ xz });
    }
    const washInput = new Texture(gpu, { name: 'fixture-waves swash points', width: AT_POINTS, height: 1, format: 'rgba32float', data: true, sampler: { mag: 'nearest', min: 'nearest' } });
    const washData = new Float32Array(4 * AT_POINTS);
    washing.forEach(({ xz }, n) => washData.set([xz[0], xz[1], 0, 0], 4 * n));
    washInput.upload(washData);
    material.uniforms.uPoints.value = washInput;
    const seconds = ctx.frame.uniforms.uWaveSeconds;
    const was = seconds.value;
    seconds.value = SWASH_TIME;
    const washSeen = await run(5);
    seconds.value = was;
    material.uniforms.uPoints.value = input;
    result.swash = { points: washing.length, level: 0, cover: 0, foam: 0, film: 0, time: 0, moving: 0 };
    const twin = {};
    const later = {};
    washing.forEach(({ xz }, n) => {
      ctx.water.swashAt(xz[0], xz[1], SWASH_TIME, twin);
      ctx.water.swashAt(xz[0], xz[1], SWASH_TIME + MISTAKE.swashTime, later);
      const seen = washSeen.slice(4 * n, 4 * n + 4);
      result.swash.level = Math.max(result.swash.level, Math.abs(seen[0] - twin.level));
      result.swash.cover = Math.max(result.swash.cover, Math.abs(seen[1] - twin.cover));
      result.swash.foam = Math.max(result.swash.foam, Math.abs(seen[2] - (twin.foam + twin.line)));
      result.swash.film = Math.max(result.swash.film, Math.abs(seen[3] - twin.film));
      result.swash.time = Math.max(result.swash.time, Math.abs(seen[0] - later.level));
      // Whether the edge moves at all there then: the check means something only where it does.
      result.swash.moving = Math.max(result.swash.moving, Math.abs(twin.level - later.level));
    });
    washInput.destroy();

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
