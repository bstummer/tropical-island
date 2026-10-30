// Invariants for viewpoints and config.
import test from 'node:test';
import assert from 'node:assert/strict';
import { views, findView } from '../src/views.js';
import { config } from '../src/config.js';
import { sunPath } from '../src/sky/sun.js';
import { createRandom } from '../src/core/random.js';
import { createIsland } from '../src/world/island.js';

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
    assert.ok(typeof view.brief === 'string' && view.brief.trim() && !view.brief.includes('\n'), 'every view needs a brief: one line on what the shot is for');
    for (const [name, centre] of Object.entries(view.crops ?? {})) {
      assert.match(name, /^[a-z0-9]+(-[a-z0-9]+)*$/, `crop name "${name}"`);
      assert.ok(centre.length === 2 && centre.every((c) => c >= 0 && c <= 1), `crop "${name}" centre must be [x, y] in 0–1`);
    }
    const extra = Object.keys(view).filter((k) => !['name', 'position', 'yaw', 'pitch', 'fov', 'timeOfDay', 'brief', 'crops'].includes(k));
    assert.deepEqual(extra, []);
  });
}

// The cove faces the sunset (PLAN.md, Decisions): the views out to sea from the
// beach look straight at where the sun meets the sea.
test('the beach and horizon views look into the setting sun', () => {
  const [x, , z] = sunPath.position(sunPath.daylight.end).direction;
  const sunYaw = (Math.atan2(-x, -z) * 180) / Math.PI; // yaw 0 looks towards -Z, 90 towards -X
  for (const name of ['beach', 'horizon']) {
    const off = ((((findView(name).yaw - sunYaw) % 360) + 540) % 360) - 180;
    assert.ok(Math.abs(off) < 0.5, `${name} looks ${off.toFixed(1)}° away from the setting sun`);
  }
});

// The views that look into the sun have it in frame at their time: inside the
// circle the frame's height spans, so at any window shape.
test('the horizon and into-the-sun views have the sun in frame', () => {
  const DEG = Math.PI / 180;
  for (const name of ['horizon', 'into-the-sun']) {
    const view = findView(name);
    const [x, y, z] = sunPath.position(sunPath.toHours(view.timeOfDay)).direction;
    const yaw = view.yaw * DEG;
    const pitch = view.pitch * DEG;
    const ahead = [-Math.sin(yaw) * Math.cos(pitch), Math.sin(pitch), -Math.cos(yaw) * Math.cos(pitch)];
    const off = Math.acos(Math.min(1, x * ahead[0] + y * ahead[1] + z * ahead[2])) / DEG;
    const half = (view.fov ?? config.camera.fov) / 2;
    assert.ok(off < half, `${name}: the sun is ${off.toFixed(1)}° off the view's centre, the frame's height spans ±${half}°`);
  }
});

// The views are framed on the game's seed (PLAN.md, Decisions), so on that one.
test('every view is above the ground and the sea, with room for an eye', () => {
  const island = createIsland(createRandom(config.defaults.seed));
  for (const view of views) {
    const [x, y, z] = view.position;
    const ground = island.height(x, z);
    // Over water, a swimmer's eye will do; the waves are small where one swims.
    const least = Math.max(ground + 1, SEA_LEVEL + config.movement.walk.float);
    assert.ok(y >= least, `${view.name}: ${(y - Math.max(ground, SEA_LEVEL)).toFixed(2)} m above the ground or the sea`);
  }
});

test('findView returns the view or throws with the known names', () => {
  assert.equal(findView('beach'), views.find((v) => v.name === 'beach'));
  assert.throws(() => findView('underwater'), /Unknown view "underwater".*beach/);
});

test('a disabled view is found by name but left out of the runs over the views', () => {
  const disabled = findView('summit');
  assert.equal(disabled.disabled, true);
  assert.ok(!views.includes(disabled));
  assert.ok(views.length > 0 && views.every((v) => !v.disabled));
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

test('the haze reaches as far as every view sees: past the horizon, or the farthest ground in its frame', () => {
  const R = config.sky.atmosphere.groundRadius; // km
  const ASPECT = 21 / 9; // as wide as screens come
  for (const view of views) {
    const h = view.position[1] / 1000; // km
    const p = (view.pitch * Math.PI) / 180;
    const t = Math.tan(((view.fov ?? config.camera.fov) * Math.PI) / 360);
    // The frame's top corners look highest: how far below level.
    const down = -Math.atan2(Math.sin(p) + t * Math.cos(p), Math.hypot(t * ASPECT, Math.cos(p) - t * Math.sin(p)));
    // Where a ray that far down meets the sea, on the round planet; the horizon
    // if it looks up or passes over it.
    const b = (R + h) * Math.sin(down);
    const reach = b * b - (2 * R * h + h * h);
    const farthest = b > 0 && reach >= 0 ? b - Math.sqrt(reach) : Math.sqrt(2 * R * h + h * h);
    assert.ok(config.sky.aerialRange > farthest, `${view.name}: it sees ${farthest.toFixed(1)} km, aerial range ${config.sky.aerialRange} km`);
  }
});

test('the depth range covers a leaf at the lens and the horizon from a hilltop', () => {
  const { near, far } = config.camera;
  assert.ok(near > 0 && near <= 0.05, `near = ${near} m`);
  const horizonFrom300m = Math.sqrt(2 * 6371000 * 300); // about 62 km
  assert.ok(far > horizonFrom300m, `far = ${far} m`);
});

test('quality presets are complete and sane', () => {
  // Every preset sets every knob the default does: a system reads its own, and
  // one a preset left out would read undefined (no rocks at all, for rockPixels).
  const knobs = config.quality.presets[config.quality.default];
  for (const [name, preset] of Object.entries(config.quality.presets)) {
    assert.deepEqual(Object.keys(preset).sort(), Object.keys(knobs).sort(), `${name}: its knobs`);
    for (const [knob, value] of Object.entries(preset)) assert.equal(typeof value, typeof knobs[knob], `${name}.${knob}`);
    assert.ok(preset.renderScale > 0 && preset.renderScale <= 1, `${name}.renderScale`);
    assert.ok(preset.maxPixelRatio >= 1, `${name}.maxPixelRatio`);
    assert.ok(preset.groundDetail > 0 && preset.groundDetail <= 1, `${name}.groundDetail`);
    // Mipmapped and repeating: it halves exactly down to a texel.
    assert.ok(Number.isInteger(Math.log2(preset.surfaceTexture)) && preset.surfaceTexture >= 64, `${name}.surfaceTexture`);
    // A rock drawn thinner than about two pixels would crawl (CLAUDE.md §8).
    assert.ok(preset.rockPixels >= 2, `${name}.rockPixels`);
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
