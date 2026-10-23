// Rock prototypes (world/rock-shapes.js), over seeds 1 to 20: each closed,
// convex and facing out, flat-shaded, in its resting pose within its bounds
// and vertex budget, its lower points on its surface; blocks and five- or
// six-sided columns, no two alike, all chipped.
import test from 'node:test';
import assert from 'node:assert/strict';
import { config } from '../src/config.js';
import { createRandom } from '../src/core/random.js';
import { makeRockShapes } from '../src/world/rock-shapes.js';

const settings = config.world.rocks.shapes; // the game's

const SEEDS = Array.from({ length: 20 }, (_, i) => i + 1);
const TOLERANCE = 1e-5; // float32 positions of shapes about 2 across
const make = (seed, s = settings) => makeRockShapes(createRandom(seed)('rocks/shapes'), s);
const bySeed = new Map(SEEDS.map((seed) => [seed, make(seed)]));

function* everyShape() {
  for (const [seed, shapes] of bySeed) for (const [i, shape] of shapes.entries()) yield [`seed ${seed}, ${shape.kind} ${i}`, shape];
}

const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const length = (a) => Math.sqrt(dot(a, a));
const at = (array, i) => [array[3 * i], array[3 * i + 1], array[3 * i + 2]];

// Its triangles: corners, their indices, the stored normal of each corner,
// and the normal and area the corners make.
function triangles({ positions, normals, index }) {
  const out = [];
  for (let t = 0; t < index.length; t += 3) {
    const ids = [index[t], index[t + 1], index[t + 2]];
    const [a, b, c] = ids.map((i) => at(positions, i));
    const span = cross(sub(b, a), sub(c, a));
    out.push({ ids, corners: [a, b, c], stored: ids.map((i) => at(normals, i)), normal: span.map((x) => x / length(span)), area: length(span) / 2 });
  }
  return out;
}

// Its corners welded where their positions are the same.
function weld({ positions }) {
  const ids = new Map();
  const points = [];
  const of = [];
  for (let i = 0; i < positions.length / 3; i++) {
    const key = at(positions, i).join();
    if (!ids.has(key)) ids.set(key, points.push(at(positions, i)) - 1);
    of.push(ids.get(key));
  }
  return { points, of };
}

// Its flat faces, by their normals.
const facets = ({ normals }) => new Set(Array.from({ length: normals.length / 3 }, (_, i) => at(normals, i).join()));

test('the same seed makes the same shapes, byte for byte', () => {
  const [a, b] = [make(7), make(7)];
  assert.equal(a.length, b.length);
  a.forEach((shape, i) => {
    assert.equal(shape.kind, b[i].kind);
    assert.equal(shape.height, b[i].height);
    for (const name of ['positions', 'normals', 'index', 'lower']) {
      assert.ok(Buffer.from(shape[name].buffer).equals(Buffer.from(b[i][name].buffer)), `${shape.kind} ${i}: ${name} differ`);
    }
  });
});

test('every shape is closed, wound one way round, with no degenerate triangles or doubled corners', () => {
  for (const [name, shape] of everyShape()) {
    const { points, of } = weld(shape);
    const edges = new Map();
    for (const { ids, area } of triangles(shape)) {
      assert.ok(area > 1e-5, `${name}: a triangle of area ${area}`);
      const w = ids.map((i) => of[i]);
      for (let k = 0; k < 3; k++) {
        const key = `${w[k]},${w[(k + 1) % 3]}`;
        edges.set(key, (edges.get(key) ?? 0) + 1);
      }
    }
    // Every edge runs once each way: shared by two triangles that agree on which side is out.
    for (const [key, count] of edges) {
      const [a, b] = key.split(',');
      assert.equal(count, 1, `${name}: edge ${key} runs ${count} times one way`);
      assert.equal(edges.get(`${b},${a}`), 1, `${name}: edge ${key} has no triangle on its other side`);
    }
    // Corners that nearly meet but aren't welded would leave a crack.
    for (let i = 0; i < points.length; i++) {
      for (let j = i + 1; j < points.length; j++) assert.ok(length(sub(points[i], points[j])) > 1e-3, `${name}: corners ${i} and ${j} almost meet`);
    }
  }
});

test('each corner carries its facet\'s normal, which points out of a convex shape', () => {
  for (const [name, shape] of everyShape()) {
    const { points } = weld(shape);
    const centre = points.reduce((sum, p) => sum.map((x, k) => x + p[k] / points.length), [0, 0, 0]);
    for (const { corners, stored, normal } of triangles(shape)) {
      for (const n of stored) {
        assert.ok(Math.abs(length(n) - 1) < TOLERANCE, `${name}: a normal of length ${length(n)}`);
        assert.ok(dot(n, normal) > 1 - 1e-6, `${name}: a stored normal ${(Math.acos(Math.min(1, dot(n, normal))) * 180 / Math.PI).toFixed(3)}° off its triangle's`);
      }
      const middle = corners.reduce((sum, p) => sum.map((x, k) => x + p[k] / 3), [0, 0, 0]);
      assert.ok(dot(normal, sub(middle, centre)) > 0, `${name}: a triangle faces in`);
      // Measured along the facet's own normal: a thin triangle's, from float32 corners, is less exact.
      const out = (p) => dot(stored[0], sub(p, corners[0]));
      for (const p of points) assert.ok(out(p) < TOLERANCE, `${name}: a corner stands ${out(p)} out of a facet's plane: not convex`);
    }
  }
});

