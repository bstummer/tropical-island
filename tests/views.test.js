// Invariants for viewpoints and config. When island.js lands, extend the
// views test with "every view is above the terrain" (see CLAUDE.md, Testing).
import test from 'node:test';
import assert from 'node:assert/strict';
import { views, findView } from '../src/views.js';
import { config } from '../src/config.js';

const SEA_LEVEL = 0;

test('view names are unique kebab-case', () => {
  const names = views.map((v) => v.name);
  assert.equal(new Set(names).size, names.length);
  for (const name of names) assert.match(name, /^[a-z0-9]+(-[a-z0-9]+)*$/);
});

for (const view of views) {
  test(`view "${view.name}" is well-formed and above the water`, () => {
    assert.equal(view.position.length, 3);
    assert.ok(view.position.every(Number.isFinite));
    assert.ok(view.position[1] > SEA_LEVEL, `y = ${view.position[1]} is not above sea level`);
    assert.ok(Number.isFinite(view.yaw));
    assert.ok(Math.abs(view.pitch) <= config.movement.maxPitch);
    assert.ok(view.timeOfDay >= 0 && view.timeOfDay <= 24);
    if (view.fov !== undefined) assert.ok(view.fov >= 10 && view.fov <= 120);
    const extra = Object.keys(view).filter((k) => !['name', 'position', 'yaw', 'pitch', 'fov', 'timeOfDay'].includes(k));
    assert.deepEqual(extra, []);
  });
}

test('findView returns the view or throws with the known names', () => {
  assert.equal(findView('beach'), views.find((v) => v.name === 'beach'));
  assert.throws(() => findView('underwater'), /Unknown view "underwater".*beach/);
});

test('config defaults point at things that exist', () => {
  assert.doesNotThrow(() => findView(config.defaults.view));
  assert.ok(config.quality.presets[config.quality.default]);
  assert.ok(config.defaults.timeOfDay >= 0 && config.defaults.timeOfDay <= 24);
  assert.ok(Number.isInteger(config.capture.warmupFrames) && config.capture.warmupFrames >= 1);
  assert.ok(config.build.sizeBudgetBytes > 0);
});

test('quality presets are complete and sane', () => {
  for (const [name, preset] of Object.entries(config.quality.presets)) {
    assert.ok(preset.renderScale > 0 && preset.renderScale <= 1, `${name}.renderScale`);
    assert.ok(preset.maxPixelRatio >= 1, `${name}.maxPixelRatio`);
    assert.equal(typeof preset.antialias, 'boolean', `${name}.antialias`);
  }
});
