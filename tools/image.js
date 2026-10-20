// Pure image analysis for tools/screenshot.js. Images are { width, height, data }
// with data as RGBA bytes, as tools/png.js decodes them. Tested in tests/image.test.js.

export function createImage(width, height, [r, g, b] = [0, 0, 0]) {
  const data = new Uint8Array(width * height * 4);
  for (let i = 0; i < data.length; i += 4) {
    data[i] = r;
    data[i + 1] = g;
    data[i + 2] = b;
    data[i + 3] = 255;
  }
  return { width, height, data };
}

// The w x h region at (x, y), clamped to the image.
export function crop(image, x, y, w, h) {
  x = Math.max(0, Math.min(Math.round(x), image.width - 1));
  y = Math.max(0, Math.min(Math.round(y), image.height - 1));
  w = Math.min(w, image.width - x);
  h = Math.min(h, image.height - y);
  const out = createImage(w, h);
  for (let row = 0; row < h; row++) {
    const from = ((y + row) * image.width + x) * 4;
    out.data.set(image.data.subarray(from, from + w * 4), row * w * 4);
  }
  return out;
}

// Integer upscale with hard pixel edges, so single pixels stay visible.
export function zoom(image, factor) {
  const out = createImage(image.width * factor, image.height * factor);
  for (let y = 0; y < out.height; y++) {
    for (let x = 0; x < out.width; x++) {
      const from = (Math.floor(y / factor) * image.width + Math.floor(x / factor)) * 4;
      out.data.set(image.data.subarray(from, from + 4), (y * out.width + x) * 4);
    }
  }
  return out;
}

// Integer downscale by averaging factor x factor blocks.
export function shrink(image, factor) {
  const w = Math.floor(image.width / factor);
  const h = Math.floor(image.height / factor);
  const out = createImage(w, h);
  const area = factor * factor;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      for (let c = 0; c < 3; c++) {
        let sum = 0;
        for (let dy = 0; dy < factor; dy++) {
          for (let dx = 0; dx < factor; dx++) sum += image.data[((y * factor + dy) * image.width + x * factor + dx) * 4 + c];
        }
        out.data[(y * w + x) * 4 + c] = Math.round(sum / area);
      }
    }
  }
  return out;
}

// Lays images out left to right, top to bottom, in cells the size of the largest one.
export function tile(images, { columns = images.length, gap = 0, background = [21, 23, 26] } = {}) {
  const cellW = Math.max(...images.map((i) => i.width));
  const cellH = Math.max(...images.map((i) => i.height));
  const rows = Math.ceil(images.length / columns);
  const out = createImage(columns * cellW + (columns - 1) * gap, rows * cellH + (rows - 1) * gap, background);
  images.forEach((image, n) => {
    const x0 = (n % columns) * (cellW + gap);
    const y0 = Math.floor(n / columns) * (cellH + gap);
    for (let row = 0; row < image.height; row++) {
      out.data.set(image.data.subarray(row * image.width * 4, (row + 1) * image.width * 4), ((y0 + row) * out.width + x0) * 4);
    }
  });
  return out;
}

// Contrast-boosted copy: each channel's deviation from its local mean, times
// `gain`, around mid-grey. Banding shows up as contour lines that follow the
// gradient; dithering shows up as fine noise; flat areas stay grey.
export function bandingView(image, { radius = 6, gain = 32 } = {}) {
  const { width, height } = image;
  const n = width * height;
  const out = createImage(width, height);
  const channel = new Float32Array(n);
  const blurred = new Float32Array(n);
  const scratch = new Float32Array(n);
  for (let c = 0; c < 3; c++) {
    for (let i = 0; i < n; i++) channel[i] = image.data[4 * i + c];
    boxBlur(channel, blurred, scratch, width, height, radius);
    for (let i = 0; i < n; i++) out.data[4 * i + c] = clamp(128 + gain * (channel[i] - blurred[i]));
  }
  return out;
}

