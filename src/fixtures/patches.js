// Tool fixture (?fixture=patches): the green's patches the GPU draws
// (chunks/patches.glsl) must be the ones JS knows (world/green.js), which
// placement reads (Stage 9). At boot it has the GPU evaluate them at seeded
// points, out past the island's far side and on both sides of zero, for
// seeded seeds, and leaves in window.__PATCHES__ how far the GPU's values
// land from JS's at worst, and how far they land with the points shifted by
// a tenth of a patch, a deliberate mistake the comparison has to catch.
// Draws nothing. Not part of the island.
import * as THREE from 'three';
import vertexShader from '../post/output.vert';
import fragmentShader from './patches.frag';
import { createFullscreen } from '../post/fullscreen.js';
import { greenPatches } from '../world/green.js';

const POINTS = 1024;
const REACH = 4000; // m either side of the origin

export function create(ctx) {
  const { renderer, config } = ctx;
  const { green } = config.world.terrain;
  const r = ctx.rng('fixtures/patches');
  const seeds = [r.int(0, 0xffffff), r.int(0, 0xffffff)];
  const points = Array.from({ length: POINTS }, () => [r.range(-REACH, REACH), r.range(-REACH, REACH)]);
  const data = new Float32Array(4 * POINTS);
  points.forEach((p, i) => data.set([...p, 0, 0], 4 * i));
  const pointTexture = new THREE.DataTexture(data, POINTS, 1, THREE.RGBAFormat, THREE.FloatType);
  pointTexture.needsUpdate = true;
  const pass = createFullscreen(
    new THREE.ShaderMaterial({
      name: 'fixture-patches',
      vertexShader,
      fragmentShader,
      uniforms: {
        uPoints: { value: pointTexture },
        uOffset: { value: 0 },
        uGreenPatches: { value: new THREE.Vector2(green.patches.size, green.patches.sharp) },
        uGreenSeeds: { value: new THREE.Vector2(...seeds) },
      },
    }),
  );
  const target = new THREE.WebGLRenderTarget(POINTS, 1, { type: THREE.FloatType, depthBuffer: false });
  const read = (offset) => {
    pass.uniforms.uOffset.value = offset;
    pass.render(renderer, target);
    const pixels = new Float32Array(4 * POINTS);
    renderer.readRenderTargetPixels(target, 0, 0, POINTS, 1, pixels);
    renderer.setRenderTarget(null);
    return pixels;
  };
  const gpu = read(0);
  const mistaken = read(0.1 * green.patches.size);
  target.dispose();
  pass.dispose();
  pointTexture.dispose();

  const patches = greenPatches(green, seeds);
  let worst = 0;
  let worstMistaken = 0;
  points.forEach(([x, z], i) => {
    const rank = patches.rank(x, z);
    worst = Math.max(worst, Math.abs(gpu[4 * i] - rank));
    worstMistaken = Math.max(worstMistaken, Math.abs(mistaken[4 * i] - rank));
  });
  window.__PATCHES__ = { points: POINTS, gpu: worst, mistaken: worstMistaken };

  return {
    update() {},
    dispose() {
      delete window.__PATCHES__;
    },
  };
}
