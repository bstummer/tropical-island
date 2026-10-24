// Capture mode (?capture=1), driven by tools/screenshot.js. Checks the shaders,
// renders a fixed number of frames at a frozen time, then signals the tool
// through window.__CAPTURE_READY__ (with __CAPTURE_INFO__) or window.__CAPTURE_ERROR__.
//
// Once ready, window.__CAPTURE__ lets the tool take many frames per page load
// (each returns a promise):
//   render({ t, turn, time })    renders the view again at another time t, with the
//                                camera turned (see camera.js) and/or at another time
//                                of day (hours or a name, as the game's time control
//                                sets it). Every call starts from the view and its
//                                time of day, so a frame never depends on the calls
//                                before it.
//   image()                      the output as a PNG data URL, read back from the GPU:
//                                exactly the rendered pixels.
//   stats()                      the last frame's GPU counts and live memory (gpu-stats.js)
//   gpuTime(frames)              median GPU milliseconds per frame, or null without timestamp queries
//   overdraw()                   fragments shaded per pixel (overdraw.js), base64, one byte each
//   rebuild(quality)             tears down the frame and the world and builds them again with
//                                another preset, as a quality change in the game would; then renders
//   resources()                  live GPU objects by kind, memory, and what is left in the scene
//   teardown()                   tears it all down for good and returns resources()
import { applyView } from './camera.js';
import { measureOverdraw } from './overdraw.js';
import { missingSceneOutput, misplacedBlending } from '../post/scene-check.js';
import { luminance, shIrradiance } from '../sky/light.js';

// `app` is main.js's handle on the systems: { systems, setQuality(name), teardown() }.
export async function runCapture(ctx, display, app, frame) {
  const { scene, camera, config, canvas } = ctx;
  const start = ctx.clock.elapsed;
  const startTime = ctx.timeOfDay;
  await Promise.all(app.systems.map((s) => s.ready)); // optional async setup per system
  checkShaders(ctx, await ctx.frame.compile());
  await warmUp(frame, config.capture.warmupFrames);
  await nextFrame(); // let the final frame reach the screen

  window.__CAPTURE_INFO__ = {
    backend: display.backend(),
    view: ctx.view.name,
    timeOfDay: ctx.timeOfDay,
    t: start,
    seed: ctx.params.seed ?? config.defaults.seed,
    size: [display.size.width, display.size.height],
    pixelRatio: display.size.pixelRatio,
    drawingBuffer: [canvas.width, canvas.height],
    fov: camera.fov,
    msaa: ctx.frame.sceneTarget.samples,
    tonemap: ctx.frame.tonemap,
    skyShare: skyShare(ctx.frame.uniforms),
  };
  window.__CAPTURE__ = {
    // Back to back, without waiting for the display: the clock is frozen, so
    // pacing changes nothing, and image() reads the buffer directly.
    async render({ t = start, turn, time = startTime } = {}) {
      ctx.clock.seek(t);
      ctx.timeOfDay = time;
      applyView(camera, ctx.view, { turn });
      await renderSettled(app, frame, config.capture.warmupFrames);
    },
    async image() {
      const { output } = ctx.frame;
      return pngDataUrl(await output.read(), output.width, output.height);
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
    async overdraw() {
      const { width, height, counts } = await measureOverdraw(ctx);
      let binary = '';
      for (let i = 0; i < counts.length; i += 0x8000) binary += String.fromCharCode(...counts.subarray(i, i + 0x8000));
      return { width, height, counts: btoa(binary) };
    },
    async rebuild(quality) {
      app.setQuality(quality);
      await Promise.all(app.systems.map((s) => s.ready));
      checkShaders(ctx, await ctx.frame.compile());
      await window.__CAPTURE__.render();
    },
    resources() {
      return { objects: ctx.stats.objects(), ...ctx.stats.memory(), sceneObjects: scene.children.length };
    },
    teardown() {
      app.teardown();
      return window.__CAPTURE__.resources();
    },
  };
  window.__CAPTURE_READY__ = true;
}

// Every scene material ends with sceneOutput() (CLAUDE.md §8), blends only in
// the translucent pass, and every shader and pipeline compiled: `compiled`, the
// problems frame.compile() found making them all, for meshes out of sight too.
function checkShaders({ scene, frame }, compiled) {
  const problems = [];
  const missing = missingSceneOutput(scene);
  if (missing.length) problems.push(`scene materials without sceneOutput(): ${missing.join(', ')}`);
  problems.push(...misplacedBlending(scene, frame.passes));
  if (compiled.length) problems.push(`shader compile failed: ${compiled.join('; ')}`);
  if (problems.length) throw new Error(problems.join('; '));
}

// Renders `count` frames, and again whenever a system's update started work
// that finishes later (the sky's light after a time change: `settled()`
// returns its promise until it landed), so the last frame is the one a fresh
// load at the same time and t gives.
async function renderSettled(app, frame, count) {
  const pending = () => app.systems.map((s) => s.settled?.()).filter(Boolean);
  for (let i = 0; i < count; i++) frame();
  for (let work = pending(); work.length; work = pending()) {
    await Promise.all(work);
    for (let i = 0; i < count; i++) frame();
  }
}

// RGBA bytes as a PNG data URL, through a 2D canvas: lossless, the same bytes every time.
async function pngDataUrl(rgba, width, height) {
  const canvas = new OffscreenCanvas(width, height);
  canvas.getContext('2d').putImageData(new ImageData(new Uint8ClampedArray(rgba.buffer, rgba.byteOffset, rgba.byteLength), width, height), 0, 0);
  const blob = await canvas.convertToBlob({ type: 'image/png' });
  const reader = new FileReader();
  return new Promise((resolve, reject) => {
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
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

// The sky's share of the light on level ground in the open, the rest being the
// sun's: all the light open shade gets, but for what the ground sends up.
function skyShare({ uSkySH, uLevelLight }) {
  const sky = shIrradiance(uSkySH.value.map((v) => v.toArray()), [0, 1, 0]);
  return luminance(sky) / luminance(uLevelLight.value.toArray());
}
