// The sea's waves (water/spectrum.js, water/surface.js) and the mesh they move
// (water/water-nodes.js). Properties, over seeds; the water fixture holds the
// GPU's sum to these waves.
import test from 'node:test';
import assert from 'node:assert/strict';
import { config } from '../src/config.js';
import { createRandom } from '../src/core/random.js';
import { buildSpectrum, jonswap, largestWaves, spreading, unresolvedSlopes, wave } from '../src/water/spectrum.js';
import { createSurface } from '../src/water/surface.js';
import { selectSea } from '../src/water/water-nodes.js';
import { lodRanges } from '../src/world/lod.js';

const { waves } = config.water;
const SIZE = 64;
const direction = (degrees) => {
  const t = (degrees * Math.PI) / 180;
  return [Math.sin(t), Math.cos(t)];
};
const spectrumOf = (seed, size = SIZE, settings = waves) => buildSpectrum(settings, size, createRandom(seed)('water/spectrum'), direction);

// The whole sum of a cascade's height at x, z, t, by its definition.
function heightOf(c, x, z, t) {
  const dk = (2 * Math.PI) / c.patch;
  let sum = 0;
  for (let j = 0; j < c.size; j++) {
    for (let i = 0; i < c.size; i++) {
      const n = j * c.size + i;
      const phase = wave(i, c.size) * dk * x + wave(j, c.size) * dk * z - c.frequencies[n] * t;
      sum += 2 * (c.amplitudes[4 * n] * Math.cos(phase) - c.amplitudes[4 * n + 1] * Math.sin(phase));
    }
  }
  return sum;
}

test('the same seed gives the same waves, another seed others, of the same power', () => {
  const a = spectrumOf(1);
  const b = spectrumOf(1);
  const c = spectrumOf(2);
  a.cascades.forEach((cascade, k) => {
    assert.deepEqual(cascade.amplitudes, b.cascades[k].amplitudes);
    assert.notDeepEqual(cascade.amplitudes, c.cascades[k].amplitudes);
  });
});

test('each sea stands as tall as asked, on average over seeds: its waves together make up its significant height', () => {
  const measure = (cascades) => cascades.reduce((sum, { amplitudes }) => {
    let power = 0;
    for (let n = 0; n < amplitudes.length; n += 4) power += 2 * (amplitudes[n] ** 2 + amplitudes[n + 1] ** 2);
    return sum + power;
  }, 0);
  let swell = 0;
  let chop = 0;
  const seeds = 40;
  for (let seed = 1; seed <= seeds; seed++) {
    const { cascades } = spectrumOf(seed);
    swell += measure([cascades[0]]);
    chop += measure([cascades[1], cascades[2]]);
  }
  const height = (variance) => 4 * Math.sqrt(variance / seeds);
  assert.ok(Math.abs(height(swell) - waves.swell.height) / waves.swell.height < 0.15, `the swell stands ${height(swell)} m`);
  assert.ok(Math.abs(height(chop) - waves.chop.height) / waves.chop.height < 0.15, `the chop stands ${height(chop)} m`);
});

test('a JONSWAP peak lies at its frequency, and the waves run mostly the way their sea does', () => {
  const wp = (2 * Math.PI) / 8;
  let best = 0;
  let at = 0;
  for (let w = 0.1; w < 4; w += 0.001) {
    const s = jonswap(w, wp, 3.3);
    if (s > best) [best, at] = [s, w];
  }
  assert.ok(Math.abs(at - wp) < 0.01, `the peak at ${at}, not ${wp}`);
  assert.equal(spreading(0, 8), 1);
  assert.ok(spreading(Math.PI / 2, 8) < 0.1 && spreading(Math.PI, 8) < 1e-9);

  // The swell's waves head in from the sea, the chop's out with the wind.
  const { cascades } = spectrumOf(3);
  const heading = (c) => {
    const dk = (2 * Math.PI) / c.patch;
    let [x, z] = [0, 0];
    for (let j = 0; j < c.size; j++) {
      for (let i = 0; i < c.size; i++) {
        const p = c.amplitudes[4 * (j * c.size + i)] ** 2 + c.amplitudes[4 * (j * c.size + i) + 1] ** 2;
        x += p * wave(i, c.size) * dk;
        z += p * wave(j, c.size) * dk;
      }
    }
    return [x, z];
  };
  const [sx, sz] = heading(cascades[0]);
  const [dx, dz] = direction(waves.swell.from);
  assert.ok((sx * -dx + sz * -dz) / Math.hypot(sx, sz) > 0.9, 'the swell runs in from where it comes from');
  const [cx, cz] = heading(cascades[1]);
  const [wx, wz] = direction(waves.chop.blows);
  assert.ok((cx * wx + cz * wz) / Math.hypot(cx, cz) > 0.7, 'the chop runs the way the wind blows');
});

