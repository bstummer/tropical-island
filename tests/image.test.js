import test from 'node:test';
import assert from 'node:assert/strict';
import {
  bandedShare,
  bandingView,
  brightestNear,
  createImage,
  crop,
  heatImage,
  meanColor,
  motion,
  moveShift,
  overdrawImage,
  overdrawStats,
  panShift,
  shimmer,
  shrink,
  tile,
  zoom,
} from '../tools/image.js';
import { createRandom } from '../src/core/random.js';
import { Camera, applyView } from '../src/core/camera.js';
import { Vector3 } from '../src/maths/index.js';

// An image whose grey value at each pixel is f(x, y), rounded and clamped to 8 bits.
function greyImage(width, height, f) {
  const image = createImage(width, height);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const v = Math.max(0, Math.min(255, Math.round(f(x, y))));
      image.data.set([v, v, v], 4 * (y * width + x));
    }
  }
  return image;
}

const at = (image, x, y) => [...image.data.subarray(4 * (y * image.width + x), 4 * (y * image.width + x) + 3)];

// An image whose three channels differ and vary apart, so mixing them up shows.
function colourImage(width, height) {
  const image = createImage(width, height);
  for (let i = 0; i < width * height; i++) image.data.set([(37 * i) % 256, (101 * i + 50) % 256, (173 * i + 90) % 256], 4 * i);
  return image;
}

const MAGENTA = [255, 40, 200];

// ---------------------------------------------------------------- layout

test('crop takes the region and clamps it to the image', () => {
  const image = greyImage(10, 8, (x, y) => 10 * x + y);
  const part = crop(image, 2, 3, 4, 2);
  assert.deepEqual([part.width, part.height], [4, 2]);
  assert.deepEqual(at(part, 0, 0), at(image, 2, 3));
  assert.deepEqual(at(part, 3, 1), at(image, 5, 4));
  const edge = crop(image, 8, 7, 5, 5);
  assert.deepEqual([edge.width, edge.height], [2, 1]);
});

test('crop clamps a region off any side of the image into it, at whole pixels', () => {
  const image = colourImage(10, 8);
  // Every pixel of `part` is the image's, from (x0, y0) on, and nothing reaches past it.
  const from = (part, x0, y0) => {
    assert.ok(x0 + part.width <= image.width && y0 + part.height <= image.height, `${part.width} x ${part.height} at (${x0}, ${y0})`);
    for (let y = 0; y < part.height; y++) for (let x = 0; x < part.width; x++) assert.deepEqual(at(part, x, y), at(image, x0 + x, y0 + y));
  };
  from(crop(image, -3, -2, 4, 3), 0, 0);
  from(crop(image, 2.4, 3.6, 3, 2), 2, 4);
  from(crop(image, 7, -5, 6, 2), 7, 0);
  const past = crop(image, 15, 20, 3, 3);
  assert.deepEqual([past.width, past.height], [1, 1]);
  from(past, 9, 7);
});

test('brightestNear finds the brightest spot within the radius, and not beyond it', () => {
  const image = createImage(40, 40, [10, 10, 10]);
  const paint = (x, y, c) => image.data.set(c, (y * 40 + x) * 4);
  for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) paint(12 + dx, 14 + dy, [200, 150, 100]);
  for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) paint(30 + dx, 30 + dy, [250, 250, 250]); // brighter, but too far
  assert.deepEqual(brightestNear(image, [10, 10], 6), [200, 150, 100]);
});

test('meanColor averages a region and nothing outside it', () => {
  const image = createImage(4, 2, [10, 20, 30]);
  image.data.set([50, 60, 70], (1 * 4 + 2) * 4); // (2, 1)
  assert.deepEqual(meanColor(image, 2, 0, 2, 2), [20, 30, 40]);
  assert.deepEqual(meanColor(image, 0, 0, 2, 2), [10, 20, 30]);
});

test('zoom repeats pixels and shrink averages them back', () => {
  const image = greyImage(3, 2, (x, y) => 40 * x + 100 * y);
  const big = zoom(image, 2);
  assert.deepEqual([big.width, big.height], [6, 4]);
  assert.deepEqual(at(big, 5, 3), at(image, 2, 1));
  assert.deepEqual(at(big, 4, 2), at(image, 2, 1));
  assert.deepEqual(shrink(big, 2), image);
});

