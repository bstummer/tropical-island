import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {
  bandingView,
  createImage,
  crop,
  heatImage,
  motion,
  overdrawImage,
  overdrawStats,
  panShift,
  samePixels,
  shimmer,
  shrink,
  tile,
  zoom,
} from '../tools/image.js';
import { createRandom } from '../src/core/random.js';
import { applyView } from '../src/core/camera.js';

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

test('zoom repeats pixels and shrink averages them back', () => {
  const image = greyImage(3, 2, (x, y) => 40 * x + 100 * y);
  const big = zoom(image, 2);
  assert.deepEqual([big.width, big.height], [6, 4]);
  assert.deepEqual(at(big, 5, 3), at(image, 2, 1));
  assert.deepEqual(at(big, 4, 2), at(image, 2, 1));
  assert.ok(samePixels(shrink(big, 2), image));
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
    assert.equal(smooth.percent, 0, `anti-aliased edge from ${start}: worst mismatch ${Math.max(...smooth.heat)}`);
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
  assert.equal(shimmer(frames, { shift: uniformShift(0.25, 0), threshold: 24 }).percent, 0);
});

test('the frame border is left out', () => {
  const r = createRandom('image-test')('border');
  const frames = [0, 1].map(() => greyImage(WIDTH, HEIGHT, () => r.int(0, 255)));
  const { heat } = shimmer(frames, { shift: uniformShift(0, 0), threshold: 24, border: 2 });
  for (const [x, y] of [[0, 0], [1, 4], [WIDTH - 1, 3], [5, HEIGHT - 2]]) assert.equal(heat[y * WIDTH + x], 0, `(${x}, ${y})`);
});

test('panShift matches how three.js projects a turned camera', () => {
  const [width, height, fov, step] = [320, 180, 70, 0.25];
  const view = { position: [3, 2, 1], yaw: 40, pitch: -12 };
  const { dx, dy, turn } = panShift(width, height, fov, step);
  const camera = new THREE.PerspectiveCamera(fov, width / height, 0.1, 1000);
  const toPixel = (p) => {
    const ndc = p.clone().project(camera);
    return [((ndc.x + 1) / 2) * width - 0.5, ((1 - ndc.y) / 2) * height - 0.5];
  };
  for (const [x, y] of [[160, 90], [0, 0], [319, 20], [40, 170], [300, 150]]) {
    applyView(camera, view);
    // A world point seen at the centre of pixel (x, y), 50 m away.
    const ndc = new THREE.Vector3(((x + 0.5) / width) * 2 - 1, 1 - ((y + 0.5) / height) * 2, 0.5);
    const point = ndc.unproject(camera).sub(camera.position).setLength(50).add(camera.position);
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

test('the shimmer image marks flagged pixels in magenta', () => {
  const base = greyImage(2, 1, () => 100);
  const out = heatImage(base, Float32Array.from([0, 50]), 16);
  assert.deepEqual(at(out, 0, 0), [30, 30, 30]);
  assert.deepEqual(at(out, 1, 0), [255, 40, 200]);
});

// ---------------------------------------------------------------- overdraw

test('overdraw stats and colours follow the fragment counts', () => {
  const field = { width: 4, height: 1, counts: Uint8Array.from([0, 1, 3, 12]) };
  assert.deepEqual(overdrawStats(field), { mean: 4, max: 12 });
  const image = overdrawImage(field);
  assert.deepEqual(at(image, 0, 0), [0, 0, 0]);
  assert.deepEqual(at(image, 3, 0), [255, 255, 255]);
  assert.notDeepEqual(at(image, 1, 0), at(image, 2, 0));
});

// ---------------------------------------------------------------- motion

test('motion measures the share of pixels that change across the frames', () => {
  const still = greyImage(10, 10, () => 50);
  const half = greyImage(10, 10, (x) => (x < 5 ? 50 : 90));
  assert.equal(motion([still, still, still]), 0);
  assert.equal(motion([still, half]), 50);
  assert.equal(motion([still, half, still]), 50);
  assert.equal(motion([still]), 0);
});

test('a slow drift counts as motion even when no single step passes the threshold', () => {
  const frames = [0, 1, 2, 3, 4, 5].map((k) => greyImage(10, 10, () => 100 + 2 * k));
  assert.equal(motion(frames, { threshold: 4 }), 100);
});
