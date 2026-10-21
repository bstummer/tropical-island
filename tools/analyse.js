// Image analysis of captured frames: decoding them, scoring them and writing
// the images (listed in measure.js). It runs in a worker thread (started by
// measure.js), so the browser renders the next frames meanwhile instead of
// waiting for Node: Playwright's own messages are handled on the main thread,
// which long synchronous work would block.
import { isMainThread, parentPort } from 'node:worker_threads';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { config } from '../src/config.js';
import { decodeDataUrl, encodePng } from './png.js';
import { bandedShare, bandingView, crop, heatImage, motion, overdrawImage, panShift, shimmer, shrink, tile, zoom } from './image.js';

const settings = config.capture;

// `first`, `pan` and `motion` are PNG data URLs: the start frame, the frames
// panned by 1, 2, ... shimmer steps, and the frames at t + step, t + 2 step, ...
// `overdraw` is { width, height, counts }. Returns { measurements, files, analyseMs }.
export function analyseView({ first, pan, motion: later, overdraw, crops, dir, fov }) {
  const started = Date.now();
  mkdirSync(dir, { recursive: true });
  const files = {};
  const save = (name, image) => {
    writeFileSync(join(dir, name), encodePng(image));
    files[name.replace(/\.png$/, '')] = name;
  };

  const start = decodeDataUrl(first);
  const shift = panShift(start.width, start.height, fov, settings.shimmer.stepPixels);
  const panned = shimmer([start, ...pan.map(decodeDataUrl)], { shift, ...settings.shimmer });
  save('shimmer.png', heatImage(start, panned.heat, settings.shimmer.threshold));
  save('overdraw.png', overdrawImage(overdraw));
  save('banding.png', bandingView(start, settings.banding));
  for (const [name, [x, y]] of Object.entries(crops ?? { centre: [0.5, 0.5] })) {
    const { width, height, zoom: factor } = settings.crop;
    save(`crop-${name}.png`, zoom(crop(start, x * start.width - width / 2, y * start.height - height / 2, width, height), factor));
  }

  const frames = [start, ...later.map(decodeDataUrl)];
  save('motion.png', tile(frames.map((f) => shrink(f, 2)), { columns: 3, gap: 8 }));
  const moved = motion(frames, settings.motion);
  save('motion-map.png', heatImage(start, moved.heat, settings.motion.threshold));

  return {
    measurements: { shimmerPercent: panned.percent, motionPercent: moved.percent, bandingPercent: bandedShare(start) },
    files,
    analyseMs: Date.now() - started,
  };
}

// The shimmer of a start frame and frames panned from it, as in analyseView,
// with the heat image written to `heatPath`. Returns { percent, edgePercent,
// heat, width, height }.
export function analyseShimmer({ first, pan, fov, heatPath }) {
  const start = decodeDataUrl(first);
  const shift = panShift(start.width, start.height, fov, settings.shimmer.stepPixels);
  const result = shimmer([start, ...pan.map(decodeDataUrl)], { shift, ...settings.shimmer });
  writeFileSync(heatPath, encodePng(heatImage(start, result.heat, settings.shimmer.threshold)));
  return { ...result, width: start.width, height: start.height };
}

const TASKS = { view: analyseView, shimmer: analyseShimmer };

if (!isMainThread) {
  parentPort.on('message', ({ id, task, job }) => {
    try {
      parentPort.postMessage({ id, result: TASKS[task](job) });
    } catch (err) {
      parentPort.postMessage({ id, error: err.stack ?? String(err) });
    }
  });
}
