// Measurements of one captured view, taken in the page that rendered it
// through window.__CAPTURE__ (src/core/capture.js). Every image is analysed as
// the canvas rendered it, and written into the view's folder:
//
//   banding.png          contrast-boosted copy: bands show as contour lines, dither as fine noise
//   crop-<name>.png      zoomed regions (views.js `crops`, else the centre)
//   shimmer.png          where the image shimmers under a sub-pixel pan, in magenta
//   shimmer-move.png     where it shimmers as the camera moves a walking step at a time
//   motion.png           frames at t, t + step, ... left to right, top to bottom, at half size
//   motion-map.png       where anything changed over those frames, in magenta
//   overdraw.png         fragments shaded per pixel: black 0, blue 1, teal 2, green 3,
//                        yellow 4, orange 5, red 6, magenta 7-9, pink 10-15, white 16+
//
// The page renders the frames; a worker thread (tools/analyse.js) decodes and
// scores them while the browser goes on rendering. Settings live in
// config.capture; the analysis is in tools/image.js.
import { Worker } from 'node:worker_threads';
import { config } from '../src/config.js';
import { overdrawStats, panShift } from './image.js';

const MB = 1024 * 1024;

const settings = config.capture;

// Renders a frame ({ t, turn }) in the capture page; returns the canvas as a PNG data URL.
export function renderFrame(page, options = {}) {
  return page.evaluate(async (o) => {
    await window.__CAPTURE__.render(o);
    return window.__CAPTURE__.image();
  }, options);
}

// Renders one frame per option set in a single call and resolves to their data URLs.
export function renderFrames(page, list) {
  return page.evaluate(async (all) => {
    const urls = [];
    for (const o of all) {
      await window.__CAPTURE__.render(o);
      urls.push(await window.__CAPTURE__.image());
    }
    return urls;
  }, list);
}

// Everything the page renders for one view. `first` is the start frame's data
// URL; the images go to `dir`. GPU time is measured only with `gpuTime` (real
// hardware: SwiftShader's would mean nothing). Resolves once the page has
// rendered everything, without waiting for the analysis, to
//   cost         the start frame's cost (see measureCost)
//   motionTimes  the t of each motion frame
//   frameMs      the page's time per extra frame, readback included
//   lastFrame    the last motion frame's data URL, for the seek check
//   analysis     a promise of { measurements, files, analyseMs } from tools/analyse.js
export async function measureView(page, { info, crops, first, dir, gpuTime }) {
  const { cost, overdraw } = await measureCost(page, { gpuTime });
  const [width, height] = info.drawingBuffer;
  const turns = panTurns(panShift(width, height, info.fov, settings.shimmer.stepPixels));
  const motionTimes = Array.from({ length: settings.motion.frames }, (_, k) => info.t + k * settings.motion.stepSeconds);
  const started = Date.now();
  const urls = await renderFrames(page, [...turns, ...motionTimes.slice(1).map((t) => ({ t }))]);
  const frameMs = (Date.now() - started) / urls.length;
  const moved = await renderMoves(page);
  const analysis = analyse('view', { first, pan: urls.slice(0, turns.length), motion: urls.slice(turns.length), moved, overdraw, crops, dir, fov: info.fov });
  return { cost, motionTimes, frameMs, lastFrame: urls.at(-1), analysis };
}

// Render options for the shimmer pan: turns of 1, 2, ... steps.
function panTurns(pan) {
  return Array.from({ length: settings.shimmer.frames - 1 }, (_, k) => ({ turn: pan.turn.map((a) => a * (k + 1)) }));
}

// Frames with the camera moved 0, 1, 2, ... steps to its right (config.capture.move),
// each with its depth: { images, depths, step } (data URLs, base64 distances).
function renderMoves(page) {
  const { frames, stepMetres } = settings.move;
  return page.evaluate(
    async ({ frames, step }) => {
      const [images, depths] = [[], []];
      for (let k = 0; k < frames; k++) {
        await window.__CAPTURE__.render({ move: [k * step, 0, 0], depth: true });
        images.push(await window.__CAPTURE__.image());
        depths.push(await window.__CAPTURE__.depth());
      }
      return { images, depths, step };
    },
    { frames, step: stepMetres },
  );
}

// Moves the camera a step at a time and scores the shimmer (see analyseMove in
// tools/analyse.js), writing where it shimmers to `heatPath`.
export async function measureMove(page, info, heatPath) {
  return analyse('move', { moved: await renderMoves(page), fov: info.fov, heatPath });
}

// Cost of the start frame, so call it while the page still shows that frame:
// the GPU counts of the last frame rendered, live memory, GPU time (when asked)
// and mean overdraw as `cost`, plus the fragments per pixel as `overdraw`
// ({ width, height, counts }). Overdraw goes last: it makes pipelines of its own.
export async function measureCost(page, { gpuTime = false } = {}) {
  const stats = await page.evaluate(() => window.__CAPTURE__.stats());
  const gpuMs = gpuTime ? await page.evaluate(() => window.__CAPTURE__.gpuTime(10)) : null;
  const field = await page.evaluate(() => window.__CAPTURE__.overdraw());
  const overdraw = { width: field.width, height: field.height, counts: new Uint8Array(Buffer.from(field.counts, 'base64')) };
  const { mean, max } = overdrawStats(overdraw);
  const cost = {
    drawCalls: stats.drawCalls,
    triangles: stats.triangles,
    passes: stats.passes,
    blits: stats.blits,
    pipelines: stats.pipelines,
    pipelinesUsed: stats.pipelinesUsed,
    overdraw: mean,
    overdrawMax: max,
    textureMB: stats.textureBytes / MB,
    renderTargetMB: stats.renderTargetBytes / MB,
    canvasMB: stats.canvasBytes / MB,
    bufferMB: stats.bufferBytes / MB,
    gpuMs,
  };
  return { cost, overdraw };
}

// Pans the camera by sub-pixel steps from the frame on the canvas and scores
// the shimmer (see analyseShimmer in tools/analyse.js), writing where it shimmers to `heatPath`.
export async function measureShimmer(page, info, heatPath) {
  const first = await page.evaluate(() => window.__CAPTURE__.image());
  const [width, height] = info.drawingBuffer;
  const pan = await renderFrames(page, panTurns(panShift(width, height, info.fov, settings.shimmer.stepPixels)));
  return analyse('shimmer', { first, pan, fov: info.fov, heatPath });
}

// ---------------------------------------------------------------- the worker

let worker = null;
let nextJob = 0;
const jobs = new Map();

// Runs a task of tools/analyse.js ('view', 'shimmer' or 'move') in the worker thread, started on first use.
function analyse(task, job) {
  if (!worker) {
    worker = new Worker(new URL('./analyse.js', import.meta.url));
    worker.on('message', ({ id, result, error }) => {
      const { resolve, reject } = jobs.get(id);
      jobs.delete(id);
      if (error) reject(new Error(error));
      else resolve(result);
    });
    worker.on('error', (err) => {
      for (const { reject } of jobs.values()) reject(err);
      jobs.clear();
      worker = null;
    });
  }
  const id = nextJob++;
  const result = new Promise((resolve, reject) => {
    jobs.set(id, { resolve, reject });
    worker.postMessage({ id, task, job });
  });
  // A view's analysis is awaited only once the views before it are reported: a
  // failure before that, unhandled meanwhile, would end the process.
  result.catch(() => {});
  return result;
}

// Ends the worker, so the process can exit. Call it once every analysis has settled.
export async function stopAnalysis() {
  await worker?.terminate();
  worker = null;
}
