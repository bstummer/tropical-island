// Spray thrown off the reef's crest where the surf breaks hardest (PLAN.md 7.5): puffs of
// droplets from spots along the crest, every few metres where the sea map says the surf breaks
// hard, each thrown up and forward as a wave breaks there and falling back as it spreads and
// thins (water/spray.wgsl, which works it out from the waves' time). Drawn in the translucent
// pass, and only while the eye is within `reach` of the crest: out of reach it would cost that
// pass for nothing a pixel could show. Made by water/water.js once the sea map is in.
//
// createSpray(ctx, map, settings, surfUniforms) -> { update(camera), dispose() }: map: the sea
// map (water/sea-map.js); settings: config.water.spray; surfUniforms: water-surf.wgsl's.
import shader from './spray.wgsl';
import { Material } from '../gpu/material.js';
import { Geometry } from '../gpu/geometry.js';
import { Mesh } from '../gpu/scene.js';
import { Vector4 } from '../maths/index.js';
import { crestSpots } from './sea-map.js';

export function createSpray(ctx, map, settings, surfUniforms) {
  const { scene, frame, terrain } = ctx;
  const spots = crestSpots(map, settings.breaks).map(([a, o]) => terrain.island.fromCove(a, o));
  const { puffs } = settings;
  const geometry = new Geometry();
  geometry.setAttribute('position', [-1, -1, 0, 1, -1, 0, 1, 1, 0, -1, 1, 0], 3);
  geometry.setIndex([0, 1, 2, 0, 2, 3]);
  const instances = new Float32Array(4 * puffs * spots.length);
  spots.forEach(([x, z], s) => {
    for (let k = 0; k < puffs; k++) instances.set([x, z, s * 0.618 + 1.3, k], 4 * (s * puffs + k));
  });
  geometry.setAttribute('aSpot', instances, 4, { instance: true });
  const material = new Material({
    name: 'spray',
    shader,
    uniforms: {
      ...surfUniforms,
      uSprayTime: { value: new Vector4(settings.lasts, settings.apart, ...settings.up) },
      uSprayThrow: { value: new Vector4(...settings.forward, settings.falls, settings.from) },
      uSpraySize: { value: new Vector4(...settings.size, settings.spread, settings.wide) },
      uSprayLook: { value: new Vector4(...settings.albedo, settings.spots) },
      uSprayLight: { value: new Vector4(settings.facing, ...settings.backlit, settings.dense) },
      uSprayTakes: { value: settings.takes },
    },
    overrides: { SHADE_ONCE: true, SHADOW_MAP: false },
  });
  const mesh = new Mesh(geometry, material);
  mesh.name = 'spray';
  mesh.frustumCulled = false; // its vertex shader places it
  mesh.visible = false;
  frame.translucent(mesh);
  scene.add(mesh);

  return {
    // Drawn while the eye is within reach of a spot.
    update(camera) {
      const { x, y, z } = camera.position;
      const reach = settings.reach * settings.reach - y * y;
      mesh.visible = reach > 0 && spots.some(([sx, sz]) => (sx - x) ** 2 + (sz - z) ** 2 < reach);
    },
    dispose() {
      scene.remove(mesh);
      geometry.dispose();
      material.dispose();
    },
  };
}
