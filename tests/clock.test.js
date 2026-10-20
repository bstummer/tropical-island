import test from 'node:test';
import assert from 'node:assert/strict';
import { createClock } from '../src/core/clock.js';

// Replaces performance.now() with a controllable fake (milliseconds).
function fakeTime(t) {
  const time = { now: 1000, calls: 0 };
  t.mock.method(performance, 'now', () => {
    time.calls++;
    return time.now;
  });
  return time;
}

test('capture mode: elapsed stays frozen at start and dt is 0', (t) => {
  const time = fakeTime(t);
  const clock = createClock({ frozen: true, start: 12.5 });
  assert.equal(clock.frozen, true);
  assert.equal(clock.elapsed, 12.5);
  for (let i = 1; i <= 8; i++) {
    time.now += 250;
    clock.tick();
    assert.equal(clock.elapsed, 12.5);
    assert.equal(clock.dt, 0);
    assert.equal(clock.frame, i);
  }
});

test('capture mode never reads real time', (t) => {
  const time = fakeTime(t);
  const clock = createClock({ frozen: true, start: 3 });
  for (let i = 0; i < 20; i++) clock.tick();
  assert.equal(time.calls, 0);
});

test('two frozen clocks at the same start agree on every frame', () => {
  const a = createClock({ frozen: true, start: 7.25 });
  const b = createClock({ frozen: true, start: 7.25 });
  for (let i = 0; i < 10; i++) {
    a.tick();
    b.tick();
    assert.deepEqual([a.elapsed, a.dt, a.frame], [b.elapsed, b.dt, b.frame]);
  }
});

test('normal mode: first tick has dt 0, then follows real time from start', (t) => {
  const time = fakeTime(t);
  const clock = createClock({ start: 5 });
  assert.equal(clock.frozen, false);
  clock.tick();
  assert.equal(clock.dt, 0);
  assert.equal(clock.elapsed, 5);
  time.now += 16;
  clock.tick();
  assert.ok(Math.abs(clock.dt - 0.016) < 1e-9);
  time.now += 34;
  clock.tick();
  assert.ok(Math.abs(clock.elapsed - 5.05) < 1e-9);
  assert.equal(clock.frame, 3);
});

test('normal mode: a long stall is clamped to 0.1 s', (t) => {
  const time = fakeTime(t);
  const clock = createClock();
  clock.tick();
  time.now += 5000;
  clock.tick();
  assert.equal(clock.dt, 0.1);
  assert.equal(clock.elapsed, 0.1);
});

test('seek jumps a frozen clock and keeps it frozen there', (t) => {
  const time = fakeTime(t);
  const clock = createClock({ frozen: true, start: 2 });
  clock.tick();
  clock.seek(9.5);
  assert.equal(clock.elapsed, 9.5);
  for (let i = 0; i < 3; i++) clock.tick();
  assert.equal(clock.elapsed, 9.5);
  assert.equal(clock.dt, 0);
  assert.equal(clock.frame, 4);
  assert.equal(time.calls, 0);
});

test('seek in normal mode resumes real time from the new point without a jump', (t) => {
  const time = fakeTime(t);
  const clock = createClock({ start: 0 });
  clock.tick();
  time.now += 50;
  clock.tick();
  clock.seek(100);
  time.now += 3000; // e.g. a long pause before the next frame
  clock.tick();
  assert.equal(clock.dt, 0);
  assert.equal(clock.elapsed, 100);
  time.now += 20;
  clock.tick();
  assert.ok(Math.abs(clock.elapsed - 100.02) < 1e-9);
});

test('defaults: not frozen, starts at 0', () => {
  const clock = createClock();
  assert.equal(clock.frozen, false);
  assert.equal(clock.elapsed, 0);
  assert.equal(clock.frame, 0);
});
