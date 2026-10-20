// URL parameters. Invalid values throw, so a bad screenshot request fails loudly
// instead of silently rendering the wrong thing.
//
//   view     name from views.js
//   time     time of day in hours, 0–24
//   t        fixed simulation time in seconds
//   seed     world seed (any string)
//   capture  1 = screenshot mode
//   quality  preset name from config.quality.presets
//   fixture  a test scene from src/fixtures/ instead of the island (for tools/screenshot.js)
//   tonemap  tonemapping curve from config.post.tonemaps, to compare looks
//   exposure scene exposure, instead of config.post.exposure, to compare looks
//   stats    1 = show the frame readout from the start (F3 toggles it)
//   bench    1 = run the benchmark (core/benchmark.js) instead of the game
//   benchSeconds  seconds measured per view, instead of config.bench.seconds

export function parseParams(search) {
  const q = new URLSearchParams(search);
  return {
    view: text(q, 'view'),
    time: number(q, 'time', 0, 24),
    t: number(q, 't', 0, Infinity),
    seed: text(q, 'seed'),
    capture: q.get('capture') === '1',
    quality: text(q, 'quality'),
    fixture: text(q, 'fixture'),
    tonemap: text(q, 'tonemap'),
    exposure: number(q, 'exposure', 0.001, 1000),
    stats: q.get('stats') === '1',
    bench: q.get('bench') === '1',
    benchSeconds: number(q, 'benchSeconds', 0.05, 600),
  };
}

function text(q, key) {
  const value = q.get(key);
  return value === null || value.trim() === '' ? null : value.trim();
}

function number(q, key, min, max) {
  const raw = text(q, key);
  if (raw === null) return null;
  const value = Number(raw);
  if (!Number.isFinite(value) || value < min || value > max) {
    throw new Error(`URL param ${key}=${raw} must be a number in [${min}, ${max}]`);
  }
  return value;
}