test('the cascades hold bands that do not overlap, and every wave has a frequency', () => {
  // As many waves as the game has: the long waves' cascade reaches past the split.
  const size = config.quality.presets.high.waterSize;
  const { cascades } = spectrumOf(1, size);
  const dk = (c) => (2 * Math.PI) / c.patch;
  let most = 0;
  const [, long, short] = cascades;
  for (let j = 0; j < size; j++) {
    for (let i = 0; i < size; i++) {
      const n = j * size + i;
      const [a, b] = [wave(i, size), wave(j, size)];
      if (long.amplitudes[4 * n] || long.amplitudes[4 * n + 1]) most = Math.max(most, Math.hypot(a, b) * dk(long));
      if (short.amplitudes[4 * n] || short.amplitudes[4 * n + 1]) assert.ok(Math.hypot(a, b) * dk(short) >= waves.chop.split);
      if ((a || b) && i !== size / 2 && j !== size / 2) assert.ok(long.frequencies[n] > 0 && short.frequencies[n] > 0);
    }
  }
  assert.ok(most < waves.chop.split, `the long waves reach ${most}, past the split at ${waves.chop.split}`);
});

test('the height is real: a wave and its opposite are conjugate, so the sum at any time matches the two-sided sum', () => {
  const { cascades } = spectrumOf(5);
  const c = cascades[1];
  const n = (i, j) => (j % SIZE) * SIZE + i % SIZE;
  for (let j = 0; j < SIZE; j++) {
    for (let i = 0; i < SIZE; i++) {
      const m = n(SIZE - i, SIZE - j);
      assert.equal(c.amplitudes[4 * n(i, j) + 2], c.amplitudes[4 * m]);
      assert.equal(c.amplitudes[4 * n(i, j) + 3], -c.amplitudes[4 * m + 1]);
    }
  }
});

test('it repeats after its loop, not before: frequencies are whole turns of it', () => {
  const { cascades, loop } = spectrumOf(2);
  const c = cascades[1];
  const w0 = (2 * Math.PI) / loop;
  for (const w of c.frequencies) assert.ok(Math.abs(w / w0 - Math.round(w / w0)) < 1e-3, `${w} isn't a whole number of turns`);
  const at = (t) => heightOf(c, 12.3, -45.6, t);
  assert.ok(Math.abs(at(7) - at(7 + loop)) < 1e-3);
  assert.ok(Math.abs(at(7) - at(7 + 5)) > 1e-3);
  assert.ok(Math.abs(at(7) - at(7 + loop / 2)) > 1e-3);
});

test('what JS sums: the largest waves make up nearly all the power, and of the height at any point', () => {
  for (const seed of [1, 2, 3]) {
    const { cascades } = spectrumOf(seed);
    for (const c of cascades.slice(0, 2)) {
      const all = largestWaves(c, 0, Infinity);
      const some = largestWaves(c, waves.inJs.rest, waves.inJs.most);
      const power = (list) => list.reduce((sum, w) => sum + w.re ** 2 + w.im ** 2, 0);
      assert.ok(power(some) >= 0.9 * power(all), `seed ${seed}: ${power(some) / power(all)} of its power`);
      for (let i = 1; i < some.length; i++) assert.ok(some[i - 1].power >= some[i].power);
    }
  }
});

test("the unresolved slopes: none in the finest mip's waves, growing as mips lose waves, and all of it in the last", () => {
  const { cascades } = spectrumOf(4);
  const c = cascades[2];
  const levels = Math.log2(SIZE) + 1;
  const lost = unresolvedSlopes(c, levels);
  assert.equal(lost[0], 0);
  for (let l = 1; l < levels; l++) assert.ok(lost[l] >= lost[l - 1]);
  assert.ok(lost[levels - 1] > 0);
});

// A map of its own: full reach everywhere, nothing of what the island does.
const open = { at: (a, o, out) => Object.assign(out, { swell: 1, wind: 1, depth: 20 }) };
const nowhere = { at: (a, o, out) => Object.assign(out, { swell: 0, wind: 0, depth: 0 }) };

