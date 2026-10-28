// Texture.read (texture.js): the rectangle is copied into a buffer whose rows
// are padded to 256 bytes, as copyTextureToBuffer wants them, then packed
// tight. Apart from texture.js, which imports a shader, so
// tests/readback.test.js runs it on a fake device.
import { fromHalfFloat } from '../maths/index.js';
import { bytesPerTexel } from '../core/gpu-stats.js';

export async function readTexture(gpu, texture, { x = 0, y = 0, width, height, layer = 0, level = 0 } = {}) {
  width ??= Math.max(1, texture.width >> level);
  height ??= Math.max(1, texture.height >> level);
  const texel = bytesPerTexel(texture.format);
  const rowBytes = width * texel;
  const bytesPerRow = Math.ceil(rowBytes / 256) * 256;
  const { device, queue } = gpu;
  const buffer = device.createBuffer({ label: `read ${texture.name}`, size: bytesPerRow * height, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ });
  const encoder = device.createCommandEncoder();
  encoder.copyTextureToBuffer({ texture: texture.texture, mipLevel: level, origin: [x, y, layer] }, { buffer, bytesPerRow, rowsPerImage: height }, [width, height, 1]);
  queue.submit([encoder.finish()]);
  try {
    await buffer.mapAsync(GPUMapMode.READ);
    const mapped = new Uint8Array(buffer.getMappedRange());
    const packed = new Uint8Array(rowBytes * height);
    for (let row = 0; row < height; row++) packed.set(mapped.subarray(row * bytesPerRow, row * bytesPerRow + rowBytes), row * rowBytes);
    buffer.unmap();
    if (texture.format.endsWith('8unorm')) return packed;
    if (texture.format.includes('16float')) return Float32Array.from(new Uint16Array(packed.buffer), fromHalfFloat);
    return new Float32Array(packed.buffer);
  } finally {
    buffer.destroy();
  }
}
