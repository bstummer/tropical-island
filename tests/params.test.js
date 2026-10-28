import test from 'node:test';
import assert from 'node:assert/strict';
import { lookup, parseParams } from '../src/core/params.js';
import { sunPath } from '../src/sky/sun.js';
import { config } from '../src/config.js';

test('parses every supported param', () => {
  const search = '?view=beach&time=17.5&t=12.5&seed=abc&capture=1&quality=low&fixture=shimmer&tonemap=aces&exposure=1.5&stats=1&bench=1&benchSeconds=0.5&benchWarmupFrames=1';
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
    benchWarmupFrames: 1,
  });
});

test('missing params are null and the switches are off', () => {
  const none = { view: null, time: null, t: null, seed: null, capture: false, quality: null, fixture: null, tonemap: null, exposure: null };
  assert.deepEqual(parseParams(''), { ...none, stats: false, bench: false, benchSeconds: null, benchWarmupFrames: null });
});

test('benchSeconds must be a sensible duration', () => {
  for (const bad of ['0', '-1', 'long', '601']) {
    assert.throws(() => parseParams(`?benchSeconds=${bad}`), /benchSeconds=.* must be a number/, `benchSeconds=${bad}`);
  }
});

test('benchWarmupFrames must be a whole number of frames, at least one', () => {
  assert.equal(parseParams('?benchWarmupFrames=30').benchWarmupFrames, 30);
  for (const bad of ['0', '-1', '1.5', 'few', '1001']) {
    assert.throws(() => parseParams(`?benchWarmupFrames=${bad}`), /benchWarmupFrames=.* must be a whole number/, `benchWarmupFrames=${bad}`);
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

test('time accepts daylight hours and named times, as hours', () => {
  const { start, end } = sunPath.daylight;
  assert.equal(parseParams(`?time=${start}`).time, start);
  assert.equal(parseParams(`?time=${end}`).time, end);
  assert.equal(parseParams('?time=13.5').time, 13.5);
  for (const [name, hours] of Object.entries(sunPath.times)) assert.equal(parseParams(`?time=${name}`).time, hours, name);
});

test('time refuses night and anything that is not a time', () => {
  for (const bad of ['0', '24', '3', '22.5', '-0.5', 'noon', 'Sunset', 'Infinity', 'NaN', '1e9']) {
    assert.throws(() => parseParams(`?time=${bad}`), /time=.* must be a time of day in daylight, .*golden-hour/, `time=${bad}`);
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

test('exposure must be a sensible factor', () => {
  assert.equal(parseParams('?exposure=0.001').exposure, 0.001);
  assert.equal(parseParams('?exposure=1000').exposure, 1000);
  for (const bad of ['0', '0.0009', '-1', '1000.5', 'bright', 'Infinity', 'NaN']) {
    assert.throws(() => parseParams(`?exposure=${bad}`), /exposure=.* must be a number in \[0.001, 1000\]/, `exposure=${bad}`);
  }
});

test('a named preset, tonemap or fixture is one of the table, not what every object has', () => {
  assert.equal(lookup(config.quality.presets, 'low', 'quality', 'Presets'), config.quality.presets.low);
  assert.equal(lookup(config.post.tonemaps, 'agx', 'tonemap', 'Tonemaps'), config.post.tonemaps.agx);
  for (const name of ['constructor', 'toString', '__proto__', 'hasOwnProperty', 'ultra']) {
    assert.throws(() => lookup(config.quality.presets, name, 'quality', 'Presets'), { message: `Unknown quality "${name}". Presets: ${Object.keys(config.quality.presets).join(', ')}` }, name);
    assert.throws(() => lookup(config.post.tonemaps, name, 'tonemap', 'Tonemaps'), new RegExp(`Unknown tonemap "${name}"`), name);
  }
});
