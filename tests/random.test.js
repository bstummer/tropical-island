import test from 'node:test';
import assert from 'node:assert/strict';
import { createRandom } from '../src/core/random.js';

const take = (stream, n) => Array.from({ length: n }, () => stream.next());

test('the same seed and name give the same sequence', () => {
  assert.deepEqual(take(createRandom(42)('palms'), 200), take(createRandom(42)('palms'), 200));
});

test('different seeds give different sequences', () => {
  assert.notDeepEqual(take(createRandom(1)('palms'), 20), take(createRandom(2)('palms'), 20));
});

test('numeric and string seeds are equivalent', () => {
  assert.deepEqual(take(createRandom(7)('x'), 20), take(createRandom('7')('x'), 20));
});

test('differently named streams are different', () => {
  const rng = createRandom(1);
  assert.notDeepEqual(take(rng('palms'), 20), take(rng('grass'), 20));
});

test('consuming one stream never shifts another', () => {
  const fresh = take(createRandom(1)('palms'), 50);

  const rng = createRandom(1);
  const grass = rng('grass');
  take(grass, 10_000);
  const palms = rng('palms');
  take(rng('rocks'), 777); // a new system added later
  assert.deepEqual(take(palms, 50), fresh);
});

test('interleaved draws match isolated draws', () => {
  const rng = createRandom('interleave');
  const a = rng('a');
  const b = rng('b');
  const mixed = { a: [], b: [] };
  for (let i = 0; i < 100; i++) {
    mixed.a.push(a.next());
    if (i % 3 === 0) mixed.b.push(b.next());
  }
  assert.deepEqual(mixed.a, take(createRandom('interleave')('a'), 100));
  assert.deepEqual(mixed.b, take(createRandom('interleave')('b'), mixed.b.length));
});

test('rng(name) restarts the same sequence on every call', () => {
  const rng = createRandom(3);
  const first = rng('palms');
  take(first, 5);
  assert.deepEqual(take(rng('palms'), 10), take(createRandom(3)('palms'), 10));
});

test('seed and name do not bleed into each other', () => {
  assert.notDeepEqual(take(createRandom('ab')('c'), 20), take(createRandom('a')('bc'), 20));
});

test('a stream name is required', () => {
  assert.throws(() => createRandom(1)(''), /name is required/);
  assert.throws(() => createRandom(1)(), /name is required/);
});

test('next() is uniform in [0, 1)', () => {
  const values = take(createRandom(5)('uniform'), 20_000);
  assert.ok(values.every((v) => v >= 0 && v < 1));
  const mean = values.reduce((s, v) => s + v, 0) / values.length;
  assert.ok(Math.abs(mean - 0.5) < 0.01, `mean ${mean}`);
  const buckets = new Array(10).fill(0);
  for (const v of values) buckets[Math.floor(v * 10)]++;
  for (const count of buckets) assert.ok(Math.abs(count - 2000) < 200, `bucket ${count}`);
});

test('helpers stay in range', () => {
  const r = createRandom(9)('helpers');
  const ints = new Set();
  for (let i = 0; i < 2000; i++) {
    const x = r.range(-3, 5);
    assert.ok(x >= -3 && x < 5);
    const n = r.int(2, 4);
    assert.ok(Number.isInteger(n) && n >= 2 && n <= 4);
    ints.add(n);
    assert.equal(typeof r.chance(0.5), 'boolean');
  }
  assert.deepEqual([...ints].sort(), [2, 3, 4], 'int() is inclusive at both ends');
  assert.equal(r.chance(0), false);
  assert.equal(r.chance(1), true);
  const list = ['a', 'b', 'c'];
  for (let i = 0; i < 100; i++) assert.ok(list.includes(r.pick(list)));
});

test('normal() has the requested mean and spread', () => {
  const r = createRandom(11)('normal');
  const values = Array.from({ length: 20_000 }, () => r.normal(10, 2));
  assert.ok(values.every(Number.isFinite));
  const mean = values.reduce((s, v) => s + v, 0) / values.length;
  const sd = Math.sqrt(values.reduce((s, v) => s + (v - mean) ** 2, 0) / values.length);
  assert.ok(Math.abs(mean - 10) < 0.06, `mean ${mean}`);
  assert.ok(Math.abs(sd - 2) < 0.06, `sd ${sd}`);
});