test('the surface in JS: still where nothing reaches, moving where the sea does, the same at a time and a loop later, and it follows a crest back to where it came from', () => {
  const spectrum = spectrumOf(6);
  const moving = createSurface(spectrum, open, (x, z) => [x, z], waves.inJs, waves.ripplesLeast);
  const still = createSurface(spectrum, nowhere, (x, z) => [x, z], waves.inJs, waves.ripplesLeast);
  assert.equal(still.heightAt(10, 20, 3), 0);
  const heights = [0, 1, 2, 3, 4, 5].map((t) => moving.heightAt(10, 20, t));
  assert.ok(new Set(heights).size === 6);
  assert.ok(Math.max(...heights.map(Math.abs)) < 3, `heights ${heights}`);
  assert.ok(Math.abs(moving.heightAt(10, 20, 3) - moving.heightAt(10, 20, 3 + spectrum.loop)) < 1e-6);

  // What heightAt says stands over x, z: the displaced point lands there, and at that height.
  let [x, z] = [31.5, -7.25];
  const t = 2.5;
  const h = moving.heightAt(x, z, t);
  for (let i = 0; i < 8; i++) {
    const d = moving.displacement(x, z, t);
    x = 31.5 - d[0];
    z = -7.25 - d[2];
  }
  assert.ok(Math.abs(moving.displacement(x, z, t)[1] - h) < 0.01);
});

test('the surface in JS scales each cascade by how much of it reaches a point, as the GPU does', () => {
  const spectrum = spectrumOf(7);
  const onlySwell = (swell) => createSurface(spectrum, { at: (a, o, out) => Object.assign(out, { swell, wind: 0, depth: 0 }) }, (x, z) => [x, z], waves.inJs, waves.ripplesLeast);
  const [whole, half] = [onlySwell(1), onlySwell(0.5)];
  for (const [x, z, t] of [[5, 7, 1], [-40, 90, 3.5], [200, -13, 8]]) {
    const [a, b] = [whole.displacement(x, z, t), half.displacement(x, z, t)];
    assert.ok(Math.abs(a[1]) > 1e-3);
    a.forEach((v, c) => assert.ok(Math.abs(b[c] - 0.5 * v) < 1e-9, `half the swell at ${x}, ${z}: ${b[c]}, not half of ${v}`));
  }
  // Ripples reach calm water, but none where there is no water to move.
  const reach = (wind, depth) => createSurface(spectrum, { at: (a, o, out) => Object.assign(out, { swell: 0, wind, depth }) }, (x, z) => [x, z], waves.inJs, waves.ripplesLeast).reachInto(0, 0, [0, 0, 0]);
  assert.equal(reach(0, 5)[2], waves.ripplesLeast);
  assert.equal(reach(0, 0)[2], 0);
  assert.equal(reach(1, 5)[1], 1);
  assert.equal(reach(0.5, 5)[1], 0.25);
});

test('the sea mesh covers the ground once, neighbours a level apart at most, and takes nothing out unless asked', () => {
  const { leaf, reach, morph } = config.water.mesh;
  for (const [name, { waterDetail, waterGrid }] of Object.entries(config.quality.presets)) {
    const levels = Math.ceil(Math.log2(reach / leaf)) + 1;
    const { ranges } = lodRanges(waterDetail, levels, morph, leaf);
    const root = leaf * 2 ** (levels - 1);
    const tree = { origin: [-root / 2, -root / 2], levels, leaf, grid: waterGrid };
    const r = createRandom(1)('test/sea-mesh');
    for (let n = 0; n < 5; n++) {
      const cam = [r.range(-2000, 2000), 3, r.range(-2000, 2000)];
      const nodes = selectSea(tree, cam, ranges, () => true, []);
      assert.ok(nodes.length < 1024, `${name}: ${nodes.length} nodes`);
      const covered = nodes.reduce((sum, node) => {
        const size = node.spacing * (node.quarter ? waterGrid / 2 : waterGrid);
        return sum + size * size;
      }, 0);
      assert.ok(Math.abs(covered - root * root) / (root * root) < 1e-9, `${name}: ${covered} m² of ${root * root}`);
      // At any point near the camera, the finest detail; far away, a coarse one.
      const near = nodes.find((node) => {
        const size = node.spacing * (node.quarter ? waterGrid / 2 : waterGrid);
        return cam[0] >= node.x && cam[0] < node.x + size && cam[2] >= node.z && cam[2] < node.z + size;
      });
      assert.equal(near.level, 0);
      assert.ok(nodes.some((node) => node.level > 8));
    }
    const none = selectSea(tree, [0, 3, 0], ranges, () => false, []);
    assert.equal(none.length, 0);
  }
});
