// Minimal PNG codec for the screenshot tool: 8-bit, non-interlaced images, which
// is what Chromium writes. Images are { width, height, data } with data as RGBA
// bytes, row by row from the top. Node built-ins only.
import { crc32, deflateSync, inflateSync } from 'node:zlib';

const SIGNATURE = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
const CHANNELS = { 0: 1, 2: 3, 4: 2, 6: 4 }; // colour type -> channels: grey, RGB, grey+alpha, RGBA

export function decodePng(buffer) {
  if (!buffer.subarray(0, 8).equals(SIGNATURE)) throw new Error('not a PNG');
  let header = null;
  const idat = [];
  for (let at = 8; at < buffer.length; ) {
    const length = buffer.readUInt32BE(at);
    const type = buffer.toString('latin1', at + 4, at + 8);
    const body = buffer.subarray(at + 8, at + 8 + length);
    if (type === 'IHDR') {
      header = { width: body.readUInt32BE(0), height: body.readUInt32BE(4), depth: body[8], colour: body[9], interlace: body[12] };
    } else if (type === 'IDAT') {
      idat.push(body);
    } else if (type === 'IEND') {
      break;
    }
    at += 12 + length;
  }
  if (!header) throw new Error('PNG has no IHDR chunk');
  const { width, height, depth, colour, interlace } = header;
  const channels = CHANNELS[colour];
  if (depth !== 8 || !channels || interlace !== 0) {
    throw new Error(`unsupported PNG (bit depth ${depth}, colour type ${colour}, interlace ${interlace})`);
  }

  const raw = inflateSync(Buffer.concat(idat));
  const stride = width * channels;
  const pixels = new Uint8Array(stride * height);
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)];
    const line = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1));
    unfilter(filter, line, pixels, y * stride, stride, channels);
  }

  const data = new Uint8Array(width * height * 4);
  for (let i = 0, j = 0; i < width * height; i++, j += channels) {
    const grey = channels <= 2;
    data[4 * i] = pixels[j];
    data[4 * i + 1] = pixels[grey ? j : j + 1];
    data[4 * i + 2] = pixels[grey ? j : j + 2];
    data[4 * i + 3] = channels === 4 ? pixels[j + 3] : channels === 2 ? pixels[j + 1] : 255;
  }
  return { width, height, data };
}

// Writes an opaque RGB PNG (alpha is dropped). Every row uses one filter type:
// Sub by default, which on these images beats choosing per row in both speed
// and size; tests pick others to cover the decoder.
export function encodePng({ width, height, data }, { filter = 1 } = {}) {
  const stride = width * 3;
  const rgb = new Uint8Array(stride * height);
  for (let i = 0; i < width * height; i++) {
    rgb[3 * i] = data[4 * i];
    rgb[3 * i + 1] = data[4 * i + 1];
    rgb[3 * i + 2] = data[4 * i + 2];
  }
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (stride + 1)] = filter;
    applyFilter(filter, rgb, y * stride, stride, 3, raw.subarray(y * (stride + 1) + 1));
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // RGB
  return Buffer.concat([SIGNATURE, chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw, { level: 6 })), chunk('IEND', Buffer.alloc(0))]);
}

function chunk(type, body) {
  const out = Buffer.alloc(12 + body.length);
  out.writeUInt32BE(body.length, 0);
  out.write(type, 4, 'latin1');
  body.copy(out, 8);
  out.writeUInt32BE(crc32(out.subarray(4, 8 + body.length)), 8 + body.length);
  return out;
}

function paeth(a, b, c) {
  const p = a + b - c;
  const pa = Math.abs(p - a);
  const pb = Math.abs(p - b);
  const pc = Math.abs(p - c);
  return pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
}

// Reconstructs one row into out[at..at+stride), using the row above it in out.
function unfilter(filter, line, out, at, stride, bpp) {
  for (let x = 0; x < stride; x++) {
    const a = x >= bpp ? out[at + x - bpp] : 0;
    const b = at >= stride ? out[at + x - stride] : 0;
    const c = x >= bpp && at >= stride ? out[at + x - stride - bpp] : 0;
    const predictor = filter === 0 ? 0 : filter === 1 ? a : filter === 2 ? b : filter === 3 ? (a + b) >> 1 : filter === 4 ? paeth(a, b, c) : NaN;
    if (Number.isNaN(predictor)) throw new Error(`bad PNG filter type ${filter}`);
    out[at + x] = (line[x] + predictor) & 255;
  }
}

// Filters one row of `src` into `out`.
function applyFilter(filter, src, at, stride, bpp, out) {
  for (let x = 0; x < stride; x++) {
    const a = x >= bpp ? src[at + x - bpp] : 0;
    const b = at >= stride ? src[at + x - stride] : 0;
    const c = x >= bpp && at >= stride ? src[at + x - stride - bpp] : 0;
    const predictor = filter === 0 ? 0 : filter === 1 ? a : filter === 2 ? b : filter === 3 ? (a + b) >> 1 : paeth(a, b, c);
    out[x] = (src[at + x] - predictor) & 255;
  }
}
