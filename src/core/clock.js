// The only source of time in the app. Nothing else may read performance.now()
// or Date.now(): systems get dt and elapsed through update(dt, t) or ctx.clock.
//
// Normal mode advances with real time, starting at `start` seconds.
// Frozen mode (capture) pins elapsed at `start` with dt = 0 on every frame, so
// animated content renders identically on every run. `frame` still counts up,
// for temporal effects that need a per-frame index (e.g. jitter sequences).

const MAX_DT = 0.1; // seconds; avoids a huge step after a stall or a background tab

export function createClock({ frozen = false, start = 0 } = {}) {
  let elapsed = start;
  let dt = 0;
  let frame = 0;
  let last = null;

  return {
    get elapsed() {
      return elapsed;
    },
    get dt() {
      return dt;
    },
    get frame() {
      return frame;
    },
    get frozen() {
      return frozen;
    },

    // Jumps to `t` seconds; the next tick has dt = 0. Captures use it to render
    // other times in the same page, so time-driven state must follow t alone.
    seek(t) {
      elapsed = t;
      dt = 0;
      last = null;
    },

    // Call exactly once per rendered frame, before updating systems.
    tick() {
      frame++;
      if (frozen) {
        dt = 0;
        return;
      }
      const now = performance.now() / 1000;
      dt = last === null ? 0 : Math.min(now - last, MAX_DT);
      last = now;
      elapsed += dt;
    },
  };
}