test('tile lays images out in rows with gaps', () => {
  const images = [0, 1, 2].map((n) => greyImage(4, 3, () => 50 * (n + 1)));
  const sheet = tile(images, { columns: 2, gap: 1, background: [7, 7, 7] });
  assert.deepEqual([sheet.width, sheet.height], [9, 7]);
  assert.deepEqual(at(sheet, 0, 0), [50, 50, 50]);
  assert.deepEqual(at(sheet, 5, 0), [100, 100, 100]);
  assert.deepEqual(at(sheet, 0, 4), [150, 150, 150]);
  assert.deepEqual(at(sheet, 4, 0), [7, 7, 7]); // gap
  assert.deepEqual(at(sheet, 5, 4), [7, 7, 7]); // empty cell
});

test('tile leaves gaps between rows too, and puts smaller images at the top left of cells the size of the largest', () => {
  const big = greyImage(4, 3, () => 200);
  const small = greyImage(2, 1, () => 100);
  const sheet = tile([big, small, small], { columns: 2, gap: 2, background: [7, 7, 7] });
  assert.deepEqual([sheet.width, sheet.height], [10, 8]);
  const background = [7, 7, 7];
  for (let x = 0; x < 10; x++) for (const y of [3, 4]) assert.deepEqual(at(sheet, x, y), background, `gap row at (${x}, ${y})`);
  for (let y = 0; y < 8; y++) for (const x of [4, 5]) assert.deepEqual(at(sheet, x, y), background, `gap column at (${x}, ${y})`);
  assert.deepEqual(at(sheet, 3, 2), [200, 200, 200]);
  assert.deepEqual([at(sheet, 6, 0), at(sheet, 7, 0), at(sheet, 8, 0), at(sheet, 6, 1)], [[100, 100, 100], [100, 100, 100], background, background]);
  assert.deepEqual([at(sheet, 0, 5), at(sheet, 1, 5), at(sheet, 2, 5), at(sheet, 0, 6)], [[100, 100, 100], [100, 100, 100], background, background]);
  const row = tile([big, small]);
  assert.deepEqual([row.width, row.height], [8, 3], 'one row by default, without gaps');
});

test('crop, zoom, shrink and tile keep the colour channels apart', () => {
  const image = colourImage(6, 4);
  assert.deepEqual(at(crop(image, 1, 1, 3, 2), 2, 1), at(image, 3, 2));
  assert.deepEqual(at(zoom(image, 3), 7, 10), at(image, 2, 3));
  const block = [[2, 2], [3, 2], [2, 3], [3, 3]].map(([x, y]) => at(image, x, y));
  assert.deepEqual(at(shrink(image, 2), 1, 1), [0, 1, 2].map((c) => Math.round(block.reduce((sum, p) => sum + p[c], 0) / 4)));
  assert.deepEqual(at(tile([image, image], { gap: 1 }), 9, 2), at(image, 2, 2));
});

// ---------------------------------------------------------------- banding view

// Mean distance from mid-grey of each column's average: high where bands line up
// down the columns, low where the output is only noise.
function columnContrast(image) {
  let total = 0;
  for (let x = 0; x < image.width; x++) {
    let sum = 0;
    for (let y = 0; y < image.height; y++) sum += image.data[4 * (y * image.width + x)];
    total += Math.abs(sum / image.height - 128);
  }
  return total / image.width;
}

test('the banding view turns an undithered gradient into lines and a dithered one into noise', () => {
  const r = createRandom('image-test')('dither');
  const slope = 1 / 16; // one 8-bit level every 16 pixels, a slow gradient
  const banded = greyImage(160, 40, (x) => 100 + Math.floor(x * slope));
  const dithered = greyImage(160, 40, (x) => 100 + x * slope + r.next() - 0.5);
  const flat = greyImage(160, 40, () => 100);

  const bands = columnContrast(bandingView(banded));
  const noise = columnContrast(bandingView(dithered));
  assert.ok(bands > 5, `banded gradient: column contrast ${bands.toFixed(2)}`);
  assert.ok(noise < bands / 3, `dithered gradient: column contrast ${noise.toFixed(2)} vs ${bands.toFixed(2)}`);
  assert.ok(bandingView(flat).data.every((v, i) => v === (i % 4 === 3 ? 255 : 128)), 'a flat image stays mid-grey');
});

test('banded share: an undithered slow gradient is all bands, a dithered one, a flat image and hard edges none', () => {
  const r = createRandom('image-test')('banded');
  const slope = 1 / 32;
  assert.ok(bandedShare(greyImage(320, 4, (x) => 100 + Math.floor(x * slope))) > 90);
  assert.equal(bandedShare(greyImage(320, 4, (x) => 100 + x * slope + r.next() + r.next() - 1)), 0);
  assert.equal(bandedShare(greyImage(320, 4, () => 100)), 0);
  assert.equal(bandedShare(greyImage(320, 4, (x) => (Math.floor(x / 40) % 2 ? 30 : 220))), 0);
});