// How a still scene's image moves when the camera turns by `step` pixels'
// worth on both axes (yaw and pitch) at the centre of the frame: per pixel
// motion in pixels (dx right, dy down; larger towards the edges), plus that
// turn in degrees for __CAPTURE__.render({ turn }). `fov` is vertical, in degrees.
export function panShift(width, height, fov, step) {
  const f = height / 2 / Math.tan((fov * Math.PI) / 360); // focal length in pixels
  const angle = step / f;
  const dx = new Float32Array(width * height);
  const dy = new Float32Array(width * height);
  for (let y = 0; y < height; y++) {
    const v = (height / 2 - (y + 0.5)) / f;
    for (let x = 0; x < width; x++) {
      const u = (x + 0.5 - width / 2) / f;
      dx[y * width + x] = f * angle * (1 + u * u - u * v);
      dy[y * width + x] = f * angle * (1 + v * v - u * v);
    }
  }
  const degrees = (angle * 180) / Math.PI;
  return { dx, dy, turn: [degrees, degrees] };
}

// Shimmer across frames of a still scene panned in equal sub-pixel steps,
// where `shift` ({ dx, dy } per pixel, see panShift) says how far the image
// moves per step. Well-filtered content moves smoothly, so each frame nearly
// matches the previous one shifted with bilinear interpolation. Aliased content
// (edges or detail that pop between pixels) does not.
//
// How much a mismatch counts depends on its share of the local contrast (the
// range over 3 x 3 pixels in either frame). A quarter-pixel step leaves a
// box-filtered edge off by under 0.2 of its contrast and a 4x MSAA edge by up
// to about 0.5 (coverage moves a whole sample at a time); point-sampled detail
// pops by 0.75 and more. So mismatches start to count at `ratio` (the MSAA
// baseline) and count in full from `fullRatio`. `heat` holds the worst count
// per pixel over all steps and channels, in 8-bit levels; `percent` is the
// share of pixels at or above `threshold`. A `border` where content enters the
// frame is left out.
export function shimmer(frames, { shift, threshold = 24, ratio = 0.5, fullRatio = 0.7, border = 2 }) {
  const { width, height } = frames[0];
  const heat = new Float32Array(width * height);
  const ranges = frames.map(localRange);
  let flagged = 0;
  let counted = 0;
  for (let y = border; y < height - border; y++) {
    for (let x = border; x < width - border; x++) {
      const i = y * width + x;
      const sx = x - shift.dx[i];
      const sy = y - shift.dy[i];
      const x0 = Math.floor(sx);
      const y0 = Math.floor(sy);
      if (x0 < 0 || y0 < 0 || x0 + 1 >= width || y0 + 1 >= height) continue;
      const fx = sx - x0;
      const fy = sy - y0;
      const w00 = (1 - fx) * (1 - fy);
      const w10 = fx * (1 - fy);
      const w01 = (1 - fx) * fy;
      const w11 = fx * fy;
      const j00 = 4 * (y0 * width + x0);
      const j01 = j00 + 4 * width;
      const nearest = 4 * (Math.round(sy) * width + Math.round(sx));
      let worst = 0;
      for (let k = 0; k + 1 < frames.length; k++) {
        const a = frames[k].data;
        const b = frames[k + 1].data;
        for (let c = 0; c < 3; c++) {
          const predicted = w00 * a[j00 + c] + w10 * a[j00 + 4 + c] + w01 * a[j01 + c] + w11 * a[j01 + 4 + c];
          const miss = Math.abs(b[4 * i + c] - predicted);
          const contrast = Math.max(ranges[k][nearest + c], ranges[k + 1][4 * i + c]);
          const share = miss / (contrast || 1);
          const counted = miss * Math.min(1, Math.max(0, (share - ratio) / (fullRatio - ratio)));
          if (counted > worst) worst = counted;
        }
      }
      heat[i] = worst;
      counted++;
      if (worst >= threshold) flagged++;
    }
  }
  return { percent: counted ? (100 * flagged) / counted : 0, heat };
}

// Where it shimmers: the frame in dim grey, pixels at or above `threshold` in
// magenta, weaker second differences as a faint tint.
export function heatImage(base, heat, threshold) {
  const out = createImage(base.width, base.height);
  const d = base.data;
  for (let i = 0; i < heat.length; i++) {
    const grey = 0.3 * (0.2126 * d[4 * i] + 0.7152 * d[4 * i + 1] + 0.0722 * d[4 * i + 2]);
    const k = heat[i] >= threshold ? 1 : 0.4 * (heat[i] / threshold);
    out.data[4 * i] = grey + (255 - grey) * k;
    out.data[4 * i + 1] = grey + (40 - grey) * k;
    out.data[4 * i + 2] = grey + (200 - grey) * k;
  }
  return out;
}

