// The benchmark (?bench=1): visits every view in views.js, lets each settle for
// config.bench.warmupSeconds and warmupFrames (?benchWarmupFrames overrides it),
// then measures for config.bench.seconds (?benchSeconds overrides it): frame
// times, GPU times where the browser exposes timer queries, and the frame's GPU
// counts. It ends with a summary to paste into a session, naming the GPU,
// browser, resolution and preset. That is how numbers from real machines reach
// the AI. window.__BENCH__ holds the result for tools/screenshot.js. Runs
// instead of input: nothing to steer. It starts once `ready` (the world's, with
// its shaders compiled) resolves, so it measures the whole world: the terrain's
// grids take a moment to build.
import { views } from '../views.js';
import { applyView } from './camera.js';
import { formatBenchmark } from './timing.js';

export function create(ctx, ready) {
  const { config, params, camera, stats, gpu, canvas } = ctx;
  const panel = document.getElementById('bench');
  const text = panel.querySelector('pre');
  const copy = panel.querySelector('button');
  const seconds = params.benchSeconds ?? config.bench.seconds;
  const warmupSeconds = Math.min(config.bench.warmupSeconds, seconds);
  const warmupFrames = params.benchWarmupFrames ?? config.bench.warmupFrames;
  const results = [];
  let index = -1;
  let measuring = false;
  let elapsed = 0;
  let frames = 0;
  let current = null;
  let started = false;

  const stopGpu = stats.onGpuTime((ms) => measuring && current.gpuMs.push(ms));
  panel.hidden = false;
  text.textContent = 'Benchmark: waiting for the world…';
  // A world that fails to build stops the game and says so itself.
  ready.then(() => {
    started = true;
    next();
  }, () => {});

  function next() {
    index++;
    if (index === views.length) return finish();
    const view = views[index];
    applyView(camera, view);
    camera.fov = view.fov ?? config.camera.fov;
    camera.updateProjectionMatrix();
    ctx.timeOfDay = params.time ?? view.timeOfDay ?? config.defaults.timeOfDay;
    current = { view: view.name, frameMs: [], gpuMs: [], counts: null };
    measuring = false;
    elapsed = frames = 0;
    text.textContent = `Benchmark: ${view.name} (${index + 1} of ${views.length})…`;
  }

  function finish() {
    stopGpu?.();
    const presets = config.quality.presets;
    const summary = formatBenchmark({
      build: __BUILD__,
      gpu: gpu.describe(),
      browser: navigator.userAgent,
      screen: { width: window.innerWidth, height: window.innerHeight, pixelRatio: window.devicePixelRatio, buffer: [canvas.width, canvas.height] },
      preset: Object.keys(presets).find((name) => presets[name] === ctx.quality),
      quality: ctx.quality,
      msaa: ctx.frame.sceneTarget.samples,
      tonemap: ctx.frame.tonemap,
      warmupSeconds,
      seconds,
      results,
    });
    text.textContent = summary;
    copy.hidden = false;
    console.log(summary);
    window.__BENCH__ = { done: true, summary, results };
  }

  function onCopy() {
    const failed = () => (copy.textContent = 'Copy failed: select the text instead');
    if (!navigator.clipboard) return failed();
    navigator.clipboard.writeText(text.textContent).then(() => (copy.textContent = 'Copied'), failed);
  }
  copy.addEventListener('click', onCopy);

  return {
    update() {
      if (!started || index === views.length) return;
      const interval = ctx.clock.interval;
      elapsed += interval;
      frames++;
      if (!measuring) {
        // Frames from the previous view and shader compiles land here, unmeasured.
        if (elapsed >= warmupSeconds && frames >= warmupFrames) {
          measuring = true;
          elapsed = 0;
        }
        return;
      }
      if (interval > 0) current.frameMs.push(interval * 1000);
      if (elapsed < seconds) return;
      current.counts = stats.lastFrame();
      current.camera = camera.position.toArray(); // where it measured, which tools/screenshot.js checks
      results.push(current);
      next();
    },
    dispose() {
      stopGpu?.();
      copy.removeEventListener('click', onCopy);
      panel.hidden = true;
    },
  };
}
