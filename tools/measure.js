// Measurements of one captured view, taken in the page that rendered it
// through window.__CAPTURE__ (src/core/capture.js). Every image is analysed as
// the canvas rendered it, and written into the view's folder:
//
//   banding.png          contrast-boosted copy: bands show as contour lines, dither as fine noise
//   crop-<name>.png      zoomed regions (views.js `crops`, else the centre)
//   shimmer.png          where the image shimmers under a sub-pixel pan, in magenta
//   motion.png           frames at t, t + step, ... left to right, top to bottom, at half size
//   motion-map.png       where anything changed over those frames, in magenta
//   overdraw.png         fragments shaded per pixel: black 0, blue 1, teal 2, green 3,
//                        yellow 4, orange 5, red 6, magenta 7-9, pink 10-15, white 16+
//
// Settings live in config.capture; the analysis is in tools/image.js.
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { config } from '../src/config.js';
import { decodePng, encodePng } from './png.js';
import { bandingView, crop, heatImage, motion, overdrawImage, overdrawStats, panShift, shimmer, shrink, tile, zoom } from './image.js';

const MB = 1024 * 1024;

const settings = config.capture;

// Renders a frame ({ t, turn }) in the capture page; returns the canvas as a PNG data URL.
export function renderFrame(page, options = {}) {
  return page.evaluate((o) => {
    window.__CAPTURE__.render(o);
    return window.__CAPTURE__.image();
  }, options);
}

// Renders one frame per option set in a single call and resolves to their data
// URLs. The page renders while Node gets on with other work.
export function renderFrames(page, list) {
  return page.evaluate(
    (all) =>
      all.map((o) => {
        window.__CAPTURE__.render(o);
        return window.__CAPTURE__.image();
      }),
    list,
  );
}

export function decodeDataUrl(url) {
  return decodePng(Buffer.from(url.slice(url.indexOf(',') + 1), 'base64'));
}

// Everything for one view. `first` is the start frame's data URL; the files go to `dir`.
// GPU time is measured only with `gpuTime` (real hardware: SwiftShader's would mean nothing).
// Returns { measurements, files, lastFrame } where lastFrame is the data URL of the
// last motion frame, for the seek check.
export async function measureView(page, { info, crops, first, dir, gpuTime }) {
  mkdirSync(dir, { recursive: true });
  const start = decodeDataUrl(first);
  const files = {};
  const save = (name, image) => {
    writeFileSync(join(dir, name), encodePng(image));
    files[name.replace(/\.png$/, '')] = name;
  };

  const { cost, overdraw } = await measureCost(page, { gpuTime });

  // The page renders the motion frames while the rest is analysed here.
  const pan = panShift(start.width, start.height, info.fov, settings.shimmer.stepPixels);
  const panUrls = await renderFrames(page, panTurns(pan));
  const times = Array.from({ length: settings.motion.frames }, (_, k) => info.t + k * settings.motion.stepSeconds);
  const motionUrls = renderFrames(page, times.slice(1).map((t) => ({ t })));

  const panned = shimmer([start, ...panUrls.map(decodeDataUrl)], { shift: pan, ...settings.shimmer });
  save('shimmer.png', heatImage(start, panned.heat, settings.shimmer.threshold));
  save('overdraw.png', overdrawImage(overdraw));
  save('banding.png', bandingView(start, settings.banding));
  for (const [name, [x, y]] of Object.entries(crops ?? { centre: [0.5, 0.5] })) {
    const { width, height, zoom: factor } = settings.crop;
    save(`crop-${name}.png`, zoom(crop(start, x * start.width - width / 2, y * start.height - height / 2, width, height), factor));
  }

  const urls = await motionUrls;
  const frames = [start, ...urls.map(decodeDataUrl)];
  save('motion.png', tile(frames.map((f) => shrink(f, 2)), { columns: 3, gap: 8 }));
  const moved = motion(frames, settings.motion);
  save('motion-map.png', heatImage(start, moved.heat, settings.motion.threshold));

  return {
    measurements: { shimmerPercent: panned.percent, motionPercent: moved.percent, motionTimes: times, ...cost },
    files,
    lastFrame: urls.at(-1),
  };
}

// Render options for the shimmer pan: turns of 1, 2, ... steps.
function panTurns(pan) {
  return Array.from({ length: settings.shimmer.frames - 1 }, (_, k) => ({ turn: pan.turn.map((a) => a * (k + 1)) }));
}

// Cost of the start frame, so call it while the page still shows that frame:
// the GPU counts of the last frame rendered, live memory, GPU time (when asked)
// and mean overdraw as `cost`, plus the fragments per pixel as `overdraw`
// ({ width, height, counts }). Overdraw goes last: it compiles programs of its own.
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
    programs: stats.programs,
    programsUsed: stats.programsUsed,
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

// Pans the camera by sub-pixel steps from the start frame and scores the shimmer.
export async function measureShimmer(page, info, start) {
  const pan = panShift(start.width, start.height, info.fov, settings.shimmer.stepPixels);
  const urls = await renderFrames(page, panTurns(pan));
  return shimmer([start, ...urls.map(decodeDataUrl)], { shift: pan, ...settings.shimmer });
}