test('each lies within its bounds, from y = 0 to its height, half-width 1, within the vertex budget', () => {
  for (const [name, shape] of everyShape()) {
    const { positions, index, height } = shape;
    const count = positions.length / 3;
    assert.ok(count <= settings.maxVertices, `${name}: ${count} vertices`);
    assert.equal(index.length % 3, 0);
    assert.ok(index.every((i) => i < count), `${name}: an index past its vertices`);
    const ys = Array.from({ length: count }, (_, i) => positions[3 * i + 1]);
    const reach = Array.from({ length: count }, (_, i) => Math.hypot(positions[3 * i], positions[3 * i + 2]));
    assert.ok(Math.abs(Math.min(...ys)) < TOLERANCE, `${name}: lowest point at ${Math.min(...ys)}`);
    assert.ok(Math.abs(Math.max(...ys) - height) < TOLERANCE, `${name}: highest point ${Math.max(...ys)}, height ${height}`);
    assert.ok(Math.abs(Math.max(...reach) - 1) < TOLERANCE, `${name}: reaches ${Math.max(...reach)} from the y axis`);
  }
});

test('the lower points lie on the surface, in its lower part, and ring it closely', () => {
  for (const [name, shape] of everyShape()) {
    const { lower, height } = shape;
    const level = settings.lower.height * height;
    const planes = triangles(shape).map(({ corners, stored }) => [stored[0], dot(stored[0], corners[0])]);
    const points = Array.from({ length: lower.length / 3 }, (_, i) => at(lower, i));
    assert.ok(points.length >= 3, `${name}: ${points.length} lower points`);
    for (const p of points) {
      const out = planes.map(([n, d]) => dot(n, p) - d);
      assert.ok(Math.max(...out) < TOLERANCE, `${name}: a lower point ${Math.max(...out)} outside it`);
      assert.ok(Math.max(...out) > -TOLERANCE, `${name}: a lower point ${-Math.max(...out)} inside it, not on its surface`);
      assert.ok(p[1] < level + TOLERANCE, `${name}: a lower point at ${p[1]}, above ${level}`);
    }
    // The ring at the level goes all the way round, its points close together.
    const ring = points.filter((p) => Math.abs(p[1] - level) < TOLERANCE);
    const gaps = ring.map((p, k) => length(sub(ring[(k + 1) % ring.length], p)));
    assert.ok(ring.length >= 6, `${name}: a ring of ${ring.length} points`);
    assert.ok(Math.max(...gaps) < settings.lower.spacing + TOLERANCE, `${name}: ring points ${Math.max(...gaps)} apart`);
  }
});

test('the shapes vary: blocks and columns of five or six sides, no two alike', () => {
  for (const [seed, shapes] of bySeed) {
    assert.equal(shapes.filter((s) => s.kind === 'block').length, settings.blocks.count);
    assert.equal(shapes.filter((s) => s.kind === 'column').length, settings.columns.count);
    for (const [i, shape] of shapes.entries()) {
      if (shape.kind !== 'column') continue;
      // A column lies along x: its sides are the facets whose normals stand square to it.
      const normals = Array.from({ length: shape.normals.length / 3 }, (_, k) => at(shape.normals, k));
      const sides = new Set(normals.filter((n) => Math.abs(n[0]) < 1e-6).map((n) => n.join())).size;
      assert.ok(sides === 5 || sides === 6, `seed ${seed}, column ${i}: ${sides} sides`);
    }
    const looks = shapes.map((s) => Array.from(s.positions, (x) => x.toFixed(3)).join());
    assert.equal(new Set(looks).size, shapes.length, `seed ${seed}: two shapes alike`);
    const heights = shapes.map((s) => s.height);
    assert.ok(Math.max(...heights) > 1.3 * Math.min(...heights), `seed ${seed}: all of a height`);
  }
});

test('chips cut every shape, and leave the rest of it as it was', () => {
  const smooth = { ...settings, chips: { ...settings.chips, count: [0, 0] } };
  for (const seed of SEEDS) {
    const plain = make(seed, smooth);
    bySeed.get(seed).forEach((shape, i) => {
      const [chipped, whole] = [facets(shape), facets(plain[i])];
      assert.ok(chipped.size > whole.size, `seed ${seed}, ${shape.kind} ${i}: ${chipped.size} facets chipped, ${whole.size} without`);
      // Chips only nibble: every large face of the unchipped shape is still there.
      for (const { area, stored } of triangles(plain[i])) {
        if (area > 0.2) assert.ok(chipped.has(stored[0].join()), `seed ${seed}, ${shape.kind} ${i}: a chip took a whole face`);
      }
    });
  }
});
