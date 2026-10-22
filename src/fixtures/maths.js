// Tool fixture (?fixture=maths): the maths the GPU and JS both do must agree
// (CLAUDE.md §5), and the lookup tables' mappings must invert. At boot it has
// the GPU evaluate the SH basis and irradiance (chunks/sh.glsl) for the cases in
// maths-cases.js, and run the sky-view, aerial-perspective and multiple-scattering
// mappings forth and back, then leaves the answers in window.__MATHS__ for tools/screenshot.js,
// which checks them against sky/light.js. Draws nothing. Not part of the island.
import * as THREE from 'three';
import vertexShader from '../post/output.vert';
import fragmentShader from './maths.frag';
import { createFullscreen } from '../post/fullscreen.js';
import { coefficients, directions, texelCount } from './maths-cases.js';

export function create(ctx) {
  const { renderer, config } = ctx;
  const pass = createFullscreen(
    new THREE.ShaderMaterial({
      name: 'fixture-maths',
      vertexShader,
      fragmentShader,
      defines: { DIRECTIONS: directions.length },
      uniforms: {
        uDirections: { value: directions.map((d) => new THREE.Vector3(...d)) },
        uCoefficients: { value: coefficients.map((c) => new THREE.Vector3(...c)) },
        uGroundRadius: { value: config.sky.atmosphere.groundRadius },
        uTopRadius: { value: config.sky.atmosphere.topRadius },
        uMultiscatterSize: { value: new THREE.Vector2(...config.sky.tables.multiscatter) },
        uSkyViewSize: { value: new THREE.Vector2(...config.sky.tables.skyView) },
        uAerialSize: { value: new THREE.Vector3(...config.sky.tables.aerial) },
        uAerialRange: { value: config.sky.aerialRange },
      },
    }),
  );
  const target = new THREE.WebGLRenderTarget(texelCount, 1, { type: THREE.FloatType, depthBuffer: false });
  pass.render(renderer, target);
  const pixels = new Float32Array(4 * texelCount);
  renderer.readRenderTargetPixels(target, 0, 0, texelCount, 1, pixels);
  renderer.setRenderTarget(null);
  target.dispose();
  pass.dispose();
  window.__MATHS__ = Array.from(pixels);

  return {
    update() {},
    dispose() {
      delete window.__MATHS__;
    },
  };
}
