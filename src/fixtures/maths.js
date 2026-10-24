// Tool fixture (?fixture=maths): the maths the GPU and JS both do must agree
// (CLAUDE.md §5), and the lookup tables' mappings must invert. At boot it has
// the GPU evaluate the SH basis and irradiance (chunks/sh.wgsl) for the cases in
// maths-cases.js, and run the sky-view, aerial-perspective and multiple-scattering
// mappings forth and back, then leaves the answers in window.__MATHS__ for tools/screenshot.js,
// which checks them against sky/light.js. Draws nothing. Not part of the island.
import { Vector2, Vector3 } from 'three';
import shader from './maths.wgsl';
import { Material } from '../gpu/material.js';
import { createTarget } from '../gpu/texture.js';
import { atmosphereUniforms } from '../sky/atmosphere.js';
import { coefficients, directions, texelCount } from './maths-cases.js';

const DIRECTIONS = 4; // maths.wgsl's
if (directions.length !== DIRECTIONS) throw new Error(`maths fixture: maths.wgsl takes ${DIRECTIONS} directions, maths-cases.js has ${directions.length}`);

export function create(ctx) {
  const { renderer, config } = ctx;
  const { tables } = config.sky;
  const pass = renderer.fullscreen(
    new Material({
      name: 'fixture-maths',
      shader,
      uniforms: {
        ...renderer.globals,
        ...atmosphereUniforms(config.sky.atmosphere, tables),
        uDirections: { value: directions.map((d) => new Vector3(...d)) },
        uSkySH: { value: coefficients.map((c) => new Vector3(...c)) },
        uGroundRadius: { value: config.sky.atmosphere.groundRadius },
        uSkyViewSize: { value: new Vector2(...tables.skyView) },
        uAerialSize: { value: new Vector3(...tables.aerial) },
        uAerialRange: { value: config.sky.aerialRange },
      },
    }),
  );
  const target = createTarget(renderer.gpu, { name: 'fixture-maths', width: texelCount, height: 1, format: 'rgba32float' });
  pass.render(target);
  const ready = target.color.read().then((pixels) => {
    window.__MATHS__ = Array.from(pixels);
  });
  const done = ready.finally(() => {
    target.dispose();
    pass.dispose();
  });

  return {
    ready: done,
    update() {},
    dispose() {
      delete window.__MATHS__;
    },
  };
}
