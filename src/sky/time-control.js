// , and . step the time of day back and forth by config.sky.stepMinutes (hold
// to scrub), Shift + , / . jump to the previous or next named time (sun.js
// step()). Stops at the ends of daylight. Logs the new time, which then reaches
// every system on its next update, as a time set at boot would. The keys go by
// position (KeyboardEvent.code), the same on most layouts. In every build, not
// in captures; the in-game settings of PLAN.md Stage 16 join it.
import { clock, sunPath } from './sun.js';

const KEYS = { Comma: -1, Period: 1 };

export function create(ctx) {
  const minutes = ctx.config.sky.stepMinutes;

  function onKeyDown(e) {
    const dir = KEYS[e.code];
    if (!dir) return;
    const next = sunPath.step(ctx.timeOfDay, dir, { minutes, named: e.shiftKey });
    ctx.timeOfDay = next;
    const name = Object.keys(sunPath.times).find((n) => sunPath.times[n] === next);
    console.info(`[time] ${clock(next)}${name ? ` (${name})` : ''}`);
  }

  document.addEventListener('keydown', onKeyDown);
  return {
    update() {},
    dispose() {
      document.removeEventListener('keydown', onKeyDown);
    },
  };
}
