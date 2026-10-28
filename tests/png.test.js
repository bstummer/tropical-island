import test from 'node:test';
import assert from 'node:assert/strict';
import { crc32, deflateSync, inflateSync } from 'node:zlib';
import { decodePng, encodePng } from '../tools/png.js';
import { createRandom } from '../src/core/random.js';

// A small image with smooth areas, hard edges and noise, so every filter type has work to do.
function sampleImage(width = 37, height = 23) {
  const r = createRandom('png-test')('pixels');
  const data = new Uint8Array(width * height * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = 4 * (y * width + x);
      data[i] = (x * 7) & 255;
      data[i + 1] = x > width / 2 ? 240 : 12;
      data[i + 2] = r.int(0, 255);
      data[i + 3] = 255;
    }
  }
  return { width, height, data };
}

// The PNG spec's filters (W3C PNG, 9.2 and 9.4), written from it and not from
// tools/png.js: row y of `rows` (arrays of samples) filtered with `type`, for
// pixels of `bpp` bytes. a is the byte one pixel left, b the one above, c the
// one above and left; 0 past the image's edge.
function specPaeth(a, b, c) {
  const p = a + b - c;
  const pa = Math.abs(p - a);
  const pb = Math.abs(p - b);
  const pc = Math.abs(p - c);
  if (pa <= pb && pa <= pc) return a;
  if (pb <= pc) return b;
  return c;
}
function specFilter(type, rows, y, bpp) {
  return rows[y].map((x, i) => {
    const a = i >= bpp ? rows[y][i - bpp] : 0;
    const b = y > 0 ? rows[y - 1][i] : 0;
    const c = y > 0 && i >= bpp ? rows[y - 1][i - bpp] : 0;
    const predictor = [0, a, b, Math.floor((a + b) / 2), specPaeth(a, b, c)][type];
    return (x - predictor + 256) % 256;
  });
}

// Samples that make Paeth's ties and every one of its three answers common:
// few distinct values, and the ends of the range, where filtered bytes wrap.
function tieSamples(count, seed) {
  const r = createRandom('png-test')(seed);
  return Array.from({ length: count }, () => r.pick([0, 1, 2, 3, 4, 127, 128, 254, 255]));
}

// Builds a PNG by hand: rows of raw samples in any colour type, filtered with
// `filter` as the spec says (unfiltered by default), split over two IDAT chunks.
function handMadePng(width, height, colourType, samples, { depth = 8, interlace = 0, filter = 0 } = {}) {
  const channels = { 0: 1, 2: 3, 4: 2, 6: 4 }[colourType];
  const raw = Array.from({ length: height }, (_, y) => samples.slice(y * width * channels, (y + 1) * width * channels));
  const rows = [];
  for (let y = 0; y < height; y++) rows.push(Buffer.from([filter]), Buffer.from(specFilter(filter, raw, y, channels)));
  const compressed = deflateSync(Buffer.concat(rows));
  const half = Math.floor(compressed.length / 2);
  const chunk = (type, body) => {
    const head = Buffer.alloc(8);
    head.writeUInt32BE(body.length, 0);
    head.write(type, 4, 'latin1');
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(Buffer.concat([head.subarray(4), body])));
    return Buffer.concat([head, body, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = depth;
  ihdr[9] = colourType;
  ihdr[12] = interlace;
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', ihdr),
    chunk('tEXt', Buffer.from('Comment\0ignored', 'latin1')),
    chunk('IDAT', compressed.subarray(0, half)),
    chunk('IDAT', compressed.subarray(half)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

test('encode then decode gives back the same pixels, with every filter type', () => {
  const image = sampleImage();
  for (const filter of [undefined, 0, 1, 2, 3, 4]) {
    const decoded = decodePng(encodePng(image, { filter }));
    assert.equal(decoded.width, image.width);
    assert.equal(decoded.height, image.height);
    assert.deepEqual(decoded.data, image.data, `filter ${filter ?? 'default'}`);
  }
});

test('rows filtered as the spec says decode to their samples, with every filter type and pixel size', () => {
  const [width, height] = [23, 9];
  for (const [colourType, channels] of [[0, 1], [4, 2], [2, 3], [6, 4]]) {
    const samples = tieSamples(width * height * channels, `decode ${colourType}`);
    for (const filter of [0, 1, 2, 3, 4]) {
      const { data } = decodePng(handMadePng(width, height, colourType, samples, { filter }));
      const rgb = (i) => (channels >= 3 ? [0, 1, 2].map((c) => samples[i * channels + c]) : [0, 0, 0].map(() => samples[i * channels]));
      for (let i = 0; i < width * height; i++) {
        assert.deepEqual([...data.subarray(4 * i, 4 * i + 3)], rgb(i), `colour type ${colourType}, filter ${filter}, pixel ${i}`);
      }
    }
  }
});

test('the encoder filters rows as the spec says', () => {
  const [width, height] = [29, 11];
  const image = { width, height, data: Uint8Array.from(tieSamples(width * height * 4, 'encode')) };
  const rgb = Array.from({ length: height }, (_, y) => [...image.data.subarray(4 * width * y, 4 * width * (y + 1))].filter((_, i) => i % 4 !== 3));
  for (const filter of [0, 1, 2, 3, 4]) {
    const png = encodePng(image, { filter });
    const idat = [];
    for (let at = 8; at < png.length; at += 12 + png.readUInt32BE(at)) {
      if (png.toString('latin1', at + 4, at + 8) === 'IDAT') idat.push(png.subarray(at + 8, at + 8 + png.readUInt32BE(at)));
    }
    const raw = inflateSync(Buffer.concat(idat));
    for (let y = 0; y < height; y++) {
      const row = raw.subarray(y * (3 * width + 1), (y + 1) * (3 * width + 1));
      assert.equal(row[0], filter);
      assert.deepEqual([...row.subarray(1)], specFilter(filter, rgb, y, 3), `filter ${filter}, row ${y}`);
    }
  }
});

test('the encoder writes opaque RGB', () => {
  const image = sampleImage(4, 3);
  image.data[3] = 10;
  const decoded = decodePng(encodePng(image));
  assert.equal(decoded.data[3], 255);
});

test('grey, grey with alpha and RGBA PNGs decode to RGBA', () => {
  assert.deepEqual([...decodePng(handMadePng(2, 1, 0, [0, 200])).data], [0, 0, 0, 255, 200, 200, 200, 255]);
  assert.deepEqual([...decodePng(handMadePng(1, 2, 4, [9, 128, 250, 0])).data], [9, 9, 9, 128, 250, 250, 250, 0]);
  assert.deepEqual([...decodePng(handMadePng(1, 1, 6, [1, 2, 3, 4])).data], [1, 2, 3, 4]);
});

test('unsupported or broken files fail loudly', () => {
  assert.throws(() => decodePng(Buffer.from('GIF89a...')), /not a PNG/);
  assert.throws(() => decodePng(handMadePng(1, 1, 0, [0, 0], { depth: 16 })), /unsupported PNG \(bit depth 16/);
  assert.throws(() => decodePng(handMadePng(1, 1, 2, [0, 0, 0], { interlace: 1 })), /interlace 1/);
});
