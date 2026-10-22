// Invariants for viewpoints and config. When island.js lands, extend the
// views test with "every view is above the terrain" (see CLAUDE.md, Testing).
import test from 'node:test';
import assert from 'node:assert/strict';
import { views, findView } from '../src/views.js';
import { config } from '../src/config.js';
import { sunPath } from '../src/sky/sun.js';

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
    assert.doesNotThrow(() => sunPath.toHours(view.timeOfDay), 'timeOfDay is daylight hours or a named time');
    if (view.fov !== undefined) assert.ok(view.fov >= 2 && view.fov <= 120, `fov = ${view.fov}: 2 (a long telephoto) to 120`);
    if (view.brief !== undefined) assert.ok(typeof view.brief === 'string' && view.brief.trim(), 'brief must be a non-empty line');
    for (const [name, centre] of Object.entries(view.crops ?? {})) {
      assert.match(name, /^[a-z0-9]+(-[a-z0-9]+)*$/, `crop name "${name}"`);
      assert.ok(centre.length === 2 && centre.every((c) => c >= 0 && c <= 1), `crop "${name}" centre must be [x, y] in 0–1`);
    }
    const extra = Object.keys(view).filter((k) => !['name', 'position', 'yaw', 'pitch', 'fov', 'timeOfDay', 'brief', 'crops'].includes(k));
    assert.deepEqual(extra, []);
  });
}

// The cove faces the sunset (PLAN.md, Decisions): the views out to sea from the
// beach look straight into the setting sun.
test('the beach and horizon views look into the setting sun', () => {
  const [x, , z] = sunPath.position(sunPath.times.sunset).direction;
  const sunYaw = (Math.atan2(-x, -z) * 180) / Math.PI; // yaw 0 looks towards -Z, 90 towards -X
  for (const name of ['beach', 'horizon']) {
    const off = ((((findView(name).yaw - sunYaw) % 360) + 540) % 360) - 180;
    assert.ok(Math.abs(off) < 0.5, `${name} looks ${off.toFixed(1)}° away from the setting sun`);
  }
});

test('findView returns the view or throws with the known names', () => {
  assert.equal(findView('beach'), views.find((v) => v.name === 'beach'));
  assert.throws(() => findView('underwater'), /Unknown view "underwater".*beach/);
});

test('config defaults point at things that exist', () => {
  assert.doesNotThrow(() => findView(config.defaults.view));
  assert.ok(config.quality.presets[config.quality.default]);
  assert.doesNotThrow(() => sunPath.toHours(config.defaults.timeOfDay), 'the default time of day is in daylight');
  assert.ok(Number.isInteger(config.capture.warmupFrames) && config.capture.warmupFrames >= 1);
  assert.ok(config.build.sizeBudgetBytes > 0);
  assert.ok(config.post.tonemaps[config.post.tonemap], 'the default tonemap exists');
  assert.equal(new Set(Object.values(config.post.tonemaps)).size, Object.keys(config.post.tonemaps).length, 'tonemap defines are distinct');
  assert.ok(config.post.exposure > 0);
});

test('the haze reaches past the horizon from every view', () => {
  const { groundRadius } = config.sky.atmosphere;
  for (const view of views) {
    const horizon = Math.sqrt(2 * groundRadius * (view.position[1] / 1000)); // km
    assert.ok(config.sky.aerialRange > horizon, `${view.name}: horizon ${horizon.toFixed(1)} km, aerial range ${config.sky.aerialRange} km`);
  }
});

test('the depth range covers a leaf at the lens and the horizon from a hilltop', () => {
  const { near, nearFallback, far } = config.camera;
  assert.ok(near > 0 && near <= 0.05, `near = ${near} m`);
  assert.ok(nearFallback > near && nearFallback < 1, `nearFallback = ${nearFallback} m`);
  const horizonFrom300m = Math.sqrt(2 * 6371000 * 300); // about 62 km
  assert.ok(far > horizonFrom300m, `far = ${far} m`);
});

test('quality presets are complete and sane', () => {
  for (const [name, preset] of Object.entries(config.quality.presets)) {
    assert.ok(preset.renderScale > 0 && preset.renderScale <= 1, `${name}.renderScale`);
    assert.ok(preset.maxPixelRatio >= 1, `${name}.maxPixelRatio`);
    assert.ok([2, 4, 8].includes(preset.msaa), `${name}.msaa`);
  }
});

test('every quality preset has the same cost limits, all positive', () => {
  assert.deepEqual(Object.keys(config.budget).sort(), Object.keys(config.quality.presets).sort());
  const metrics = Object.keys(config.budget.high).sort();
  for (const [name, limits] of Object.entries(config.budget)) {
    assert.deepEqual(Object.keys(limits).sort(), metrics, `${name} limits`);
    for (const [metric, limit] of Object.entries(limits)) assert.ok(limit > 0, `${name}.${metric}`);
  }
});
