// The ground's surface tiles (PLAN.md Stage 4), made on the GPU at boot into
// one texture array, so a shader reads all of them through one texture unit
// and leaves the others for what comes later (shadows, caustics, the clouds'
// shadows): a shader has 16 at least, and the terrain's lighting alone takes
// eight. Its layers (chunks/tiles.glsl has the same):
//   0 grain, 1 ripples   textures/sand.js
//   2 rock               textures/rock.js
//   3 grass, 4 litter    textures/green.js
// Each tile is `size` texels across (quality.surfaceTexture), mipmapped and
// repeating; `shift`: tiles to shift them by, which leaves them as they are if
// they truly repeat (fixtures/surfaces.js checks). Each module's own numbers
// (the averages the shaders divide by) come along: { tiles, sand, rock,
// green, pixels(name), dispose() }; pixels(name) reads a layer back. The owner
// disposes them.
import * as THREE from 'three';
import { makeSandTiles } from './sand.js';
import { makeRockTile } from './rock.js';
import { makeGreenTiles } from './green.js';

export const LAYERS = { grain: 0, ripples: 1, rock: 2, grass: 3, litter: 4 };

// settings: config.world.terrain; rng(name): a stream per module, as
// ctx.rng, under `prefix`.
export function createSurfaceTiles(renderer, rng, prefix, settings, size, shift = [0, 0]) {
  const before = renderer.getRenderTarget();
  const target = new THREE.WebGLArrayRenderTarget(size, size, Object.keys(LAYERS).length, {
    depthBuffer: false,
    wrapS: THREE.RepeatWrapping,
    wrapT: THREE.RepeatWrapping,
    minFilter: THREE.LinearMipmapLinearFilter,
    magFilter: THREE.LinearFilter,
    generateMipmaps: true,
    anisotropy: 4,
  });
  const pixels = (name) => {
    const data = new Uint8Array(4 * size * size);
    renderer.setRenderTarget(target, LAYERS[name]);
    renderer.readRenderTargetPixels(target, 0, 0, size, size, data);
    renderer.setRenderTarget(before);
    return data;
  };
  const into = { renderer, target, layers: LAYERS, size, shift, pixels };
  const sand = makeSandTiles(into, rng(`${prefix}/sand`), settings.sand);
  const rock = makeRockTile(into, rng(`${prefix}/rock`), settings.rock);
  const green = makeGreenTiles(into, rng(`${prefix}/green`), settings.green);
  renderer.setRenderTarget(before);
  return {
    tiles: target.texture,
    sand,
    rock,
    green,
    pixels,
    dispose() {
      target.dispose();
    },
  };
}

// The uniform chunks/tiles.glsl reads.
export function tilesUniforms(surfaceTiles) {
  return { uSurfaceTiles: { value: surfaceTiles.tiles } };
}