test('banded share: bands across the rows count too, as in a sky gradient', () => {
  const r = createRandom('image-test')('banded-sky');
  const slope = 1 / 32;
  assert.ok(bandedShare(greyImage(4, 320, (x, y) => 100 + Math.floor(y * slope))) > 90);
  assert.equal(bandedShare(greyImage(64, 320, (x, y) => 100 + y * slope + r.next() + r.next() - 1)), 0);
});

test('banded share: bands in one channel count', () => {
  const blueSteps = createImage(320, 4);
  for (let i = 0; i < 320 * 4; i++) blueSteps.data.set([30, 60, 150 + Math.floor((i % 320) / 32)], 4 * i);
  assert.ok(bandedShare(blueSteps) > 90);
});

test('the banding view draws real edges in flat dark grey', () => {
  const view = bandingView(greyImage(40, 8, (x) => (x < 20 ? 30 : 220)));
  assert.deepEqual(at(view, 19, 4), [64, 64, 64]);
  assert.deepEqual(at(view, 2, 4), [128, 128, 128]);
});

test('the banding view shows banding in a single channel', () => {
  const blueSteps = createImage(64, 8);
  for (let i = 0; i < 64 * 8; i++) blueSteps.data.set([30, 60, 150 + Math.floor((i % 64) / 16)], 4 * i);
  const view = bandingView(blueSteps);
  const blue = [...Array(64).keys()].map((x) => view.data[4 * (4 * 64 + x) + 2]);
  assert.ok(Math.max(...blue) - Math.min(...blue) > 20, 'blue steps show');
  assert.equal(view.data[4 * (4 * 64 + 16)], 128, 'red stays flat');
});

// ---------------------------------------------------------------- shimmer

const WIDTH = 24;
const HEIGHT = 8;
const uniformShift = (dx, dy) => ({ dx: new Float32Array(WIDTH * HEIGHT).fill(dx), dy: new Float32Array(WIDTH * HEIGHT).fill(dy) });

// A vertical edge at x = edge (fractional) between grey 40 and 220, sampled
// either at pixel centres (aliased) or by the area each pixel covers.
function edgeFrame(edge, antialiased) {
  return greyImage(WIDTH, HEIGHT, (x) => {
    const covered = antialiased ? Math.max(0, Math.min(1, x + 1 - edge)) : x + 0.5 >= edge ? 1 : 0;
    return 40 + 180 * covered;
  });
}

test('an aliased edge panned by quarter pixels shimmers, an anti-aliased one does not', () => {
  for (const start of [8, 8.1, 8.3, 8.5, 8.9]) {
    const edges = [0, 1, 2, 3, 4].map((k) => start + 0.25 * k);
    const options = { shift: uniformShift(0.25, 0), threshold: 24 };
    const aliased = shimmer(edges.map((e) => edgeFrame(e, false)), options);
    const smooth = shimmer(edges.map((e) => edgeFrame(e, true)), options);
    assert.ok(aliased.percent > 0, `aliased edge from ${start} flagged`);
    assert.ok(aliased.edgePercent > aliased.percent, 'measured among edge pixels, the share is larger');
    assert.equal(smooth.percent, 0, `anti-aliased edge from ${start}: worst mismatch ${Math.max(...smooth.heat)}`);
  }
});

test('high-contrast edges with 4x MSAA coverage do not count as shimmer, at any angle', () => {
  // Coverage from the standard rotated-grid pattern: a quarter-pixel pan moves it a whole
  // sample at a time, leaving up to about half the contrast unpredicted.
  const samples = [[0.375, 0.125], [0.875, 0.375], [0.125, 0.625], [0.625, 0.875]];
  const size = 32;
  const shift = { dx: new Float32Array(size * size).fill(0.25), dy: new Float32Array(size * size).fill(0.25) };
  const edge = (angle, offset) => {
    const [nx, ny] = [Math.cos(angle), Math.sin(angle)];
    const image = createImage(size, size);
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const covered = samples.filter(([sx, sy]) => nx * (x + sx - 16) + ny * (y + sy - 16) >= offset).length / 4;
        const v = Math.round(10 + 235 * covered);
        image.data.set([v, v, v], 4 * (y * size + x));
      }
    }
    return image;
  };
  for (let degrees = 0; degrees < 180; degrees += 7) {
    const angle = (degrees * Math.PI) / 180;
    const step = 0.25 * (Math.cos(angle) + Math.sin(angle)); // how far the pan moves the edge along its normal
    for (const start of [0, 0.13, 0.31, 0.47]) {
      const { percent, heat } = shimmer([0, 1, 2, 3, 4].map((k) => edge(angle, start + step * k)), { shift, threshold: 24 });
      assert.equal(percent, 0, `${degrees}° from ${start}: worst ${Math.max(...heat).toFixed(1)}`);
    }
  }
});

