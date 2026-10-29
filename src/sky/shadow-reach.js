// Where the shadows of what casts into the sun's shadow maps can fall on the
// ground (sky/shadows.js), so the ground reads the maps only there
// (world/terrain.js): every SHADOW_CELL-metre cell of the cove's frame that a
// caster's shadow can reach. Pure and Node-importable.
//
// A caster gives a sphere round all it casts from. Its shadow runs away from
// the sun from under it as far as a ray from the sphere's top towards the
// ground at the sun's slope stays above the ground (`heightAt`), but no
// further than `longest` metres, and is as wide as the sphere, with `margin`
// metres more all round for the penumbra, the maps' filter and their reads
// off a surface. Overhead, the cell under it alone.

export const SHADOW_CELL = 4; // m

// The cells as keys of a Set. spheres: [x, y, z, r, ...] in the world; sun:
// towards it, in the world; island: { toCove(x, z), fromCove(a, o) } (linear,
// as world/island.js's); heightAt(x, z): the ground's height in the world.
export function shadowCells(spheres, sun, { island, heightAt, margin, longest }) {
  const cells = new Set();
  const [sa, so] = island.toCove(sun[0], sun[2]);
  const across = Math.hypot(sa, so);
  const away = across > 1e-6 ? [-sa / across, -so / across] : [0, 0];
  const slope = across > 1e-6 ? sun[1] / across : Infinity; // the sun's rays' fall per metre across
  const step = SHADOW_CELL / 2;
  for (let k = 0; k < spheres.length; k += 4) {
    const [x, y, z, r] = [spheres[k], spheres[k + 1], spheres[k + 2], spheres[k + 3]];
    const [a, o] = island.toCove(x, z);
    const top = y + r;
    for (let s = 0; ; s += step) {
      const pa = a + away[0] * s;
      const po = o + away[1] * s;
      mark(cells, pa, po, r + margin);
      if (s >= longest || !Number.isFinite(slope)) break;
      // Past where the ray from its top meets the ground, nothing of it shades.
      const [px, pz] = island.fromCove(pa, po);
      if (top - s * slope < heightAt(px, pz) - margin) break;
    }
  }
  return cells;
}

// Whether any cell between a0, o0 and a1, o1 (the cove's frame) is one of `cells`.
export function cellsMeet(cells, a0, o0, a1, o1) {
  const [i0, i1, j0, j1] = [cellOf(a0), cellOf(a1), cellOf(o0), cellOf(o1)];
  for (let i = i0; i <= i1; i++) {
    for (let j = j0; j <= j1; j++) if (cells.has(key(i, j))) return true;
  }
  return false;
}

// Every cell within `radius` of a, o (the square round it).
function mark(cells, a, o, radius) {
  const [i0, i1, j0, j1] = [cellOf(a - radius), cellOf(a + radius), cellOf(o - radius), cellOf(o + radius)];
  for (let i = i0; i <= i1; i++) {
    for (let j = j0; j <= j1; j++) cells.add(key(i, j));
  }
}

function cellOf(v) {
  return Math.floor(v / SHADOW_CELL);
}

function key(i, j) {
  return (i + 32768) * 65536 + (j + 32768);
}
