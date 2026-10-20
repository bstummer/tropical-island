import test from 'node:test';
import assert from 'node:assert/strict';
import { crc32, deflateSync } from 'node:zlib';
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

// Builds a PNG by hand: unfiltered rows of raw samples in any colour type, split over two IDAT chunks.
function handMadePng(width, height, colourType, samples, { depth = 8, interlace = 0 } = {}) {
  const channels = { 0: 1, 2: 3, 4: 2, 6: 4 }[colourType];
  const rows = [];
  for (let y = 0; y < height; y++) rows.push(Buffer.from([0]), Buffer.from(samples.slice(y * width * channels, (y + 1) * width * channels)));
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