test('thin stripes finer than a pixel shimmer', () => {
  const stripes = (phase) => greyImage(WIDTH, HEIGHT, (x) => (Math.floor((x + 0.5 + phase) / 0.7) % 2 ? 230 : 20));
  const { percent } = shimmer([0, 0.25, 0.5, 0.75, 1].map(stripes), { shift: uniformShift(-0.25, 0), threshold: 24 });
  assert.ok(percent > 50, `${percent.toFixed(1)}% flagged`);
});

test('static dither noise and smooth gradients do not count as shimmer', () => {
  const r = createRandom('image-test')('noise');
  const dither = Array.from({ length: WIDTH * HEIGHT }, () => r.int(-1, 1));
  const frames = [0, 1, 2, 3, 4].map((k) => greyImage(WIDTH, HEIGHT, (x, y) => 60 + 6 * (x - 0.25 * k) + dither[y * WIDTH + x]));
  const result = shimmer(frames, { shift: uniformShift(0.25, 0), threshold: 24 });
  assert.equal(result.percent, 0);
  assert.equal(result.edgePercent, 0, 'no edges, nothing to share');
});

test('the frame border is left out', () => {
  const r = createRandom('image-test')('border');
  const frames = [0, 1].map(() => greyImage(WIDTH, HEIGHT, () => r.int(0, 255)));
  const { heat } = shimmer(frames, { shift: uniformShift(0, 0), threshold: 24, border: 2 });
  for (const [x, y] of [[0, 0], [1, 4], [WIDTH - 1, 3], [5, HEIGHT - 2]]) assert.equal(heat[y * WIDTH + x], 0, `(${x}, ${y})`);
});

test('panShift matches how the camera projects when turned', () => {
  const [width, height, fov, step] = [320, 180, 70, 0.25];
  const view = { position: [3, 2, 1], yaw: 40, pitch: -12 };
  const { dx, dy, turn } = panShift(width, height, fov, step);
  const camera = new Camera(fov, width / height, 0.1, 1000);
  const toPixel = (p) => {
    const ndc = p.clone().project(camera);
    return [((ndc.x + 1) / 2) * width - 0.5, ((1 - ndc.y) / 2) * height - 0.5];
  };
  for (const [x, y] of [[160, 90], [0, 0], [319, 20], [40, 170], [300, 150]]) {
    applyView(camera, view);
    // A world point seen at the centre of pixel (x, y), 50 m away.
    const ndc = new Vector3(((x + 0.5) / width) * 2 - 1, 1 - ((y + 0.5) / height) * 2, 0.5);
    const point = ndc.applyMatrix4(camera.projectionMatrixInverse).applyMatrix4(camera.matrixWorld).sub(camera.position).normalize().multiplyScalar(50).add(camera.position);
    const before = toPixel(point);
    applyView(camera, view, { turn });
    const after = toPixel(point);
    const i = y * width + x;
    // First-order maths: a few thousandths of a pixel off at the far corners.
    assert.ok(Math.abs(after[0] - before[0] - dx[i]) < 0.01, `dx at (${x}, ${y}): ${after[0] - before[0]} vs ${dx[i]}`);
    assert.ok(Math.abs(after[1] - before[1] - dy[i]) < 0.01, `dy at (${x}, ${y}): ${after[1] - before[1]} vs ${dy[i]}`);
  }
  assert.ok(Math.abs(dx[90 * width + 160] - step) < 0.01, 'a quarter pixel at the centre');
});

