// Scattering things by rules (world/scatter.js): footprints keep clear of each
// other, touching at most, whatever way round they run; the larger claims its
// ground first; a candidate keeps its spot whatever else is placed.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createClearance, hull, scatter } from '../src/world/scatter.js';

const square = (a, o, half) => [[a - half, o - half], [a + half, o - half], [a + half, o + half], [a - half, o + half]];

test('a footprint that overlaps one claimed is refused; touching or apart, it is claimed', () => {
  const clearance = createClearance(4);
  assert.equal(clearance.claim(square(0, 0, 1)), true);
  assert.equal(clearance.claim(square(1.5, 0.5, 1)), false, 'overlaps');
  assert.equal(clearance.claim(square(2, 0, 1)), true, 'touches along an edge');
  assert.equal(clearance.claim(square(0, 0, 0.2)), false, 'wholly inside');
  assert.equal(clearance.claim(square(0, 0, 5)), false, 'wholly round');
  // Diamonds by the square's corner: no edge of the square separates them from it, only one of theirs.
  const diamond = (a, o) => [[a - 0.5, o], [a, o - 0.5], [a + 0.5, o], [a, o + 0.5]];
  assert.equal(clearance.claim(diamond(-1.2, 1.2)), false, 'over a corner');
  assert.equal(clearance.claim(diamond(-1.4, 1.4)), true, 'apart across a corner');
  // Clockwise or anticlockwise, across the buckets it sorts them into.
  assert.equal(clearance.claim(square(30, -10, 3).reverse()), true);
  assert.equal(clearance.claim(square(25, -10, 2)), true, 'touches across buckets');
  assert.equal(clearance.claim(square(26, -7, 2.5).reverse()), false, 'overlaps across buckets');
});

test('the hull of points runs round their outside once, whatever their order', () => {
  const points = [[0, 0], [2, 0], [1, 1], [2, 2], [0, 2], [1, 0], [0.5, 1.5]];
  const outline = hull(points);
  assert.equal(outline.length, 4);
  for (const corner of [[0, 0], [2, 0], [2, 2], [0, 2]]) assert.ok(outline.some((p) => p[0] === corner[0] && p[1] === corner[1]));
  assert.deepEqual(hull(points.slice().reverse()), outline);
  // Every point lies on the inside of every edge, all one way round.
  const turn = (o, p, q) => (p[0] - o[0]) * (q[1] - o[1]) - (p[1] - o[1]) * (q[0] - o[0]);
  outline.forEach((p, k) => {
    for (const q of points) assert.ok(turn(p, outline[(k + 1) % outline.length], q) >= 0);
  });
});

// Flat, open ground everywhere: every candidate is kept by the rule.
const flat = {
  heightAtCove: () => 1,
  groundAtCove: (a, o, out) => Object.assign(out, { sand: 1, rock: 0, band: 0, reef: 0 }),
};

test('the larger of two overlapping things wins, whichever cell comes first; a candidate keeps its spot', () => {
  const rule = { seed: 5, cell: 1, chance: 1, where: { height: [0, 2] } };
  const region = { a: [0, 6], o: [0, 1] };
  // Squares of half-size 0.9: a candidate's neighbours overlap it. Sized by the cell.
  const make = (size) => (a, o) => ({ a, o, footprint: square(a, o, size(a)) });
  const growing = scatter(flat, null, rule, region, make((a) => 0.3 + 0.1 * a), createClearance());
  const shrinking = scatter(flat, null, rule, region, make((a) => 1 - 0.1 * a), createClearance());
  // Growing along a, the last cell's is largest and is kept, though its cell comes last.
  const largest = (things) => Math.max(...things.map((t) => t.a));
  assert.equal(largest(growing), Math.max(...scatter(flat, null, rule, region, (a, o) => ({ a, o, footprint: square(a, o, 0.01) }), createClearance()).map((t) => t.a)));
  assert.ok(Math.min(...shrinking.map((t) => t.a)) < 1, 'the first cell is largest, and is kept');
  // Kept or not, a candidate's spot is the same.
  const spots = new Set(scatter(flat, null, rule, region, (a, o) => ({ a, o, footprint: square(a, o, 0.01) }), createClearance()).map((t) => `${t.a},${t.o}`));
  for (const t of [...growing, ...shrinking]) assert.ok(spots.has(`${t.a},${t.o}`));
  // What's kept keeps clear of each other.
  for (const things of [growing, shrinking]) {
    const check = createClearance();
    for (const t of things) assert.equal(check.claim(t.footprint), true);
  }
});

test('things keep clear of what is already claimed, and join it', () => {
  const rule = { seed: 9, cell: 2, chance: 1, where: {} };
  const region = { a: [0, 10], o: [0, 10] };
  const clearance = createClearance();
  clearance.claim(square(5, 5, 3));
  const things = scatter(flat, null, rule, region, (a, o) => ({ a, o, footprint: square(a, o, 0.2) }), clearance);
  assert.ok(things.length > 0);
  for (const { a, o } of things) assert.ok(Math.max(Math.abs(a - 5), Math.abs(o - 5)) >= 3.2 - 1e-9, `a thing at ${a}, ${o} inside what was claimed`);
  for (const { footprint } of things) assert.equal(clearance.claim(footprint), false, 'it joined the clearance');
});

test('a rule keeps to its distance from the coast, worked out only where the rest of the ground allows', () => {
  // The coast runs along a = 4, the land on its far side.
  let asked = 0;
  const island = { evaluate: (a, o, out) => ((asked += 1), Object.assign(out, { coast: a - 4 })) };
  const rule = { seed: 3, cell: 1, chance: 1, where: { height: [0, 2], coast: [-2, 1] } };
  const things = scatter(flat, island, rule, { a: [0, 10], o: [0, 3] }, (a, o) => ({ a, o, footprint: square(a, o, 0.01) }), createClearance());
  assert.ok(things.length > 0);
  for (const { a } of things) assert.ok(a >= 2 && a <= 5, `a thing ${(a - 4).toFixed(2)} m from the coast`);
  const none = scatter(flat, island, { ...rule, where: { height: [5, 6], coast: [-2, 1] } }, { a: [0, 10], o: [0, 3] }, () => assert.fail('placed'), createClearance());
  assert.equal(none.length, 0);
  assert.equal(asked, 30, 'the coast worked out for every candidate the rest allowed, and only those');
});
