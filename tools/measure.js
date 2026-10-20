// Measurements of one captured view, taken in the page that rendered it
// through window.__CAPTURE__ (src/core/capture.js). Every image is analysed as
// the canvas rendered it, and written into the view's folder:
//
//   banding.png          contrast-boosted copy: bands show as contour lines, dither as fine noise
//   crop-<name>.png      zoomed regions (views.js `crops`, else the centre)
//   shimmer.png          where the image shimmers under a sub-pixel pan, in magenta
//   motion.png           frames at t, t + step, ... left to right, top to bottom, at half size
//   overdraw.png         fragments shaded per pixel: black 0, blue 1, teal 2, green 3,
//                        yellow 4, orange 5, red 6, magenta 7-9, white 10+
//
// Settings live in config.capture; the analysis is in tools/image.js.
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { config } from '../src/config.js';
import { decodePng, encodePng } from './png.js';
import { bandingView, crop, heatImage, motion, overdrawImage, overdrawStats, panShift, shimmer, shrink, tile, zoom } from './image.js';

const MB = 1024 * 1024;

const settings = config.capture;

// Renders a frame ({ t, offset, turn }) in the capture page; returns the canvas as a PNG data URL.
export function renderFrame(page, options = {}) {
  return page.evaluate((o) => {
    window.__CAPTURE__.render(o);
    return window.__CAPTURE__.image();
  }, options);
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

  save('banding.png', bandingView(start, settings.banding));
  for (const [name, [x, y]] of Object.entries(crops ?? { centre: [0.5, 0.5] })) {
    const { width, height, zoom: factor } = settings.crop;
    save(`crop-${name}.png`, zoom(crop(start, x * start.width - width / 2, y * start.height - height / 2, width, height), factor));
  }

  const panned = await measureShimmer(page, info, start);
  save('shimmer.png', heatImage(start, panned.heat, settings.shimmer.threshold));

  const urls = [first];
  for (let k = 1; k < settings.motion.frames; k++) urls.push(await renderFrame(page, { t: info.t + k * settings.motion.stepSeconds }));
  const frames = [start, ...urls.slice(1).map(decodeDataUrl)];
  save('motion.png', tile(frames.map((f) => shrink(f, 2)), { columns: 3, gap: 8 }));

  const { cost, overdraw } = await measureCost(page, { gpuTime });
  save('overdraw.png', overdrawImage(overdraw));

  return {
    measurements: {
      shimmerPercent: panned.percent,
      motionPercent: motion(frames, settings.motion),
      motionTimes: frames.map((_, k) => info.t + k * settings.motion.stepSeconds),
      ...cost,
    },
    files,
    lastFrame: urls.at(-1),
  };
}

// Cost of the start frame: the GPU counts, live memory, GPU time (when asked) and
// mean overdraw as `cost`, plus the fragments per pixel as `overdraw`
// ({ width, height, counts }). Overdraw goes last: it compiles programs of its own.
export async function measureCost(page, { gpuTime = false } = {}) {
  const stats = await page.evaluate(() => {
    window.__CAPTURE__.render();
    return window.__CAPTURE__.stats();
  });
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
  const { frames, stepPixels } = settings.shimmer;
  const pan = panShift(start.width, start.height, info.fov, stepPixels);
  const panned = [start];
  for (let k = 1; k < frames; k++) {
    panned.push(decodeDataUrl(await renderFrame(page, { turn: pan.turn.map((a) => a * k) })));
  }
  return shimmer(panned, { shift: pan, ...settings.shimmer });
}
