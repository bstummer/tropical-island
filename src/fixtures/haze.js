// Tool fixture (?fixture=haze): the sky's lookup tables against the air they
// come from. With the sky (main.js adds it), for the view's camera and time, it
// has the GPU compare far sea and hills seen through the aerial perspective,
// the sky as drawn, the sky's light and the sunlight by height with direct
// marches through the same atmosphere, in levels on screen, and leaves the
// worst misses in window.__HAZE__ (haze-cases.js) for tools/screenshot.js, with
// the sunlight at a few heights against the sea level's. Draws nothing. Not
// part of the island.
import * as THREE from 'three';
import vertexShader from '../post/output.vert';
import fragmentShader from './haze.frag';
import { createAtmosphere } from '../sky/atmosphere.js';
import { hazeAmount, sunAtHeight } from '../sky/light.js';
import { sunPath } from '../sky/sun.js';
import { answers, sunHeights, sunlightHeights } from './haze-cases.js';

export function create(ctx) {
  const { renderer, camera, frame, config } = ctx;
  const settings = config.sky;
  // The direct marches need the transmittance and multiple-scattering tables:
  // its own, made as the sky makes them.
  const atmosphere = createAtmosphere(renderer, settings);
  const sun = sunPath.position(ctx.timeOfDay);
  const haze = hazeAmount(sun.elevation, settings.haze);
  atmosphere.renderTables(haze);
  const sunlight = sunlightHeights.map((h) => new THREE.Vector3(...sunAtHeight(h / 1000, sun.elevation, settings.atmosphere, haze)));

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute([-1, -1, 0, 3, -1, 0, -1, 3, 0], 3));
  const material = new THREE.ShaderMaterial({
    name: 'fixture-haze',
    vertexShader,
    fragmentShader,
    defines: { TONEMAP: config.post.tonemaps[frame.tonemap], ANSWERS: answers.length, SUN_AT: sunlightHeights.length, RATIOS: sunHeights.length },
    uniforms: {
      ...atmosphere.uniforms,
      ...frame.uniforms,
      uSunAt: { value: sunlightHeights },
      uSunTruth: { value: sunlight },
      uSunHeights: { value: sunHeights },
    },
    depthTest: false,
    depthWrite: false,
  });
  // Drawn with the game's camera, so cameraPosition is the view's.
  const mesh = new THREE.Mesh(geometry, material);
  mesh.frustumCulled = false;
  const scene = new THREE.Scene();
  scene.add(mesh);
  const texels = answers.length + sunHeights.length;
  const target = new THREE.WebGLRenderTarget(texels, 1, { type: THREE.FloatType, depthBuffer: false });
  renderer.setRenderTarget(target);
  renderer.render(scene, camera);
  const pixels = new Float32Array(4 * texels);
  renderer.readRenderTargetPixels(target, 0, 0, texels, 1, pixels);
  renderer.setRenderTarget(null);
  target.dispose();
  geometry.dispose();
  material.dispose();
  atmosphere.dispose();
  window.__HAZE__ = {
    ...Object.fromEntries(answers.map((name, i) => [name, pixels[4 * i]])),
    sun: Object.fromEntries(sunHeights.map((h, i) => [h, pixels[4 * (answers.length + i)]])),
  };

  return {
    update() {},
    dispose() {
      delete window.__HAZE__;
    },
  };
}
