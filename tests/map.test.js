// The map tool's pure helpers (tools/map.js).
import test from 'node:test';
import assert from 'node:assert/strict';
import { depthColour, parseArgs, withOverrides } from '../tools/map.js';

test('arguments: --set repeats, unknown options and missing values throw', () => {
  assert.deepEqual(parseArgs(['--seed', '3', '--set', 'size=3000', '--set', 'cove.headlandSide=1', '--label', 'x']), {
    seed: '3',
    label: 'x',
    set: ['size=3000', 'cove.headlandSide=1'],
  });
  assert.throws(() => parseArgs(['--views', 'beach']), /unknown option --views/);
  assert.throws(() => parseArgs(['--seed']), /--seed needs a value/);
});

test('overrides change a copy of the settings, and only settings that exist', () => {
  const settings = { size: 2000, cove: { headlandSide: -1, bay: { radius: [130, 185] } } };
  const changed = withOverrides(settings, ['size=3000', 'cove.headlandSide=1', 'cove.bay.radius=[120,200]']);
  assert.deepEqual(changed, { size: 3000, cove: { headlandSide: 1, bay: { radius: [120, 200] } } });
  assert.equal(settings.size, 2000, 'the original is left alone');
  assert.equal(settings.cove.bay.radius[0], 130);
  assert.throws(() => withOverrides(settings, ['cove.width=3']), /no setting cove.width/);
  assert.throws(() => withOverrides(settings, ['size.x=3']), /no setting size.x/);
  assert.throws(() => withOverrides(settings, ['size=big']), /must be JSON/);
  assert.throws(() => withOverrides(settings, ['size']), /path=value/);
});

test('water darkens with depth, down to the deepest colour', () => {
  const luminance = ([r, g, b]) => 0.2126 * r + 0.7152 * g + 0.0722 * b;
  let last = Infinity;
  for (const depth of [0, 0.5, 1, 2, 3, 5, 8, 15, 25, 50, 80, 200, 400]) {
    const l = luminance(depthColour(depth));
    assert.ok(l < last, `${depth} m is no darker than shallower water`);
    last = l;
  }
  assert.deepEqual(depthColour(1000), depthColour(400));
});
