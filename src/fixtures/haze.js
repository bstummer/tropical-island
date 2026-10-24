// Tool fixture (?fixture=haze): the sky's lookup tables against the air they
// come from. With the sky (main.js adds it), for the view's camera and time, it
// has the GPU compare far sea and hills seen through the aerial perspective,
// the sky as drawn, the sky's light and the sunlight by height with direct
// marches through the same atmosphere, in levels on screen, and leaves the
// worst misses in window.__HAZE__ (haze-cases.js) for tools/screenshot.js, with
// the sunlight at a few heights against the sea level's. Draws nothing. Not
// part of the island.
import { Vector3, Vector4 } from 'three';
import shader from './haze.wgsl';
import { Material } from '../gpu/material.js';
import { Geometry } from '../gpu/geometry.js';
import { Mesh } from '../gpu/scene.js';
import { createTarget } from '../gpu/texture.js';
import { createAtmosphere } from '../sky/atmosphere.js';
import { hazeAmount, sunAtHeight } from '../sky/light.js';
import { sunPath } from '../sky/sun.js';
import { answers, sunHeights, sunlightHeights } from './haze-cases.js';

// haze.wgsl's array sizes.
if (sunlightHeights.length !== 8 || sunHeights.length !== 2) throw new Error('haze fixture: haze.wgsl takes 8 sunlight heights and 2 heights to report');

export function create(ctx) {
  const { renderer, camera, frame, config } = ctx;
  const settings = config.sky;
  // The direct marches need the transmittance and multiple-scattering tables:
  // its own, made as the sky makes them.
  const atmosphere = createAtmosphere(renderer, settings);
  const sun = sunPath.position(ctx.timeOfDay);
  const haze = hazeAmount(sun.elevation, settings.haze);
  atmosphere.renderTables(0, haze);
  const sunlight = sunlightHeights.map((h) => new Vector3(...sunAtHeight(h / 1000, sun.elevation, settings.atmosphere, haze)));

  const triangle = new Geometry();
  triangle.vertexCount = 3;
  const material = new Material({
    name: 'fixture-haze',
    shader,
    overrides: { TONEMAP: config.post.tonemaps[frame.tonemap], ANSWERS: answers.length },
    uniforms: {
      ...atmosphere.uniforms,
      uTransmittance: { value: atmosphere.tables(0).transmittance },
      uMultiscatter: { value: atmosphere.tables(0).multiscatter },
      uSunAt: { value: sunlightHeights.map((h) => new Vector4(h, 0, 0, 0)) },
      uSunTruth: { value: sunlight },
      uSunHeights: { value: sunHeights.map((h) => new Vector4(h, 0, 0, 0)) },
    },
    depthTest: false,
    depthWrite: false,
  });
  // Drawn with the game's camera, so cameraPosition is the view's.
  const mesh = new Mesh(triangle, material);
  mesh.frustumCulled = false;
  const texels = answers.length + sunHeights.length;
  const target = createTarget(renderer.gpu, { name: 'fixture-haze', width: texels, height: 1, format: 'rgba32float' });
  // Once the sky's first light is in: the tables the fixture checks.
  const ready = ctx.sky.ready
    .then(() => {
      renderer.render([mesh], camera, target);
      return target.color.read();
    })
    .then((pixels) => {
      window.__HAZE__ = {
        ...Object.fromEntries(answers.map((name, i) => [name, pixels[4 * i]])),
        sun: Object.fromEntries(sunHeights.map((h, i) => [h, pixels[4 * (answers.length + i)]])),
      };
    })
    .finally(() => {
      target.dispose();
      material.dispose();
      atmosphere.dispose();
    });

  return {
    ready,
    update() {},
    dispose() {
      delete window.__HAZE__;
    },
  };
}
