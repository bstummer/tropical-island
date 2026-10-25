// Builds rows of the heightmap's grids (heightmap.js) off the main thread, so
// boot takes a fraction of the time on a machine with several cores.
// world/terrain.js hands out the jobs: { seed, level, layout, j0, j1 }, the
// layout a level's { texel, origin, samples } (heightmap.js layoutLevel).
import { createRandom } from '../core/random.js';
import { createIsland } from './island.js';
import { fillRows, GROUND } from './heightmap.js';

let island = null;
let islandSeed = null;

self.onmessage = ({ data: { seed, level, layout, j0, j1 } }) => {
  if (seed !== islandSeed) {
    island = createIsland(createRandom(seed));
    islandSeed = seed;
  }
  const count = layout.samples * (j1 - j0);
  const heights = new Float32Array(count);
  const info = new Float32Array(4 * count);
  const ground = new Uint8Array(GROUND * count);
  fillRows(island, layout, j0, j1, heights, info, ground);
  self.postMessage({ level, j0, j1, heights, info, ground }, [heights.buffer, info.buffer, ground.buffer]);
};
