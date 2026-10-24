// The terrain's level of detail (world/lod.js): the nodes it picks cover the
// ground once, neighbours differ by at most a level, and where a node meets a
// coarser one its vertices have finished morphing while the coarser side's
// haven't begun, so there are no cracks, however steep the ground. And the
// mesh's height (createMeshHeight) is that of the mesh the GPU draws.
import test from 'node:test';
import assert from 'node:assert/strict';
import { config } from '../src/config.js';
import { createRandom } from '../src/core/random.js';
import { createLod, createMeshHeight, lodRanges } from '../src/world/lod.js';

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

// For the mesh's height: a stand-in for heightmap.js's heightAtCove whose levels
// lie metres apart and wave within a quad, so a vertex at the wrong level, or
// moved wrongly by the morph, shows.
const heightLevels = 4;
const heightAtCove = (a, o, from) => ground(a, o) + 3 * from + (1 + from) * Math.sin(0.9 * a + from) * Math.cos(0.7 * o - from);
const sideOf = (node) => node.spacing * (node.quarter ? grid / 2 : grid);
const holds = (node, a, o) => a >= node.a && a <= node.a + sideOf(node) && o >= node.o && o <= node.o + sideOf(node);

// A drawn node as the GPU draws it, built apart from lod.js: its vertices moved
// and lifted as world/terrain.wgsl does, its triangles as terrain.js's gridGeometry.
// Heights are taken only for the vertices a point needs.
function drawnNode(node, cam, morphs) {
  const quads = node.quarter ? grid / 2 : grid;
  const [start, end] = morphs[node.level];
  const heightLevel = (level) => Math.min(level, heightLevels - 1);
  const fract = (x) => x - Math.floor(x);
  const positions = new Float64Array(2 * (quads + 1) ** 2);
  const ks = new Float64Array((quads + 1) ** 2);
  for (let j = 0; j <= quads; j++) {
    for (let i = 0; i <= quads; i++) {
      const v = j * (quads + 1) + i;
      const k = Math.min(Math.max((Math.hypot(node.a + i * node.spacing - cam[0], node.o + j * node.spacing - cam[2]) - start) / (end - start), 0), 1);
      positions[2 * v] = node.a + (i - fract(i * 0.5) * 2 * k) * node.spacing;
      positions[2 * v + 1] = node.o + (j - fract(j * 0.5) * 2 * k) * node.spacing;
      ks[v] = k;
    }
  }
  const height = (v) => {
    const [a, o, k] = [positions[2 * v], positions[2 * v + 1], ks[v]];
    if (k === 0) return heightAtCove(a, o, heightLevel(node.level));
    const coarse = heightAtCove(a, o, heightLevel(node.level + 1));
    return k < 1 ? heightAtCove(a, o, heightLevel(node.level)) * (1 - k) + coarse * k : coarse;
  };
  return { positions, height, spacing: node.spacing, ...gridTriangles(quads) };
}

// The triangles of a grid of quads, and their areas before the morph, in quads.
const triangles = new Map();
function gridTriangles(quads) {
  if (!triangles.has(quads)) {
    const index = [];
    const facing = [];
    const at = (i, j) => j * (quads + 1) + i;
    for (let j = 0; j < quads; j++) {
      for (let i = 0; i < quads; i++) index.push(at(i, j), at(i, j + 1), at(i + 1, j), at(i + 1, j), at(i, j + 1), at(i + 1, j + 1));
    }
    const ij = (v) => [v % (quads + 1), Math.floor(v / (quads + 1))];
    for (let t = 0; t < index.length; t += 3) {
      const [[i0, j0], [i1, j1], [i2, j2]] = [ij(index[t]), ij(index[t + 1]), ij(index[t + 2])];
      facing.push((i1 - i0) * (j2 - j0) - (j1 - j0) * (i2 - i0));
    }
    triangles.set(quads, { index: Int32Array.from(index), facing: Float64Array.from(facing) });
  }
  return triangles.get(quads);
}

// Adds to `out` the heights drawn at a, o in a drawn node: of every one of its
// triangles that holds the point and faces up. Near the end of its band the
// morph turns slivers over, which face down and are culled; front faces
// overlap there, and either may be drawn.
function drawnHeights({ positions: p, height, index, facing, spacing }, a, o, out) {
  const square = spacing ** 2;
  for (let t = 0; t < index.length; t += 3) {
    const i0 = 2 * index[t];
    const i1 = 2 * index[t + 1];
    const i2 = 2 * index[t + 2];
    const area = (p[i1] - p[i0]) * (p[i2 + 1] - p[i0 + 1]) - (p[i1 + 1] - p[i0 + 1]) * (p[i2] - p[i0]);
    if (area / (facing[t / 3] * square) < 1e-9) continue;
    const w0 = ((p[i1] - a) * (p[i2 + 1] - o) - (p[i1 + 1] - o) * (p[i2] - a)) / area;
    const w1 = ((p[i2] - a) * (p[i0 + 1] - o) - (p[i2 + 1] - o) * (p[i0] - a)) / area;
    const w2 = 1 - w0 - w1;
    if (Math.min(w0, w1, w2) > -1e-9) out.push(w0 * height(i0 / 2) + w1 * height(i1 / 2) + w2 * height(i2 / 2));
  }
  return out;
}