test('moveShift matches how the camera projects when moved, and judges only what was in sight before', () => {
  const [width, height, fov] = [320, 180, 70];
  const view = { position: [3, 2, 1], yaw: 40, pitch: -12 };
  const move = [0.3, -0.1, 0.2];
  const camera = new Camera(fov, width / height, 0.1, 1000);
  const toPixel = (p) => {
    const ndc = p.clone().project(camera);
    return [((ndc.x + 1) / 2) * width - 0.5, ((1 - ndc.y) / 2) * height - 0.5];
  };
  // A wall square to the view 20 m ahead of where the camera starts, so 19.8 m
  // from where it moves to; a post 5 m ahead of the start hides a patch of it.
  const before = new Float32Array(width * height).fill(20);
  const after = new Float32Array(width * height).fill(20 + move[2]);
  for (let y = 80; y < 100; y++) for (let x = 100; x < 120; x++) before[y * width + x] = 5;
  const { dx, dy, seen } = moveShift(width, height, fov, before, after, move);
  for (const [x, y] of [[160, 90], [3, 5], [300, 20], [40, 170], [250, 150]]) {
    applyView(camera, view, { move });
    // The wall's point at the centre of pixel (x, y) after the move.
    const ndc = new Vector3(((x + 0.5) / width) * 2 - 1, 1 - ((y + 0.5) / height) * 2, 0.5);
    const ray = ndc.applyMatrix4(camera.projectionMatrixInverse).applyMatrix4(camera.matrixWorld).sub(camera.position);
    const forward = new Vector3(0, 0, -1).applyQuaternion(camera.quaternion);
    const point = ray.multiplyScalar(after[0] / ray.dot(forward)).add(camera.position);
    const now = toPixel(point);
    applyView(camera, view);
    const was = toPixel(point);
    const i = y * width + x;
    assert.ok(Math.abs(now[0] - was[0] - dx[i]) < 1e-3, `dx at (${x}, ${y}): ${now[0] - was[0]} vs ${dx[i]}`);
    assert.ok(Math.abs(now[1] - was[1] - dy[i]) < 1e-3, `dy at (${x}, ${y}): ${now[1] - was[1]} vs ${dy[i]}`);
    assert.equal(seen[i], 1, `in sight at (${x}, ${y})`);
  }
  // Where the post stood, and where the move brings in what lay out of the frame, isn't judged.
  const hidden = (x, y) => seen[y * width + x] === 0;
  const behindPost = (x, y) => before[Math.round(y - dy[y * width + x]) * width + Math.round(x - dx[y * width + x])] === 5;
  let behind = 0;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (!behindPost(x, y)) continue;
      behind++;
      assert.ok(hidden(x, y), `behind the post at (${x}, ${y})`);
    }
  }
  assert.ok(behind > 300, `${behind} pixels behind the post`);
  assert.ok(hidden(width - 1, 90), 'the right edge came into the frame');
});

test('shimmer counts a pixel only where some step judges it, each by its own shift', () => {
  // A checker that flips every frame: nothing foretells it.
  const checker = (k) => greyImage(WIDTH, HEIGHT, (x, y) => ((x + y + k) % 2 ? 30 : 220));
  const frames = [0, 1, 2].map(checker);
  const none = { ...uniformShift(0, 0), seen: new Uint8Array(WIDTH * HEIGHT) };
  const left = { ...uniformShift(0, 0), seen: Uint8Array.from({ length: WIDTH * HEIGHT }, (_, i) => Number(i % WIDTH < WIDTH / 2)) };
  const all = { ...uniformShift(0, 0), seen: new Uint8Array(WIDTH * HEIGHT).fill(1) };
  assert.equal(shimmer(frames, { shift: [none, left], threshold: 24 }).percent, 100, 'the share is of the pixels judged');
  assert.equal(shimmer(frames, { shift: [none, all], threshold: 24 }).percent, 100, 'the second step judges every pixel');
  // A still frame foretold right by the first step and wrong by a second that moves it a pixel.
  const still = greyImage(WIDTH, HEIGHT, (x) => (x % 2 ? 30 : 220));
  const right = shimmer([still, still, still], { shift: [uniformShift(0, 0), uniformShift(0, 0)], threshold: 24 });
  const wrong = shimmer([still, still, still], { shift: [uniformShift(0, 0), uniformShift(1, 0)], threshold: 24 });
  assert.equal(right.percent, 0);
  assert.equal(wrong.percent, 100, "with the second step's shift wrong");
});

test('the shimmer image marks flagged pixels in magenta, grown by a pixel', () => {
  const base = greyImage(5, 1, () => 100);
  const out = heatImage(base, Float32Array.from([0, 0, 0, 0, 50]), 16);
  assert.deepEqual(at(out, 0, 0), [60, 60, 60]);
  assert.deepEqual(at(out, 3, 0), [255, 40, 200], 'neighbour of a flagged pixel');
  assert.deepEqual(at(out, 4, 0), [255, 40, 200]);
});

