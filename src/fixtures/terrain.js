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
// their morphs change; its deliberate mistake: a camera 30 m off. The terrain
// draws as usual meanwhile. Not part of the island.
import * as THREE from 'three';
import vertexShader from '../post/output.vert';
import fragmentShader from './terrain.frag';
import meshShader from './terrain-mesh.frag';
import { views } from '../views.js';
import { createFullscreen } from '../post/fullscreen.js';

const PER_LEVEL = { inside: 48, edge: 32, samples: 16, coarser: 8 };
const MESH = { cameras: 6, points: 400, reach: 2500, off: 30 }; // seeded cameras; points per camera, within reach m

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

