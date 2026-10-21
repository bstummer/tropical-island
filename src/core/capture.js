// Capture mode (?capture=1), driven by tools/screenshot.js. Checks the shaders,
// renders a fixed number of frames at a frozen time, then signals the tool
// through window.__CAPTURE_READY__ (with __CAPTURE_INFO__) or window.__CAPTURE_ERROR__.
//
// Once ready, window.__CAPTURE__ lets the tool take many frames per page load:
//   render({ t, turn, time })    renders the view again at another time t, with the
//                                camera turned (see camera.js) and/or at another time
//                                of day (hours or a name, as the game's time control
//                                sets it). Every call starts from the view and its
//                                time of day, so a frame never depends on the calls
//                                before it.
//   image()                      the canvas as a PNG data URL. Faster than a page
//                                screenshot, and exactly the rendered pixels.
//   stats()                      the last frame's GPU counts and live memory (gl-stats.js)
//   gpuTime(frames)              median GPU milliseconds per frame, or null without timer queries
//   overdraw()                   fragments shaded per pixel (overdraw.js), base64, one byte each
//   rebuild(quality)             tears down the frame and the world and builds them again with
//                                another preset, as a quality change in the game would; then renders
//   resources()                  live WebGL objects by kind, memory, and objects and settings
//                                (fog, background, environment) left in the scene
//   teardown()                   tears it all down for good and returns resources()
import { applyView } from './camera.js';
import { measureOverdraw } from './overdraw.js';
import { missingSceneOutput, misplacedBlending } from '../post/scene-check.js';

// `app` is main.js's handle on the systems: { systems, setQuality(name), teardown() }.
export async function runCapture(ctx, display, app, frame) {
  const { renderer, scene, camera, config } = ctx;
  const start = ctx.clock.elapsed;
  const startTime = ctx.timeOfDay;
  await Promise.all(app.systems.map((s) => s.ready)); // optional async setup per system
  ctx.frame.compile();
  checkShaders(ctx);
  await warmUp(frame, config.capture.warmupFrames);
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
    reversedDepth: renderer.capabilities.reversedDepthBuffer,
    msaa: ctx.frame.sceneTarget.samples,
    tonemap: ctx.frame.tonemap,
  };
  window.__CAPTURE__ = {
    // Back to back, without waiting for the display: the clock is frozen, so
    // pacing changes nothing, and image() reads the buffer directly.
    render({ t = start, turn, time = startTime } = {}) {
      ctx.clock.seek(t);
      ctx.timeOfDay = time;
      applyView(camera, ctx.view, { turn });
      for (let i = 0; i < config.capture.warmupFrames; i++) frame();
    },
    image() {
      return renderer.domElement.toDataURL('image/png');
    },
    stats() {
      return { ...ctx.stats.frame(), ...ctx.stats.memory() };
    },
    async gpuTime(frames = 10) {
      const times = [];
      const stop = ctx.stats.onGpuTime((ms) => times.length < frames && times.push(ms));
      if (!stop) return null;
      // Results arrive a few frames late, and disjoint ones are dropped: render until enough came in.
      for (let i = 0; times.length < frames && i < 4 * frames; i++) {
        await nextFrame();
        frame();
      }
      stop();
      times.sort((a, b) => a - b);
      return times.length ? times[Math.floor(times.length / 2)] : null;
    },
    overdraw() {
      const { width, height, counts } = measureOverdraw(renderer, scene, camera, ctx.frame.passLayers);
      let binary = '';
      for (let i = 0; i < counts.length; i += 0x8000) binary += String.fromCharCode(...counts.subarray(i, i + 0x8000));
      return { width, height, counts: btoa(binary) };
    },
    async rebuild(quality) {
      app.setQuality(quality);
      await Promise.all(app.systems.map((s) => s.ready));
      ctx.frame.compile();
      checkShaders(ctx);
      window.__CAPTURE__.render();
    },
    resources() {
      const settings = ['fog', 'background', 'environment'].filter((key) => scene[key]);
      return { objects: ctx.stats.objects(), ...ctx.stats.memory(), sceneObjects: scene.children.length, sceneSettings: settings };
    },
    teardown() {
      app.teardown();
      return window.__CAPTURE__.resources();
    },
  };
  window.__CAPTURE_READY__ = true;
}

// Every scene material ends with sceneOutput() (CLAUDE.md §8), blends only in
// the translucent pass, and every shader program compiled. three.js checks a program only when something first
// draws with it, so a broken shader on something out of sight would pass:
// getUniforms() runs that check now, for every program compile() built.
function checkShaders({ renderer, scene, frame }) {
  const problems = [];
  const missing = missingSceneOutput(scene);
  if (missing.length) problems.push(`scene materials without sceneOutput(): ${missing.join(', ')}`);
  problems.push(...misplacedBlending(scene, frame.layers));
  const programs = renderer.info.programs ?? [];
  for (const program of programs) program.getUniforms();
  const broken = programs.filter((p) => p.diagnostics && !p.diagnostics.runnable);
  if (broken.length) problems.push(`shader compile failed: ${broken.map((p) => p.name).join(', ')}`);
  if (problems.length) throw new Error(problems.join('; '));
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