// The middles of the triangles in a drawn node that the morph turned over.
function turnedOver({ positions: p, index, facing, spacing }) {
  const middles = [];
  for (let t = 0; t < index.length; t += 3) {
    const [i0, i1, i2] = [2 * index[t], 2 * index[t + 1], 2 * index[t + 2]];
    const area = (p[i1] - p[i0]) * (p[i2 + 1] - p[i0 + 1]) - (p[i1 + 1] - p[i0 + 1]) * (p[i2] - p[i0]);
    if (area / (facing[t / 3] * spacing ** 2) < -1e-9) middles.push([(p[i0] + p[i1] + p[i2]) / 3, (p[i0 + 1] + p[i1 + 1] + p[i2 + 1]) / 3]);
  }
  return middles;
}

// Points to try for a camera: around it from centimetres to past the coarsest
// range, in every level's morph, and on some of the drawn nodes (more of the
// quarters) at and just inside their corners, along their edges and inside.
function* samplePoints(cam, nodes, ranges, morphs, r) {
  const far = 1.5 * ranges.at(-1);
  const around = (d) => {
    const angle = r.range(0, 2 * Math.PI);
    return [cam[0] + d * Math.cos(angle), cam[2] + d * Math.sin(angle)];
  };
  for (let n = 0; n < 60; n++) yield around(0.05 * (far / 0.05) ** r.next());
  for (const [start, end] of morphs) for (let n = 0; n < 4; n++) yield around(r.range(start, end));
  for (const node of nodes) {
    if (!r.chance(node.quarter ? 0.1 : 0.02)) continue;
    const side = sideOf(node);
    for (const [x, y] of [[0, 0], [1, 0], [0, 1], [1, 1]]) {
      yield [node.a + x * side, node.o + y * side];
      yield [node.a + x * side + (x ? -1e-3 : 1e-3), node.o + y * side + (y ? -1e-3 : 1e-3)];
    }
    for (const [x, y] of [[r.next(), 0], [r.next(), 1], [0, r.next()], [1, r.next()], [r.next(), r.next()]]) {
      yield [node.a + x * side, node.o + y * side];
    }
  }
}

for (const [preset, { terrainDetail, terrainRatio }] of Object.entries(config.quality.presets)) {
  const { ranges, morphs } = lodRanges(terrainDetail, levels, morph, leaf, terrainRatio);

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
      // Along the edge, as world/terrain.wgsl measures: across the ground.
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

  test(`${preset}: the mesh height is the drawn mesh's, in quarters, in the morph, on seams between levels and where the morph turns slivers over`, () => {
    const meshHeight = createMeshHeight({ origin, levels, leaf, grid }, { ranges, morphs }, heightAtCove, heightLevels);
    const r = createRandom(1)(`lod/${preset}`);
    const tried = { points: 0, off: 0, quarters: 0, morphing: 0, seams: 0, turned: 0 };
    for (const cam of cameras) {
      const nodes = lod.select(cam, ranges, () => true, []);
      const drawn = new Map();
      const check = (a, o) => {
        const actual = meshHeight(a, o, cam);
        const holding = nodes.filter((node) => holds(node, a, o));
        tried.points++;
        if (!holding.length) {
          assert.ok(Number.isNaN(actual), `camera ${cam}: ${actual} at ${a}, ${o}, off the ground`);
          tried.off++;
          return;
        }
        const heights = [];
        for (const node of holding) {
          if (!drawn.has(node)) drawn.set(node, drawnNode(node, cam, morphs));
          drawnHeights(drawn.get(node), a, o, heights);
        }
        const [node] = holding;
        assert.ok(heights.length, `camera ${cam}: no triangle holds ${a}, ${o}`);
        const miss = Math.min(...heights.map((h) => Math.abs(actual - h)));
        assert.ok(miss < 1e-6, `camera ${cam}: ${actual} at ${a}, ${o}, drawn at ${heights} (a level ${node.level} ${node.quarter ? 'quarter' : 'node'})`);
        const distance = Math.hypot(a - cam[0], o - cam[2]);
        if (node.quarter) tried.quarters++;
        if (distance > morphs[node.level][0] && distance < morphs[node.level][1]) tried.morphing++;
        if (holding.some((other) => other.level !== node.level)) tried.seams++;
      };
      for (const [a, o] of samplePoints(cam, nodes, ranges, morphs, r)) check(a, o);
      // A sliver turned over lies under two front faces: the height is one of theirs.
      for (const built of [...drawn.values()]) {
        for (const [a, o] of turnedOver(built)) {
          check(a, o);
          tried.turned++;
        }
      }
    }
    for (const [what, count] of Object.entries(tried)) assert.ok(count > 50, `only ${count} ${what} tried`);
  });
}

