// Frame-time statistics and the text of the readout and the benchmark summary.
// Pure and Node-importable (tests/timing.test.js); readout.js and benchmark.js
// put the text on screen.

// Value at fraction p (0-1) of a sorted list, by nearest rank.
export function percentile(sorted, p) {
  if (!sorted.length) return null;
  return sorted[Math.min(sorted.length - 1, Math.max(0, Math.ceil(p * sorted.length) - 1))];
}

// Milliseconds per frame -> { count, mean, median, p95, max, fps }; null for no frames.
export function summarizeFrames(ms) {
  if (!ms.length) return null;
  const sorted = [...ms].sort((a, b) => a - b);
  const mean = sorted.reduce((sum, v) => sum + v, 0) / sorted.length;
  return { count: sorted.length, mean, median: percentile(sorted, 0.5), p95: percentile(sorted, 0.95), max: sorted.at(-1), fps: 1000 / mean };
}

const fixed = (v, digits) => (v == null ? 'n/a' : v.toFixed(digits));
const count = (n) => (n >= 1e6 ? `${(n / 1e6).toFixed(2)}M` : n >= 1e3 ? `${(n / 1e3).toFixed(1)}k` : String(n));
const mb = (bytes) => `${Math.round(bytes / (1024 * 1024))} MB`;

// The readout's three lines. frames and gpu come from summarizeFrames (gpu null
// when the browser has no timer queries), counts from gl-stats lastFrame(),
// memory from gl-stats memory().
export function formatReadout({ frames, gpu, counts, memory, preset, size, msaa }) {
  return [
    `${fixed(frames?.mean, 1)} ms · ${fixed(frames?.fps, 0)} fps · GPU ${gpu ? `${fixed(gpu.mean, 2)} ms` : 'n/a'}`,
    `${counts.drawCalls} draws · ${count(counts.triangles)} tris · ${counts.passes} passes · ${memory.programs} programs`,
    `RT ${mb(memory.renderTargetBytes)} · tex ${mb(memory.textureBytes)} · ${preset} ${size.width}×${size.height} · MSAA ${msaa}`,
  ].join('\n');
}

// The benchmark summary, meant to be pasted into a session. `results` has one
// entry per view: { view, frameMs: [...], gpuMs: [...], counts } (gpuMs empty
// when the browser has no timer queries).
export function formatBenchmark({ build, gpu, browser, screen, preset, quality, msaa, reversedDepth, tonemap, warmupSeconds, seconds, results }) {
  const widths = [13, 7, 7, 7, 7, 8, 8, 7, 10, 7];
  const line = (cells) =>
    cells
      .map((cell, i) => (i ? String(cell).padStart(widths[i]) : String(cell).padEnd(widths[i])))
      .join(' ')
      .trimEnd();
  const row = (name, frameMs, gpuMs, counts) => {
    const frames = summarizeFrames(frameMs);
    const gpuTimes = summarizeFrames(gpuMs);
    return line([
      name,
      fixed(frames?.median, 1),
      fixed(frames?.p95, 1),
      fixed(frames?.max, 1),
      fixed(frames?.fps, 1),
      fixed(gpuTimes?.median, 2),
      fixed(gpuTimes?.p95, 2),
      counts ? counts.drawCalls : '',
      counts ? count(counts.triangles) : '',
      counts ? counts.passes : '',
    ]);
  };
  return [
    'Tropical Island benchmark',
    `build      ${build}`,
    `gpu        ${gpu}`,
    `browser    ${browser}`,
    `screen     ${screen.width}×${screen.height} CSS px × ${screen.pixelRatio} → drawing buffer ${screen.buffer[0]}×${screen.buffer[1]}`,
    `preset     ${preset} (render scale ${quality.renderScale}, max pixel ratio ${quality.maxPixelRatio}, MSAA ${msaa}), ` +
      `reversed depth ${reversedDepth ? 'yes' : 'no'}, tonemap ${tonemap}`,
    `measured   ${seconds} s per view after ${warmupSeconds} s to settle`,
    '',
    line(['', 'frame ms', '', '', '', 'GPU ms', '', '', '', '']),
    line(['view', 'median', 'p95', 'max', 'fps', 'median', 'p95', 'draws', 'triangles', 'passes']),
    ...results.map((r) => row(r.view, r.frameMs, r.gpuMs, r.counts)),
    row('all views', results.flatMap((r) => r.frameMs), results.flatMap((r) => r.gpuMs), null),
    '',
    'Frame times cannot drop below the display refresh interval; GPU ms shows the headroom.',
    'GPU ms n/a: the browser has no GPU timer, or no result arrived in time.',
  ].join('\n');
}
