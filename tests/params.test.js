import test from 'node:test';
import assert from 'node:assert/strict';
import { parseParams } from '../src/core/params.js';

test('parses every supported param', () => {
  const search = '?view=beach&time=17.5&t=12.5&seed=abc&capture=1&quality=low&fixture=shimmer&tonemap=aces&exposure=1.5&stats=1&bench=1&benchSeconds=0.5&depth=fallback';
  assert.deepEqual(parseParams(search), {
    view: 'beach',
    time: 17.5,
    t: 12.5,
    seed: 'abc',
    capture: true,
    quality: 'low',
    fixture: 'shimmer',
    tonemap: 'aces',
    exposure: 1.5,
    stats: true,
    bench: true,
    benchSeconds: 0.5,
    depth: 'fallback',
  });
});

test('missing params are null and the switches are off', () => {
  const none = { view: null, time: null, t: null, seed: null, capture: false, quality: null, fixture: null, tonemap: null, exposure: null };
  assert.deepEqual(parseParams(''), { ...none, stats: false, bench: false, benchSeconds: null, depth: null });
});

test('depth takes only the values it knows', () => {
  assert.throws(() => parseParams('?depth=log'), /depth=log must be one of: fallback/);
});

test('benchSeconds must be a sensible duration', () => {
  for (const bad of ['0', '-1', 'long', '601']) {
    assert.throws(() => parseParams(`?benchSeconds=${bad}`), /benchSeconds=.* must be a number/, `benchSeconds=${bad}`);
  }
});

test('the leading ? is optional', () => {
  assert.deepEqual(parseParams('view=overview&t=3'), parseParams('?view=overview&t=3'));
});

test('capture is on only for capture=1', () => {
  for (const value of ['0', 'true', 'yes', '']) {
    assert.equal(parseParams(`?capture=${value}`).capture, false, `capture=${value}`);
  }
  assert.equal(parseParams('?capture=1').capture, true);
});

test('text values are trimmed and blank values count as missing', () => {
  assert.equal(parseParams('?view=%20beach%20').view, 'beach');
  assert.equal(parseParams('?view=').view, null);
  assert.equal(parseParams('?quality=%20%20').quality, null);
  assert.equal(parseParams('?time=').time, null);
});

test('seed stays a string', () => {
  assert.equal(parseParams('?seed=007').seed, '007');
});

test('time accepts 0 to 24 inclusive', () => {
  assert.equal(parseParams('?time=0').time, 0);
  assert.equal(parseParams('?time=24').time, 24);
  for (const bad of ['24.01', '-0.5', 'noon', 'Infinity', 'NaN']) {
    assert.throws(() => parseParams(`?time=${bad}`), /time=.* must be a number in \[0, 24\]/, `time=${bad}`);
  }
});

test('t accepts any finite non-negative number', () => {
  assert.equal(parseParams('?t=0').t, 0);
  assert.equal(parseParams('?t=86400.25').t, 86400.25);
  for (const bad of ['-1', 'abc', 'Infinity']) {
    assert.throws(() => parseParams(`?t=${bad}`), /t=.* must be a number/, `t=${bad}`);
  }
});

test('unknown params are ignored', () => {
  assert.deepEqual(parseParams('?debug=1&foo=bar'), parseParams(''));
});
