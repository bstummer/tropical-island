// The frame readout: frame time, GPU time where the browser exposes timer
// queries, and what the frame asks of the GPU (draws, triangles, passes,
// memory). F3 toggles it; ?stats=1 shows it from the start. Works in the built
// game. main.js doesn't create it in capture mode, so it never shows in captures.
import { formatReadout, summarizeFrames } from './timing.js';

export function create(ctx) {
  const { config, stats } = ctx;
  const box = document.getElementById('readout');
  const frameMs = [];
  const gpuMs = [];
  let stopGpu = null;
  let gpuAvailable = false;
  let sinceRefresh = 0;

  function show(on) {
    box.hidden = !on;
    if (on && !stopGpu) {
      stopGpu = stats.onGpuTime((ms) => gpuMs.push(ms));
      gpuAvailable = Boolean(stopGpu);
      box.textContent = 'measuring…';
    } else if (!on) {
      stopGpu?.();
      stopGpu = null;
    }
    frameMs.length = gpuMs.length = sinceRefresh = 0;
  }

  function onKeyDown(e) {
    if (e.code !== config.readout.key) return;
    e.preventDefault(); // F3 would open the browser's find bar
    show(box.hidden);
  }

  document.addEventListener('keydown', onKeyDown);
  show(ctx.params.stats);

  return {
    update() {
      if (box.hidden) return;
      const interval = ctx.clock.interval;
      if (interval > 0) frameMs.push(interval * 1000);
      sinceRefresh += interval;
      if (sinceRefresh < config.readout.refreshSeconds) return;
      const presets = config.quality.presets;
      box.textContent = formatReadout({
        frames: summarizeFrames(frameMs),
        gpu: gpuAvailable ? summarizeFrames(gpuMs) : null,
        counts: stats.lastFrame(),
        memory: stats.memory(),
        preset: Object.keys(presets).find((name) => presets[name] === ctx.quality),
        size: ctx.frame.size,
        msaa: ctx.frame.sceneTarget.samples,
      });
      frameMs.length = gpuMs.length = sinceRefresh = 0;
    },
    dispose() {
      document.removeEventListener('keydown', onKeyDown);
      show(false);
    },
  };
}
