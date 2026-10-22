// Tool fixture (?fixture=terrain): the heights the GPU draws must be the ones
// JS knows (CLAUDE.md §5). Once the terrain's grids are in, it has the GPU
// sample them (chunks/terrain.glsl) at seeded points on every level: well
// inside each grid, in the bands along all four edges where one fades into
// the next, and exactly on samples. The points go in as world positions, so
// the cove's frame is checked too, and some are read from a coarser level, as
// the mesh's morph does. It compares them with world/heightmap.js's sampler,
// and the sampler with the island itself, and leaves the worst differences in
// window.__TERRAIN__ for tools/screenshot.js. It also samples half a metre
// off, a deliberate mistake the comparison has to catch. The terrain draws as
// usual meanwhile. Not part of the island.
import * as THREE from 'three';
import vertexShader from '../post/output.vert';
import fragmentShader from './terrain.frag';
import { createFullscreen } from '../post/fullscreen.js';

const PER_LEVEL = { inside: 48, edge: 32, samples: 16, coarser: 8 };

export function create(ctx) {
  const { renderer, frame, config } = ctx;
  const { blend, samples } = config.world.terrain;
  const offset = config.capture.terrain.offset;

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
        uniforms: { ...frame.uniforms, uPoints: { value: pointTexture }, uOffset: { value: 0 } },
      }),
    );
    const target = new THREE.WebGLRenderTarget(count, 1, { type: THREE.FloatType, depthBuffer: false });
    const read = (shift) => {
      pass.uniforms.uOffset.value = shift;
      pass.render(renderer, target);
      const pixels = new Float32Array(4 * count);
      renderer.readRenderTargetPixels(target, 0, 0, count, 1, pixels);
      renderer.setRenderTarget(null);
      return points.map((_, i) => pixels[4 * i]);
    };
    const gpu = read(0);
    const mistaken = read(offset);
    target.dispose();
    pass.dispose();
    pointTexture.dispose();

    const out = {};
    let worstGpu = 0;
    let worstMistaken = 0;
    const misses = heightmap.levels.map(() => []);
    points.forEach(([a, o, k, from], i) => {
      const drawn = heightmap.heightAtCove(...island.toCove(...world[i]), from);
      worstGpu = Math.max(worstGpu, Math.abs(gpu[i] - drawn));
      worstMistaken = Math.max(worstMistaken, Math.abs(mistaken[i] - drawn));
      if (from === 0) misses[k].push(Math.abs(drawn - island.evaluate(a, o, out).height));
    });
    const median = (list) => list.sort((p, q) => p - q)[list.length >> 1];
    window.__TERRAIN__ = {
      points: count,
      gpu: worstGpu,
      mistaken: worstMistaken,
      // Per level: its spacing, and the drawn ground's median miss of the island's.
      island: heightmap.levels.map(({ texel }, k) => ({ texel, median: median(misses[k]) })),
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