test('the mesh height is NaN off the ground, and the finest height at vertices near the camera', () => {
  const { ranges, morphs } = lodRanges(128, levels, morph, leaf);
  const meshHeight = createMeshHeight({ origin, levels, leaf, grid }, { ranges, morphs }, heightAtCove, heightLevels);
  const end = origin.map((x) => x + rootSize);
  for (const [a, o] of [[origin[0] - 0.01, 0], [end[0] + 0.01, 0], [0, origin[1] - 0.01], [0, end[1] + 0.01], [1e6, -1e6], [NaN, 0], [0, NaN]]) {
    assert.ok(Number.isNaN(meshHeight(a, o, cameras[0])), `${a}, ${o}`);
  }
  for (const [a, o] of [origin, end, [origin[0], end[1]], [end[0], origin[1]]]) assert.ok(Number.isFinite(meshHeight(a, o, cameras[0])), `${a}, ${o}`);
  // The finest level's vertices are whole steps from the origin.
  const step = leaf / grid;
  let vertices = 0;
  for (const cam of cameras.filter(([a, , o]) => a >= origin[0] && a <= end[0] && o >= origin[1] && o <= end[1])) {
    const [i0, j0] = [Math.round((cam[0] - origin[0]) / step), Math.round((cam[2] - origin[1]) / step)];
    for (let j = j0 - 60; j <= j0 + 60; j++) {
      for (let i = i0 - 60; i <= i0 + 60; i++) {
        const [a, o] = [origin[0] + i * step, origin[1] + j * step];
        if (Math.hypot(a - cam[0], o - cam[2]) >= morphs[0][0]) continue;
        assert.ok(Math.abs(meshHeight(a, o, cam) - heightAtCove(a, o, 0)) < 1e-9, `camera ${cam}: at ${a}, ${o}`);
        vertices++;
      }
    }
  }
  assert.ok(vertices > 10000, `only ${vertices} vertices tried`);
});

test('ranges too short for the nodes to close their seams are refused, and so is a ratio under 2', () => {
  for (const ratio of [2, 2.5, 3]) {
    const shortest = (leaf * Math.SQRT2) / ((ratio - 1) * (1 - morph));
    assert.throws(() => lodRanges(Math.floor(shortest), levels, morph, leaf, ratio), /too short/);
    assert.doesNotThrow(() => lodRanges(Math.ceil(shortest), levels, morph, leaf, ratio));
  }
  assert.throws(() => lodRanges(128, levels, morph, leaf, 1.8), /at least twice/);
});

test('nothing wholly outside what the camera sees is drawn, quarters included', () => {
  const { ranges } = lodRanges(128, levels, morph, leaf);
  let quarters = 0;
  // Half-spaces through cameras at a few places: only what reaches past the line counts as seen.
  for (const [cam, line] of [[[0, 100, 0], 0], [[300, 20, -500], 280], [[-900, 50, 400], -950], [[100, 5, 100], 130]]) {
    const seen = (a0, o0, size) => a0 + size > line;
    for (const node of lod.select(cam, ranges, seen, [])) {
      const size = node.spacing * (node.quarter ? grid / 2 : grid);
      assert.ok(node.a + size > line, `camera ${cam}: a ${node.quarter ? 'quarter' : 'node'} at ${node.a}, ${node.o} lies wholly outside`);
      if (node.quarter) quarters++;
    }
  }
  assert.ok(quarters > 0, 'no quarters were drawn, so none were tested');
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

test("each node carries the surfaces of the ground under it, and no others", () => {
  // A strip of beach: leaves whose square reaches into it hold surface bit 1.
  const beach = (a0, o0, size) => o0 < 200 && o0 + size > 150;
  const withSurfaces = createLod({ origin, levels, leaf, grid }, (a0, o0, size) => [...bounds(a0, o0, size), beach(a0, o0, size) ? 1 : 0]);
  const { ranges } = lodRanges(128, levels, morph, leaf);
  let sandy = 0;
  for (const cam of cameras) {
    for (const node of withSurfaces.select(cam, ranges, () => true, [])) {
      const size = node.spacing * (node.quarter ? grid / 2 : grid);
      // Its leaves, a leaf apart: the node holds the bit if any of them does.
      let any = false;
      for (let o = node.o; o < node.o + size; o += leaf) if (beach(node.a, o, leaf)) any = true;
      assert.equal(node.surfaces, any ? 1 : 0, `a ${node.quarter ? 'quarter' : 'node'} of ${size} m at ${node.a}, ${node.o}`);
      if (any) sandy++;
    }
  }
  assert.ok(sandy > 0, 'no node held the beach, so none were tested');
  // Without surfaces from the bounds, nodes hold none.
  assert.ok(lod.select(cameras[0], ranges, () => true, []).every((n) => n.surfaces === 0));
});
