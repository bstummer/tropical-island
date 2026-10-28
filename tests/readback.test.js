import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readTexture } from '../src/gpu/readback.js';
import { bytesPerTexel } from '../src/core/gpu-stats.js';
import { toHalfFloat } from '../src/maths/index.js';

globalThis.GPUBufferUsage ??= { MAP_READ: 0x01, COPY_DST: 0x08 };
globalThis.GPUMapMode ??= { READ: 1 };

// A texture on a fake device: per mip level, its texels' bytes, row by row.
// The device copies them out as WebGPU does, and refuses what WebGPU's
// validation refuses (rows not padded to 256 bytes, a copy outside the level).
function fakeTexture({ format, width, height, levels = 1 }) {
  const texel = bytesPerTexel(format);
  const level = (l) => ({ width: Math.max(1, width >> l), height: Math.max(1, height >> l) });
  const bytes = Array.from({ length: levels }, (_, l) => Uint8Array.from({ length: level(l).width * level(l).height * texel }, (_, i) => (i * 7 + l * 50) & 255));
  const gpu = {
    queue: { submit() {} },
    device: {
      createBuffer: ({ size }) => {
        const data = new Uint8Array(size).fill(0xee);
        return { data, mapAsync: async () => {}, getMappedRange: () => data.buffer, unmap() {}, destroy() {} };
      },
      createCommandEncoder: () => ({
        copyTextureToBuffer({ mipLevel, origin: [x, y, layer] }, { buffer, bytesPerRow }, [w, h]) {
          const size = level(mipLevel);
          if (mipLevel >= levels || x + w > size.width || y + h > size.height || layer !== 0) throw new Error(`copy outside mip level ${mipLevel} (${size.width} x ${size.height})`);
          if (bytesPerRow % 256 || bytesPerRow < w * texel || buffer.data.length < bytesPerRow * (h - 1) + w * texel) throw new Error('bad buffer layout');
          for (let row = 0; row < h; row++) {
            const from = ((y + row) * size.width + x) * texel;
            buffer.data.set(bytes[mipLevel].subarray(from, from + w * texel), row * bytesPerRow);
          }
        },
        finish: () => ({}),
      }),
    },
  };
  return { gpu, texture: { name: 'test', format, width, height, texture: {} }, bytes };
}

test('a readback of 8-bit texels is their bytes, rows unpadded, also one byte a texel', async () => {
  for (const format of ['r8unorm', 'rgba8unorm']) {
    const { gpu, texture, bytes } = fakeTexture({ format, width: 5, height: 3 });
    const pixels = await readTexture(gpu, texture);
    assert.ok(pixels instanceof Uint8Array, format);
    assert.deepEqual(pixels, bytes[0], format);
    // A rectangle within it.
    const texel = bytesPerTexel(format);
    const part = await readTexture(gpu, texture, { x: 1, y: 1, width: 3, height: 2 });
    const expected = [1, 2].flatMap((row) => [...bytes[0].subarray((row * 5 + 1) * texel, (row * 5 + 4) * texel)]);
    assert.deepEqual([...part], expected, format);
  }
});

test('a mip level reads back at its own size', async () => {
  const { gpu, texture, bytes } = fakeTexture({ format: 'rgba8unorm', width: 8, height: 4, levels: 4 });
  assert.deepEqual(await readTexture(gpu, texture, { level: 1 }), bytes[1]); // 4 x 2
  assert.deepEqual(await readTexture(gpu, texture, { level: 3 }), bytes[3]); // 1 x 1: the height stops at 1
  assert.equal((await readTexture(gpu, texture, { level: 3 })).length, 4);
});

test('float formats read back as floats, half floats converted', async () => {
  const half = fakeTexture({ format: 'rgba16float', width: 3, height: 2 });
  const halves = Uint16Array.from({ length: 24 }, (_, i) => toHalfFloat(i / 4 - 2));
  half.bytes[0].set(new Uint8Array(halves.buffer));
  assert.deepEqual([...(await readTexture(half.gpu, half.texture))], Array.from({ length: 24 }, (_, i) => i / 4 - 2));
  const full = fakeTexture({ format: 'r32float', width: 3, height: 2 });
  full.bytes[0].set(new Uint8Array(Float32Array.of(1.5, -2, 0.25, 1e6, 0, 3).buffer));
  assert.deepEqual([...(await readTexture(full.gpu, full.texture))], [1.5, -2, 0.25, 1e6, 0, 3]);
});
