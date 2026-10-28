// The ground's surface tiles (PLAN.md Stage 4), made on the GPU at boot into
// one texture array, so a shader reads all of them through one texture binding
// and leaves the others for what comes later (shadows, caustics, the clouds'
// shadows): a shader stage has 16 at least, and the terrain's lighting alone
// takes eight. Its layers (chunks/tiles.wgsl has the same):
//   0 grain, 1 ripples   textures/sand.js
//   2 rock               textures/rock.js
//   3 grass, 4 litter,   textures/green.js
//   5 leaves
// Each tile is `size` texels across (quality.surfaceTexture), mipmapped and
// repeating; `shift`: tiles to shift them by, which leaves them as they are if
// they truly repeat (fixtures/surfaces.js checks). Each module's own numbers
// (the averages the shaders divide by) are read back from the GPU, so they
// come later: { tiles, ready, pixels(name), dispose() }; tiles: the array
// (drawn when this returns, but for the litter's and its leaves', which land
// with `ready`: textures/green.js); ready: a promise of { sand, rock, green };
// pixels(name): a promise of a layer's texels (RGBA bytes, rows from the
// first). The owner disposes them.
import { createTarget } from '../gpu/texture.js';
import { makeSandTiles } from './sand.js';
import { makeRockTile } from './rock.js';
import { makeGreenTiles } from './green.js';

export const LAYERS = { grain: 0, ripples: 1, rock: 2, grass: 3, litter: 4, leaves: 5 };

// renderer: ctx.renderer; settings: config.world.terrain; rng(name): a stream
// per module, as ctx.rng, under `prefix`.
export function createSurfaceTiles(renderer, rng, prefix, settings, size, shift = [0, 0]) {
  const target = createTarget(renderer.gpu, {
    name: 'surface tiles',
    width: size,
    height: size,
    layers: Object.keys(LAYERS).length,
    array: true,
    format: 'rgba8unorm',
    mips: true,
    sampler: { mag: 'linear', min: 'linear', mipmap: 'linear', wrap: 'repeat', anisotropy: 4 },
  });
  const pixels = (name) => target.color.read({ layer: LAYERS[name] });
  const into = { renderer, target, layers: LAYERS, size, shift, pixels };
  const sand = makeSandTiles(into, rng(`${prefix}/sand`), settings.sand);
  const rock = makeRockTile(into, rng(`${prefix}/rock`), settings.rock);
  const green = makeGreenTiles(into, rng(`${prefix}/green`), settings.green);
  // The mip chain, once every layer is drawn (the read-backs above are of
  // level 0 and already queued). The litter's layers are still blank here:
  // textures/green.js writes them with their own mip levels once read back.
  target.color.generateMipmaps();
  return {
    tiles: target.color,
    ready: Promise.all([sand, rock, green]).then(([s, r, g]) => ({ sand: s, rock: r, green: g })),
    pixels,
    dispose() {
      target.dispose();
    },
  };
}

// The uniform chunks/tiles.wgsl reads.
export function tilesUniforms(surfaceTiles) {
  return { uSurfaceTiles: { value: surfaceTiles.tiles } };
}
