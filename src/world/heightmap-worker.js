// Builds rows of the heightmap's grids (heightmap.js) off the main thread, so
// boot takes a fraction of the time on a machine with several cores.
// world/terrain.js hands out the jobs: { seed, level, j0, j1 }.
import { config } from '../config.js';
import { createRandom } from '../core/random.js';
import { createIsland } from './island.js';
import { fillRows, layoutLevels } from './heightmap.js';

const settings = config.world.terrain;
const levels = layoutLevels(settings);
let island = null;
let islandSeed = null;

self.onmessage = ({ data: { seed, level, j0, j1 } }) => {
  if (seed !== islandSeed) {
    island = createIsland(createRandom(seed));
    islandSeed = seed;
  }
  const rows = j1 - j0;
  const heights = new Float32Array(settings.samples * rows);
  const info = new Float32Array(4 * settings.samples * rows);
  fillRows(island, levels[level], settings.samples, j0, j1, heights, info);
  self.postMessage({ level, j0, j1, heights, info }, [heights.buffer, info.buffer]);
};
