// The terrain's level of detail (world/lod.js): the nodes it picks cover the
// ground once, neighbours differ by at most a level, and where a node meets a
// coarser one its vertices have finished morphing while the coarser side's
// haven't begun, so there are no cracks, however steep the ground.
import test from 'node:test';
import assert from 'node:assert/strict';
import { config } from '../src/config.js';
import { createLod, lodRanges } from '../src/world/lod.js';

const { leaf, grid, morph } = config.world.terrain;
const levels = 8;
const origin = [-2048, -3048];
const rootSize = leaf * 2 ** (levels - 1);
const cells = rootSize / leaf;

// Rolling ground up to 300 m, cut by a 70 m cliff (the headland's are as
// tall): tall node boxes are what opened seams when ranges counted height.
const ground = (a, o) => 150 + 150 * Math.sin(a / 700) * Math.cos(o / 500) + (a > 400 ? 70 : 0);
const bounds = (a0, o0, size) => {
  let min = Infinity;
  let max = -Infinity;
  for (let i = 0; i <= 4; i++) {
    for (let j = 0; j <= 4; j++) {
      const h = ground(a0 + (i * size) / 4, o0 + (j * size) / 4);
      min = Math.min(min, h);
      max = Math.max(max, h);
    }
  }
  return [min - 2, max + 2];
};
const lod = createLod({ origin, levels, leaf, grid }, bounds);
const cameras = [
  [0, ground(0, 0) + 1.7, 0],
  [600, ground(600, -900) + 40, -900],
  [-1900, 500, 900],
  [100, 3000, -1000],
  [5000, 10, 5000], // off the terrain
];
// And walking along the cliff, where the most nodes meet.
for (let o = -1500; o <= 1500; o += 137) cameras.push([380, ground(380, o) + 1.7, o], [425, ground(425, o) + 1.7, o]);

// Which node covers each leaf-sized cell of the root.
function raster(nodes) {
  const cover = new Int32Array(cells * cells).fill(-1);
  nodes.forEach((node, n) => {
    const size = node.spacing * (node.quarter ? grid / 2 : grid);
    const i0 = Math.round((node.a - origin[0]) / leaf);
    const j0 = Math.round((node.o - origin[1]) / leaf);
    for (let j = j0; j < j0 + size / leaf; j++) {
      for (let i = i0; i < i0 + size / leaf; i++) {
        assert.equal(cover[j * cells + i], -1, `cell ${i}, ${j} covered twice`);
        cover[j * cells + i] = n;
      }
    }
  });
  return cover;
}

// Every edge between neighbouring cells: [cell, neighbour, start a, o, along a?].
function* edges() {
  for (let j = 0; j < cells; j++) {
    for (let i = 0; i < cells; i++) {
      if (i + 1 < cells) yield [j * cells + i, j * cells + i + 1, origin[0] + (i + 1) * leaf, origin[1] + j * leaf, false];
      if (j + 1 < cells) yield [j * cells + i, (j + 1) * cells + i, origin[0] + i * leaf, origin[1] + (j + 1) * leaf, true];
    }
  }
}

for (const [preset, { terrainDetail }] of Object.entries(config.quality.presets)) {
  const { ranges, morphs } = lodRanges(terrainDetail, levels, morph, leaf);

  test(`${preset}: the nodes cover the ground once, neighbours a level apart at most`, () => {
    for (const cam of cameras) {
      const nodes = lod.select(cam, ranges, () => true, []);
      const cover = raster(nodes);
      assert.ok(cover.every((n) => n >= 0), `camera ${cam}: part of the ground is not covered`);
      for (const [c1, c2] of edges()) {
        assert.ok(Math.abs(nodes[cover[c1]].level - nodes[cover[c2]].level) <= 1, `camera ${cam}: levels jump between cells ${c1} and ${c2}`);
      }
      for (const node of nodes) assert.equal(node.spacing, (leaf * 2 ** node.level) / grid);
    }
  });

  test(`${preset}: the finest level is at the camera, and at every seam the finer side has finished morphing and the coarser hasn't begun`, () => {
    let seams = 0;
    for (const cam of cameras) {
      const nodes = lod.select(cam, ranges, () => true, []);
      const cover = raster(nodes);
      if (Math.abs(cam[0]) < rootSize && Math.abs(cam[2]) < rootSize) {
        const at = nodes[cover[Math.floor((cam[2] - origin[1]) / leaf) * cells + Math.floor((cam[0] - origin[0]) / leaf)]];
        if (at) assert.equal(at.level, 0, `camera ${cam}`);
      }
      // Along the edge, as terrain.vert measures: across the ground.
      for (const [c1, c2, a0, o0, alongA] of edges()) {
        const [fine, coarse] = [nodes[cover[c1]], nodes[cover[c2]]].sort((x, y) => x.level - y.level);
        if (fine.level === coarse.level) continue;
        seams++;
        for (let s = 0; s <= 8; s++) {
          const a = alongA ? a0 + (s * leaf) / 8 : a0;
          const o = alongA ? o0 : o0 + (s * leaf) / 8;
          const distance = Math.hypot(a - cam[0], o - cam[2]);
          assert.ok(distance >= morphs[fine.level][1] - 1e-6, `camera ${cam}: a level ${fine.level} vertex ${distance.toFixed(1)} m away meets level ${coarse.level} before its morph ends at ${morphs[fine.level][1]} m`);
          if (coarse.level < levels - 1) {
            assert.ok(distance <= morphs[coarse.level][0] + 1e-6, `camera ${cam}: a level ${coarse.level} vertex ${distance.toFixed(1)} m away has begun to morph (from ${morphs[coarse.level][0]} m) where it meets level ${fine.level}`);
          }
        }
      }
    }
    assert.ok(seams > 100, `only ${seams} seams checked`);
  });
}

test('a detail too short for the nodes to close their seams is refused', () => {
  const shortest = (leaf * Math.SQRT2) / (1 - morph);
  assert.throws(() => lodRanges(Math.floor(shortest), levels, morph, leaf), /too short/);
  assert.doesNotThrow(() => lodRanges(Math.ceil(shortest), levels, morph, leaf));
});

test('culled nodes are left out, and a camera far away still gets the whole ground', () => {
  const { ranges } = lodRanges(128, levels, morph, leaf);
  const right = (node) => node.a + node.spacing * (node.quarter ? grid / 2 : grid) > 0;
  const half = lod.select([0, 100, 0], ranges, (a0, o0, size) => a0 + size > 0, []);
  assert.ok(half.length && half.every(right), 'a node left of the line was drawn');
  assert.ok(half.length < lod.select([0, 100, 0], ranges, () => true, []).length);
  const far = lod.select([1e6, 100, 1e6], ranges, () => true, []);
  assert.deepEqual(far.map((n) => n.level), [levels - 1]);
});
