// Capture mode (?capture=1), driven by tools/screenshot.js. Renders a fixed
// number of frames at a frozen time, then signals the tool through
// window.__CAPTURE_READY__ (with __CAPTURE_INFO__) or window.__CAPTURE_ERROR__.
//
// Once ready, window.__CAPTURE__ lets the tool take many frames per page load:
//   render({ t, offset, turn })  renders the view again at another time and/or
//                                with the camera nudged (see camera.js). Every call
//                                starts from the view, so a frame never depends on
//                                the calls before it.
//   image()                      the canvas as a PNG data URL. Faster than a page
//                                screenshot, and exactly the rendered pixels.
//   stats()                      the last frame's GPU counts and live memory (gl-stats.js)
//   gpuTime(frames)              median GPU milliseconds per frame, or null without timer queries
//   overdraw()                   fragments shaded per pixel (overdraw.js), base64, one byte each
import { applyView } from './camera.js';
import { createGpuTimer } from './gl-stats.js';
import { measureOverdraw } from './overdraw.js';

export async function runCapture(ctx, display, systems, frame) {
  const { renderer, scene, camera, config } = ctx;
  const start = ctx.clock.elapsed;
  await Promise.all(systems.map((s) => s.ready)); // optional async setup per system
  renderer.compile(scene, camera);
  await warmUp(frame, config.capture.warmupFrames);
  const broken = (renderer.info.programs ?? []).filter((p) => p.diagnostics && !p.diagnostics.runnable);
  if (broken.length) {
    throw new Error(`Shader compile failed: ${broken.map((p) => p.name).join(', ')}`);
  }
  await nextFrame(); // let the final frame reach the screen

  const gl = renderer.getContext();
  window.__CAPTURE_INFO__ = {
    backend: display.backend(),
    view: ctx.view.name,
    timeOfDay: ctx.timeOfDay,
    t: start,
    seed: ctx.params.seed ?? config.defaults.seed,
    size: [display.size.width, display.size.height],
    pixelRatio: display.size.pixelRatio,
    drawingBuffer: [gl.drawingBufferWidth, gl.drawingBufferHeight],
    fov: camera.fov,
  };
  window.__CAPTURE__ = {
    // Back to back, without waiting for the display: the clock is frozen, so
    // pacing changes nothing, and image() reads the buffer directly.
    render({ t = start, offset, turn } = {}) {
      ctx.clock.seek(t);
      applyView(camera, ctx.view, { offset, turn });
      for (let i = 0; i < config.capture.warmupFrames; i++) frame();
    },
    image() {
      return renderer.domElement.toDataURL('image/png');
    },
    stats() {
      return { ...display.stats.frame(), ...display.stats.memory() };
    },
    async gpuTime(frames = 10) {
      const timer = createGpuTimer(gl);
      if (!timer) return null;
      for (let i = 0; i < frames; i++) {
        await nextFrame();
        timer.begin();
        frame();
        timer.end();
      }
      const times = [];
      while (timer.pending) {
        await nextFrame();
        times.push(...timer.poll());
      }
      times.sort((a, b) => a - b);
      return times.length ? times[Math.floor(times.length / 2)] : null;
    },
    overdraw() {
      const { width, height, counts } = measureOverdraw(renderer, scene, camera);
      let binary = '';
      for (let i = 0; i < counts.length; i += 0x8000) binary += String.fromCharCode(...counts.subarray(i, i + 0x8000));
      return { width, height, counts: btoa(binary) };
    },
  };
  window.__CAPTURE_READY__ = true;
}

async function warmUp(frame, count) {
  for (let i = 0; i < count; i++) {
    await nextFrame();
    frame();
  }
}

function nextFrame() {
  return new Promise((resolve) => requestAnimationFrame(resolve));
}
