// How far into the foam's tile (textures/foam.js) to cut it, for each share of the
// foam to leave: worked out from the tile's own texels. Pure and Node-importable.
import { Vector4 } from '../maths/index.js';

// The shares of the foam left that the levels are read back for: 0, 1/16, ..., 1.
export const FOAM_LEVELS = 17;

// From the tile's texels (RGBA bytes): for each share of FOAM_LEVELS, the level of
// its r, in holes' radii, above which that share of the texels lies; past all of
// them for none, under all of them for all. Each byte stands for an even spread over its step.
export function foamLevels(texels) {
  const counts = new Float64Array(256);
  for (let n = 0; n < texels.length; n += 4) counts[texels[n]]++;
  const total = texels.length / 4;
  const radii = (byte) => (2 * byte) / 255;
  const levels = [];
  for (let j = 0; j < FOAM_LEVELS; j++) {
    const wanted = (j / (FOAM_LEVELS - 1)) * total;
    if (j === 0) {
      levels.push(radii(256));
      continue;
    }
    if (j === FOAM_LEVELS - 1) {
      levels.push(radii(-1));
      continue;
    }
    let above = 0;
    let level = radii(-1);
    for (let byte = 255; byte >= 0; byte--) {
      if (above + counts[byte] >= wanted) {
        level = radii(byte + 0.5 - (wanted - above) / counts[byte]);
        break;
      }
      above += counts[byte];
    }
    levels.push(level);
  }
  return levels;
}

// water-foam.wgsl's uFoamLevels: the levels, four to a vec4f.
export function foamLevelsUniform(levels) {
  const out = [];
  for (let n = 0; n < levels.length; n += 4) out.push(new Vector4(levels[n], levels[n + 1] ?? 0, levels[n + 2] ?? 0, levels[n + 3] ?? 0));
  return out;
}