// How much of the frame moves over a series of frames: the percentage of pixels
// where some channel's range (max - min across the frames) exceeds `threshold`.
// Slow drifts count as much as fast changes.
export function motion(frames, { threshold = 4 } = {}) {
  const n = frames[0].width * frames[0].height;
  let moving = 0;
  for (let i = 0; i < n; i++) {
    for (let c = 4 * i; c < 4 * i + 3; c++) {
      let min = 255;
      let max = 0;
      for (const frame of frames) {
        const v = frame.data[c];
        if (v < min) min = v;
        if (v > max) max = v;
      }
      if (max - min > threshold) {
        moving++;
        break;
      }
    }
  }
  return (100 * moving) / n;
}

// Fragments shaded per pixel as colours: black 0, then blue, teal, green,
// yellow, orange and red for 1 to 6, magenta for 7 to 9, white from 10.
const OVERDRAW_RAMP = [
  [0, 0, 0],
  [25, 45, 130],
  [20, 135, 160],
  [55, 175, 70],
  [225, 205, 45],
  [240, 135, 25],
  [215, 45, 35],
  [215, 50, 190],
];

export function overdrawImage({ width, height, counts }) {
  const out = createImage(width, height);
  for (let i = 0; i < counts.length; i++) {
    const n = counts[i];
    out.data.set(n >= 10 ? [255, 255, 255] : OVERDRAW_RAMP[Math.min(n, OVERDRAW_RAMP.length - 1)], 4 * i);
  }
  return out;
}

// Mean and maximum fragments per pixel.
export function overdrawStats({ counts }) {
  let sum = 0;
  let max = 0;
  for (const n of counts) {
    sum += n;
    if (n > max) max = n;
  }
  return { mean: sum / counts.length, max };
}

export function samePixels(a, b) {
  if (a.width !== b.width || a.height !== b.height) return false;
  for (let i = 0; i < a.data.length; i++) if (a.data[i] !== b.data[i]) return false;
  return true;
}

// Per pixel and channel (RGBA layout), max - min over its 3 x 3 neighbourhood:
// a horizontal then a vertical pass of 3-wide min and max, clamped at the edges.
function localRange({ width, height, data }) {
  const stride = width * 4;
  const lo = new Uint8Array(data.length);
  const hi = new Uint8Array(data.length);
  for (let row = 0; row < data.length; row += stride) {
    for (let i = row; i < row + stride; i++) {
      const a = data[i > row + 3 ? i - 4 : i];
      const b = data[i];
      const c = data[i < row + stride - 4 ? i + 4 : i];
      lo[i] = a < b ? (a < c ? a : c) : b < c ? b : c;
      hi[i] = a > b ? (a > c ? a : c) : b > c ? b : c;
    }
  }
  const range = new Uint8Array(data.length);
  for (let i = 0; i < data.length; i++) {
    const up = i >= stride ? i - stride : i;
    const down = i < data.length - stride ? i + stride : i;
    const min = Math.min(lo[up], lo[i], lo[down]);
    const max = Math.max(hi[up], hi[i], hi[down]);
    range[i] = max - min;
  }
  return range;
}

// Separable box blur with a (2r+1)-wide window, shrunk at the borders.
function boxBlur(src, dst, scratch, width, height, r) {
  for (let y = 0; y < height; y++) blurLine(src, scratch, y * width, 1, width, r);
  for (let x = 0; x < width; x++) blurLine(scratch, dst, x, width, height, r);
}

function blurLine(src, dst, start, step, n, r) {
  let sum = 0;
  let count = 0;
  for (let i = 0; i <= Math.min(r, n - 1); i++) {
    sum += src[start + i * step];
    count++;
  }
  for (let i = 0; i < n; i++) {
    dst[start + i * step] = sum / count;
    if (i + r + 1 < n) {
      sum += src[start + (i + r + 1) * step];
      count++;
    }
    if (i - r >= 0) {
      sum -= src[start + (i - r) * step];
      count--;
    }
  }
}

function clamp(v) {
  return v < 0 ? 0 : v > 255 ? 255 : Math.round(v);
}
