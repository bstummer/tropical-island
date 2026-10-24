// Tool fixtures: a plain colour (or a texture times it), unlit, with an optional
// fog to black, as three.js's MeshBasicMaterial drew it for them (basic.wgsl).
// `raw` leaves out sceneOutput(), which capture mode must catch (broken.js).
import { Color } from 'three';
import shader from './basic.wgsl';
import { Material } from '../gpu/material.js';

// color: anything three.js's Color takes (hex numbers and strings are sRGB,
// made linear); map: a Texture; fog: [start, end] in metres from the camera.
export function basicMaterial({ name = 'fixture-basic', color = 0xffffff, opacity = 1, map = null, fog = [0, 0], raw = false, ...options } = {}) {
  return new Material({
    name,
    shader,
    fragment: raw ? 'rawFragment' : 'fragmentMain',
    uniforms: {
      uColor: { value: new Color(color) },
      uOpacity: { value: opacity },
      uFog: { value: fog },
      uHasMap: { value: Boolean(map) },
      uMap: { value: map },
    },
    ...options,
  });
}
