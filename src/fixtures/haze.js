// Tool fixture (?fixture=haze): the sky's lookup tables against the air they
// come from. With the sky (main.js adds it), for the view's camera and time, it
// has the GPU compare far sea and hills seen through the aerial perspective,
// the sky as drawn and the sky's light with direct marches through the same
// atmosphere, in levels on screen, and leaves the worst misses in
// window.__HAZE__ (haze-cases.js) for tools/screenshot.js. Draws nothing. Not
// part of the island.
import * as THREE from 'three';
import vertexShader from '../post/output.vert';
import fragmentShader from './haze.frag';
import { createAtmosphere } from '../sky/atmosphere.js';
import { hazeAmount } from '../sky/light.js';
import { sunPath } from '../sky/sun.js';
import { answers } from './haze-cases.js';

export function create(ctx) {
  const { renderer, camera, frame, config } = ctx;
  const settings = config.sky;
  // The direct marches need the transmittance and multiple-scattering tables:
  // its own, made as the sky makes them.
  const atmosphere = createAtmosphere(renderer, settings.atmosphere, settings.tables, settings.aerialRange, settings.samples);
  atmosphere.renderTables(hazeAmount(sunPath.position(ctx.timeOfDay).elevation, settings.haze));

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute([-1, -1, 0, 3, -1, 0, -1, 3, 0], 3));
  const material = new THREE.ShaderMaterial({
    name: 'fixture-haze',
    vertexShader,
    fragmentShader,
    defines: { TONEMAP: config.post.tonemaps[frame.tonemap] },
    uniforms: { ...atmosphere.uniforms, ...frame.uniforms },
    depthTest: false,
    depthWrite: false,
  });
  // Drawn with the game's camera, so cameraPosition is the view's.
  const mesh = new THREE.Mesh(geometry, material);
  mesh.frustumCulled = false;
  const scene = new THREE.Scene();
  scene.add(mesh);
  const target = new THREE.WebGLRenderTarget(answers.length, 1, { type: THREE.FloatType, depthBuffer: false });
  renderer.setRenderTarget(target);
  renderer.render(scene, camera);
  const pixels = new Float32Array(4 * answers.length);
  renderer.readRenderTargetPixels(target, 0, 0, answers.length, 1, pixels);
  renderer.setRenderTarget(null);
  target.dispose();
  geometry.dispose();
  material.dispose();
  atmosphere.dispose();
  window.__HAZE__ = Object.fromEntries(answers.map((name, i) => [name, pixels[4 * i]]));

  return {
    update() {},
    dispose() {
      delete window.__HAZE__;
    },
  };
}
