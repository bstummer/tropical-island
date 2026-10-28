// The map tool's pure helpers (tools/map.js).
import test from 'node:test';
import assert from 'node:assert/strict';
import { dirname, join, resolve } from 'node:path';
import { depthColour, mapFile, parseArgs, withOverrides } from '../tools/map.js';

test('arguments: --set repeats, unknown options and missing values throw', () => {
  assert.deepEqual(parseArgs(['--seed', '3', '--set', 'size=3000', '--set', 'cove.headlandSide=1', '--label', 'x']), {
    seed: '3',
    label: 'x',
    set: ['size=3000', 'cove.headlandSide=1'],
  });
  assert.throws(() => parseArgs(['--views', 'beach']), /unknown option --views/);
  assert.throws(() => parseArgs(['--seed']), /--seed needs a value/);
});

test('a label names a map file of its own in screenshots/map, whatever it holds', () => {
  const out = resolve('screenshots', 'map');
  assert.equal(mapFile('seed-1', out), join(out, 'seed-1.png'));
  assert.equal(mapFile('size 3000', out), join(out, 'size-3000.png'));
  for (const label of ['../../x', '..\\..\\x', 'seed-../x', '/etc/x', 'C:\\Windows\\x', 'a/b', '..a']) {
    const file = mapFile(label, out);
    assert.equal(dirname(file), out, `${label} -> ${file}`);
  }
  for (const label of ['', '.', '..', '../..', '/', '-']) assert.throws(() => mapFile(label, out), /needs a letter or a digit/, JSON.stringify(label));
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
