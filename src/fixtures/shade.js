// Tool fixture (?fixture=shade): the island's shade the GPU reads is the one JS
// knows (CLAUDE.md §5). Once the first shade is in (sky/shadows.js), it works
// the same shade out here (world/shade.js) and reads it as the texture holds
// it, in half floats, and has the GPU read the texture (chunks/shadows.wgsl
// islandShadeAt, in shade-check.wgsl) at seeded points over the island's
// land and shallows: on the ground, its share of the sun and of the ground
// around (the worst difference of each), and half a texel off, a deliberate
// mistake the comparison has to catch; above it, where the ground lies under
// a shade's top, at heights from 0.3 m up to 5 m past the top, its share there (the share
// of points off by more than 0.05), and 2 m too high, the mistake there.
// window.__SHADE__ holds the worst differences, for tools/screenshot.js. The
// terrain draws as usual meanwhile. Not part of the island.
import shader from './shade-check.wgsl';
import { Material } from '../gpu/material.js';
import { Texture, createTarget } from '../gpu/texture.js';
import { fromHalfFloat } from '../maths/index.js';
import { islandShade, packShade, shadeAbove, shadeAround, shadeAt } from '../world/shade.js';
import { sunPath } from '../sky/sun.js';

const POINTS = 2048;
const DEG = Math.PI / 180;

export function create(ctx) {
  const { renderer, config, quality, camera } = ctx;
  const ready = Promise.all([ctx.terrain.ready, ctx.shadows.ready]).then(async () => {
    const { heightmap, island } = ctx.terrain;
    const direction = sunPath.position(ctx.timeOfDay).direction;
    const [a0, o0] = island.toCove(direction[0], direction[2]);
    const shade = islandShade(heightmap.levels, [a0, direction[1], o0], {
      texel: quality.shadeTexel,
      radius: config.sky.atmosphere.sunRadius * DEG * config.shadows.softness,
      around: config.world.terrain.bounceReach,
    });
    // As the texture holds it.
    const texels = packShade(shade);
    for (const [c, name] of ['visible', 'top', 'reach', 'around'].entries()) {
      for (let k = 0; k < shade[name].length; k++) shade[name][k] = fromHalfFloat(texels[4 * k + c]);
    }

    // Seeded points on the land and the shallows of the finest grid; for the
    // heights, where a shade's top stands a metre and more over the ground,
    // as many as are found in as many tries again.
    const r = ctx.rng('fixtures/shade');
    const fine = heightmap.levels[0];
    const span = (fine.samples - 1) * fine.texel;
    const points = [];
    const high = [];
    for (let tries = 0; points.length < POINTS || (high.length < POINTS && tries < 50 * POINTS); tries++) {
      const a = fine.origin[0] + r.range(0.05, 0.95) * span;
      const o = fine.origin[1] + r.range(0.05, 0.95) * span;
      const ground = heightmap.heightAtCove(a, o);
      if (ground < -10) continue;
      if (points.length < POINTS) points.push({ a, o, ground });
      const k = Math.round((o - shade.origin[1]) / shade.texel) * shade.samples + Math.round((a - shade.origin[0]) / shade.texel);
      const over = shade.top[k] - ground;
      if (over > 1 && high.length < POINTS) high.push({ a, o, ground, up: r.range(0.3, over + 5) });
    }
    const groundRadius = config.sky.atmosphere.groundRadius * 1000;
    // At each point (moved `off` along a and `lift` up), the GPU's
    // [share of the sun, share around]: of the ground, or at its height.
    const read = async (list, shadeGround, off, lift = 0) => {
      const data = new Float32Array(4 * POINTS);
      list.forEach(({ a, o, ground, up = 0 }, i) => {
        const [x, z] = island.fromCove(a + off, o);
        // Drawn bent down with the planet, as the GPU takes it back up.
        const drop = ((x - camera.position.x) ** 2 + (z - camera.position.z) ** 2) / (2 * groundRadius);
        data.set([x, shadeGround ? 0 : ground + up + lift - drop, z, up + lift], 4 * i);
      });
      const pointTexture = new Texture(renderer.gpu, { name: 'fixture-shade points', width: POINTS, height: 1, format: 'rgba32float', data: true }).upload(data);
      const target = createTarget(renderer.gpu, { name: 'fixture-shade', width: POINTS, height: 1, format: 'rgba32float' });
      const pass = renderer.fullscreen(new Material({ name: 'fixture-shade', shader, uniforms: { uPoints: { value: pointTexture } }, overrides: { SHADE_GROUND: shadeGround } }));
      pass.render(target);
      const pixels = await target.color.read();
      pass.dispose();
      target.dispose();
      pointTexture.destroy();
      return list.map((_, i) => [pixels[4 * i], pixels[4 * i + 1]]);
    };
    const worst = (gpu, twin) => Math.max(...gpu.map((v, i) => Math.abs(v - twin[i])));
    // Above the ground the GPU filters the shade's top, whose texels lie a
    // metre or two apart in height on a slope, in steps of 1/256 of a texel on
    // many GPUs: under a ridge a texel or two away that turns millimetres into
    // tenths of the sun. So there, the share of points off by more than `off`.
    const off = 0.05;
    const share = (gpu, twin) => gpu.filter((v, i) => Math.abs(v - twin[i]) > off).length / gpu.length;
    const results = { points: POINTS, high: high.length };
    for (const [name, off, lift] of [['gpu', 0, 0], ['mistaken', shade.texel / 2, 2]]) {
      const ground = await read(points, true, off);
      const above = await read(high, false, 0, lift);
      results[name] = {
        ground: worst(ground.map((v) => v[0]), points.map((p) => shadeAt(shade, p.a, p.o))),
        around: worst(ground.map((v) => v[1]), points.map((p) => shadeAround(shade, p.a, p.o))),
        above: share(above.map((v) => v[0]), high.map((p) => shadeAbove(shade, p.a, p.o, p.ground + p.up, p.ground))),
      };
    }
    window.__SHADE__ = results;
  });

  return {
    ready,
    update() {},
    dispose() {
      delete window.__SHADE__;
    },
  };
}
