// Tool fixture (?fixture=patches): the green's patches the GPU draws
// (chunks/patches.wgsl) must be the ones JS knows (world/green.js), which
// placement reads (Stage 9). At boot it has the GPU evaluate them at seeded
// points, out past the island's far side and on both sides of zero, for
// seeded seeds, and leaves in window.__PATCHES__ how far the GPU's values
// land from JS's at worst, and how far they land with the points shifted by
// a tenth of a patch, a deliberate mistake the comparison has to catch.
// Draws nothing. Not part of the island.
import { Vector2 } from '../maths/index.js';
import shader from './patches.wgsl';
import { Material } from '../gpu/material.js';
import { createTarget, Texture } from '../gpu/texture.js';
import { greenPatches } from '../world/green.js';

const POINTS = 1024;
const REACH = 4000; // m either side of the origin

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
    window.__PATCHES__ = { points: POINTS, gpu: worst, mistaken: worstMistaken };
  })();

  return {
    ready,
    update() {},
    dispose() {
      delete window.__PATCHES__;
    },
  };
}
