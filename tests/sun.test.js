import test from 'node:test';
import assert from 'node:assert/strict';
import { clock, createSunPath, defineTimeOfDay, sunPath } from '../src/sky/sun.js';
import { config } from '../src/config.js';

const DEG = Math.PI / 180;
const close = (a, b, eps = 1e-9) => Math.abs(a - b) <= eps;

// The game's path, plus art-directed alternatives across the tropics and the
// seasons, so the invariants don't hold by luck of one configuration.
const PATHS = [
  ['game', sunPath, config.sky.sun],
  ...[-30, -27, -15, 0, 12, 25].flatMap((latitude) =>
    [-23, 0, 10, 23].map((declination) => {
      const sun = { latitude, declination, sunsetYaw: (latitude * 7 + declination * 3) % 360 };
      return [`latitude ${latitude}, declination ${declination}`, createSunPath(sun, config.sky.goldenHourElevation), sun];
    }),
  ),
];

for (const [name, path, sun] of PATHS) {
  test(`${name}: daylight starts and ends with the sun's centre on the horizon`, () => {
    const { start, end } = path.daylight;
    assert.ok(start < 12 && end > 12 && close(start + end, 24));
    assert.ok(close(path.position(start).elevation, 0) && close(path.position(end).elevation, 0));
    for (let i = 1; i < 100; i++) assert.ok(path.position(start + ((end - start) * i) / 100).elevation > 0, 'the sun is up all day');
    assert.ok(path.position(start - 0.1).elevation < 0 && path.position(end + 0.1).elevation < 0, 'and down outside it');
  });

  test(`${name}: the named times are in order and mean what they say`, () => {
    const { sunrise, midday, sunset } = path.times;
    const golden = path.times['golden-hour'];
    assert.ok(sunrise < midday && midday < golden && golden < sunset);
    assert.equal(sunrise, path.daylight.start);
    assert.equal(sunset, path.daylight.end);
    assert.ok(close(path.position(golden).elevation, config.sky.goldenHourElevation * DEG));
    const noon = path.position(midday).elevation;
    assert.ok(close(noon, (90 - Math.abs(sun.latitude - sun.declination)) * DEG), 'noon elevation');
    for (const h of [11.9, 12.1, 9, 15]) assert.ok(path.position(h).elevation < noon, 'midday is the highest');
  });

  test(`${name}: the sun sets straight ahead of the beach and rises behind it`, () => {
    const yaw = sun.sunsetYaw * DEG;
    const ahead = [-Math.sin(yaw), 0, -Math.cos(yaw)]; // the direction views.js gives that yaw
    const set = path.position(path.daylight.end).direction;
    assert.ok(close(set[0], ahead[0]) && close(set[2], ahead[2]), `sets towards ${set}, not ${ahead}`);
    const rise = path.position(path.daylight.start).direction;
    assert.ok(rise[0] * ahead[0] + rise[2] * ahead[2] < 0, 'rises behind');
  });

  test(`${name}: directions are unit vectors with y the sine of the elevation`, () => {
    for (let h = 0; h <= 24; h += 0.75) {
      const { direction, elevation } = path.position(h);
      assert.ok(close(Math.hypot(...direction), 1));
      assert.ok(close(direction[1], Math.sin(elevation)));
    }
  });
}

test('the game: the noon sun stands to the right of a viewer facing the sunset', () => {
  const yaw = config.sky.sun.sunsetYaw * DEG;
  const right = [Math.cos(yaw), 0, -Math.sin(yaw)]; // forward x up, for the forward (-sin, 0, -cos)
  const noon = sunPath.position(12).direction;
  assert.ok(noon[0] * right[0] + noon[2] * right[2] > 0.3);
});

test('times of day: names and daylight hours pass, anything else throws', () => {
  assert.equal(sunPath.toHours('sunset'), sunPath.daylight.end);
  assert.equal(sunPath.toHours(12.25), 12.25);
  assert.equal(sunPath.toHours(sunPath.daylight.start), sunPath.daylight.start);
  for (const bad of [sunPath.daylight.start - 0.01, sunPath.daylight.end + 0.01, 0, 24, NaN, 'noon', 'toString', '12', null, undefined]) {
    assert.throws(() => sunPath.toHours(bad), /must be in daylight/, String(bad));
  }
});

test('clamp keeps a time within daylight', () => {
  assert.equal(sunPath.clamp(2), sunPath.daylight.start);
  assert.equal(sunPath.clamp(23), sunPath.daylight.end);
  assert.equal(sunPath.clamp(13), 13);
});

test('defineTimeOfDay: reads hours, takes names, refuses night', () => {
  const ctx = {};
  defineTimeOfDay(ctx, 'golden-hour');
  assert.equal(ctx.timeOfDay, sunPath.times['golden-hour']);
  ctx.timeOfDay = 9.5;
  assert.equal(ctx.timeOfDay, 9.5);
  assert.throws(() => (ctx.timeOfDay = 22), /must be in daylight/);
  assert.equal(ctx.timeOfDay, 9.5, 'a refused time leaves the old one');
  assert.throws(() => defineTimeOfDay({}, 3), /must be in daylight/);
});

test('a path on which the sun never sets or never reaches golden hour is refused', () => {
  assert.throws(() => createSunPath({ latitude: -80, declination: -20, sunsetYaw: 0 }, 5), /never stands/);
  assert.throws(() => createSunPath({ latitude: 70, declination: -20, sunsetYaw: 0 }, 5), /never stands/);
});

test('step: minutes either way, stopping at the ends of daylight', () => {
  const { start, end } = sunPath.daylight;
  assert.ok(close(sunPath.step(12, 1, { minutes: 10 }), 12 + 10 / 60));
  assert.ok(close(sunPath.step(12, -1, { minutes: 30 }), 11.5));
  assert.equal(sunPath.step(end - 0.05, 1, { minutes: 10 }), end);
  assert.equal(sunPath.step(start + 0.05, -1, { minutes: 10 }), start);
});

test('step: named jumps to the nearest named time that way, and stays at the last one', () => {
  const { sunrise, midday, sunset } = sunPath.times;
  const golden = sunPath.times['golden-hour'];
  assert.equal(sunPath.step(9, 1, { minutes: 10, named: true }), midday);
  assert.equal(sunPath.step(midday, 1, { minutes: 10, named: true }), golden);
  assert.equal(sunPath.step(golden, 1, { minutes: 10, named: true }), sunset);
  assert.equal(sunPath.step(sunset, 1, { minutes: 10, named: true }), sunset);
  assert.equal(sunPath.step(midday, -1, { minutes: 10, named: true }), sunrise);
  assert.equal(sunPath.step(midday + 0.5 / 60, -1, { minutes: 10, named: true }), sunrise, 'half a minute past midday still moves on');
});

test('clock prints hours and minutes, carrying a rounded-up minute into the hour', () => {
  assert.equal(clock(17.63), '17:38');
  assert.equal(clock(6), '6:00');
  assert.equal(clock(5.9999), '6:00');
  assert.equal(clock(12.5), '12:30');
});
