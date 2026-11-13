// The light the ripples gather on the floor under shallow water (water/caustics.js).
import test from 'node:test';
import assert from 'node:assert/strict';
import { config } from '../src/config.js';
import { createCaustics, droppedBy } from '../src/water/caustics.js';

const settings = config.water.caustics;
const { loop } = config.water.waves;
const caustics = createCaustics(settings, [0.6, 0.8], loop, config.water.ior);

// The light over a square of floor `side` m across, `n` points a side, at time t.
function patch(depth, dropped, { side = 2.3, n = 48, x = 11.7, z = -4.3, t = 41.9 } = {}) {
  const values = [];
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) values.push(caustics.at(x + (i / n) * side, z + (j / n) * side, depth, t, dropped));
  return values;
}
const meanOf = (values) => values.reduce((s, v) => s + v, 0) / values.length;

test('the light on the floor is as bright on average as without it, at any depth and however many ripples a pixel drops', () => {
  for (const depth of [0.12, 0.3, 0.8, 1.6, 3.2]) {
    for (const dropped of [0, 2.5, 5, 8]) {
      // Elsewhere and at another time than the means were taken.
      const mean = meanOf(patch(depth, dropped, { side: 3.1, n: 40, x: 23.3, z: 7.9, t: 77.7 }));
      assert.ok(Math.abs(mean - 1) < 0.06, `${depth} m down, ${dropped} ripples dropped: the light's mean is ${mean.toFixed(3)}`);
    }
  }
});

test('in ankle-deep water the light gathers into a fine bright net; deeper it is wider and softer', () => {
  // How far apart its bright lines lie (m), crossed along rows, and how bright its brightest is.
  const look = (depth) => {
    const n = 160;
    const side = 2;
    const values = patch(depth, 0, { side, n });
    const mean = meanOf(values);
    let lines = 0;
    for (let j = 0; j < n; j++) for (let i = 1; i < n; i++) if (values[j * n + i] > 1.5 * mean && values[j * n + i - 1] <= 1.5 * mean) lines++;
    return { apart: (n * side) / Math.max(lines, 1), brightest: Math.max(...values) / mean };
  };
  const [ankle, deep] = [look(0.3), look(3)];
  assert.ok(ankle.brightest > 2.5, `ankle-deep its brightest is ${ankle.brightest.toFixed(2)} times its mean`);
  assert.ok(deep.apart > 1.4 * ankle.apart, `its net ${ankle.apart.toFixed(3)} m fine ankle-deep, ${deep.apart.toFixed(3)} m 3 m down`);
  assert.ok(deep.brightest < ankle.brightest, `its brightest ${ankle.brightest.toFixed(2)} ankle-deep, ${deep.brightest.toFixed(2)} 3 m down`);
});

test('a pixel too wide for a ripple drops it, the shortest first, and the light is even once it drops them all', () => {
  assert.equal(droppedBy(1e-4, settings), 0);
  assert.equal(droppedBy(10, settings), settings.ripples.length);
  let last = 0;
  for (let footprint = 0.001; footprint < 1; footprint *= 1.1) {
    const dropped = droppedBy(footprint, settings);
    assert.ok(dropped >= last, `a wider pixel drops ${dropped}, fewer than ${last}`);
    last = dropped;
  }
  // Each ripple goes as the pixel grows past `fade` of its length.
  settings.ripples.forEach(([length], i) => {
    const dropped = droppedBy(settings.fade * length, settings);
    assert.ok(Math.abs(dropped - i) < 0.3, `a pixel ${settings.fade} of ripple ${i}'s length drops ${dropped.toFixed(2)}`);
  });
  for (const value of patch(1, settings.ripples.length, { n: 8 })) assert.ok(Math.abs(value - 1) < 1e-3, `all dropped: ${value}`);
  // Dropping changes the net smoothly.
  const [some, more] = [patch(0.5, 3, { n: 16 }), patch(0.5, 3.02, { n: 16 })];
  some.forEach((v, i) => assert.ok(Math.abs(v - more[i]) < 0.2, `from ${v} to ${more[i]} as a pixel drops a fiftieth more of a ripple`));
});

test('the net moves with time and comes round with the waves\' loop, nothing jumping as it wraps', () => {
  const at = (t) => patch(0.4, 0, { n: 12, t });
  const [now, later, looped] = [at(30), at(30.5), at(30 + loop)];
  assert.ok(now.some((v, i) => Math.abs(v - later[i]) > 0.3), 'the net stands still');
  now.forEach((v, i) => assert.ok(Math.abs(v - looped[i]) < 1e-6, `a loop later ${looped[i]}, not ${v}`));
});