test('the heat map grows a flagged pixel to its four neighbours only, and tints heat under the threshold', () => {
  const heat = new Float32Array(25);
  heat[2 * 5 + 2] = 16; // at the threshold: flagged
  heat[0] = 15.9; // just under it
  const out = heatImage(greyImage(5, 5, () => 100), heat, 16);
  for (const [x, y] of [[2, 2], [1, 2], [3, 2], [2, 1], [2, 3]]) assert.deepEqual(at(out, x, y), MAGENTA, `(${x}, ${y})`);
  for (const [x, y] of [[1, 1], [3, 1], [1, 3], [3, 3], [0, 2], [4, 2], [2, 0], [2, 4], [1, 0], [0, 1]]) {
    assert.deepEqual(at(out, x, y), [60, 60, 60], `(${x}, ${y}): neither flagged nor next to one`);
  }
  const [r, g, b] = at(out, 0, 0);
  assert.ok(r > 60 && r < 255 && g < 60 && b > 60 && b < 200, `a faint tint, ${[r, g, b]}`);
});

// ---------------------------------------------------------------- overdraw

test('overdraw stats and colours follow the fragment counts', () => {
  const field = { width: 5, height: 1, counts: Uint8Array.from([0, 1, 3, 12, 34]) };
  assert.deepEqual(overdrawStats(field), { mean: 10, max: 34 });
  const image = overdrawImage(field);
  assert.deepEqual(at(image, 0, 0), [0, 0, 0]);
  assert.deepEqual(at(image, 4, 0), [255, 255, 255]);
  assert.notDeepEqual(at(image, 3, 0), at(image, 4, 0), '10 to 15 differ from 16 and up');
  assert.notDeepEqual(at(image, 1, 0), at(image, 2, 0));
});

test('the overdraw colours change exactly where the legend says', () => {
  const counts = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 15, 16, 255];
  const image = overdrawImage({ width: counts.length, height: 1, counts: Uint8Array.from(counts) });
  const colour = (n) => at(image, counts.indexOf(n), 0);
  assert.deepEqual(colour(0), [0, 0, 0]);
  assert.equal(new Set([0, 1, 2, 3, 4, 5, 6, 7, 10, 16].map((n) => String(colour(n)))).size, 10, 'black, the six steps, magenta, pink and white all differ');
  assert.deepEqual([colour(8), colour(9)], [colour(7), colour(7)], 'magenta from 7 to 9');
  assert.deepEqual(colour(15), colour(10), 'pink from 10 to 15');
  assert.deepEqual([colour(16), colour(255)], [[255, 255, 255], [255, 255, 255]], 'white from 16');
});

// ---------------------------------------------------------------- motion

test('motion measures the share of pixels that change across the frames', () => {
  const still = greyImage(10, 10, () => 50);
  const half = greyImage(10, 10, (x) => (x < 5 ? 50 : 90));
  assert.equal(motion([still, still, still]).percent, 0);
  assert.equal(motion([still, half]).percent, 50);
  assert.equal(motion([still, half, still]).percent, 50);
  assert.equal(motion([still]).percent, 0);
  assert.equal(motion([still, half]).heat[9], 40, 'the map holds the range per pixel');
});

test('a slow drift counts as motion even when no single step passes the threshold', () => {
  const frames = [0, 1, 2, 3, 4, 5].map((k) => greyImage(10, 10, () => 100 + 2 * k));
  assert.equal(motion(frames, { threshold: 4 }).percent, 100);
});

test('motion counts the pixels its map marks: those whose range reaches the threshold', () => {
  const still = greyImage(7, 1, () => 100);
  const moved = greyImage(7, 1, (x) => 100 + [0, 3, 0, 4, 0, 0, 5][x]);
  const { percent, heat } = motion([still, moved], { threshold: 4 });
  assert.equal(percent, (100 * 2) / 7);
  const map = heatImage(still, heat, 4);
  assert.deepEqual([at(map, 3, 0), at(map, 6, 0)], [MAGENTA, MAGENTA]);
  assert.notDeepEqual(at(map, 1, 0), MAGENTA);
});

test('motion counts a change in any one channel', () => {
  const still = createImage(4, 1, [10, 20, 30]);
  const moved = createImage(4, 1, [10, 20, 30]);
  moved.data.set([90, 20, 30], 0);
  moved.data.set([10, 90, 30], 4);
  moved.data.set([10, 20, 90], 8);
  assert.equal(motion([still, moved]).percent, 75);
});
