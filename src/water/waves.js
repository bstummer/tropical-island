// The waves on the GPU: water/spectrum.js's waves summed for this moment by
// inverse FFTs in one compute pass (waves-evolve.wgsl, waves-fft.wgsl,
// waves-store.wgsl, waves-mips.wgsl), into one texture array that water.wgsl
// reads, two layers per cascade (waves-store.wgsl). A function of the time
// alone, so a frame at any `t` is the same however it got there; the time wraps
// at the spectrum's loop, before floats lose it, and nothing runs while it
// stands still.
//
// createWaves(ctx, spectrum) -> { texture, compiled, compute(t), dispose() };
// compiled resolves to the problems making its pipelines, as frame.compile() takes them.
import { createCompute } from '../gpu/compute.js';
import { Texture } from '../gpu/texture.js';
import evolveShader from './waves-evolve.wgsl';
import fftShader from './waves-fft.wgsl';
import storeShader from './waves-store.wgsl';
import mipsShader from './waves-mips.wgsl';

const CELL_BYTES = 32; // two vec4f: waves-evolve.wgsl's Cell
const SLOT = 256; // bytes between uniforms in one buffer, as a uniform's offset must align to

export function createWaves(ctx, spectrum) {
  const { gpu } = ctx;
  const { device, queue } = gpu;
  const { size, cascades, loop } = spectrum;
  const stages = Math.log2(size);
  if (!Number.isInteger(stages)) throw new Error(`waves: an FFT of ${size} isn't a power of two`);
  const layers = 2 * cascades.length;

  const texture = new Texture(gpu, {
    name: 'waves',
    width: size,
    height: size,
    depth: layers,
    array: true,
    format: 'rgba16float',
    mips: true,
    storage: true,
    sampler: { mag: 'linear', min: 'linear', mipmap: 'linear', wrap: 'repeat' },
  });

  const buffers = [];
  const buffer = (name, size_, usage, data) => {
    const made = device.createBuffer({ label: name, size: size_, usage });
    buffers.push(made);
    if (data) queue.writeBuffer(made, 0, data);
    return made;
  };
  const STORAGE = GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST;
  const UNIFORM = GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST;

  // e^(2 pi i m / size) for the inverse transform.
  const twiddleData = new Float32Array(size);
  for (let m = 0; m < size / 2; m++) {
    const a = (2 * Math.PI * m) / size;
    twiddleData[2 * m] = Math.cos(a);
    twiddleData[2 * m + 1] = Math.sin(a);
  }
  const twiddles = buffer('waves twiddles', twiddleData.byteLength, STORAGE, twiddleData);

  const perCascade = cascades.map((c) => ({
    amplitudes: buffer('waves amplitudes', c.amplitudes.byteLength, STORAGE, c.amplitudes),
    frequencies: buffer('waves frequencies', c.frequencies.byteLength, STORAGE, c.frequencies),
    cells: [0, 1].map(() => buffer('waves cells', size * size * CELL_BYTES, GPUBufferUsage.STORAGE)),
  }));

  // What changes per step, once: the time each cascade reads, each stage's, and where each stores.
  const evolveUniforms = buffer('waves evolve', SLOT * cascades.length, UNIFORM);
  const stageUniforms = buffer('waves stages', SLOT * 2 * stages, UNIFORM);
  const storeUniforms = buffer('waves store', SLOT * cascades.length, UNIFORM);
  for (let s = 0; s < stages; s++) {
    for (const [axis, horizontal] of [[0, 1], [1, 0]]) {
      queue.writeBuffer(stageUniforms, SLOT * (2 * s + axis), new Uint32Array([size, 2 ** s, horizontal, 0]));
    }
  }
  cascades.forEach((_, c) => queue.writeBuffer(storeUniforms, SLOT * c, new Uint32Array([size, 2 * c, 0, 0])));

  const passes = {
    evolve: createCompute(gpu, { name: 'waves-evolve', shader: evolveShader }),
    fft: createCompute(gpu, { name: 'waves-fft', shader: fftShader }),
    store: createCompute(gpu, { name: 'waves-store', shader: storeShader }),
    mips: createCompute(gpu, { name: 'waves-mips', shader: mipsShader }),
  };
  const compiled = Promise.all(Object.values(passes).map((p) => p.ready)).then((lists) => lists.flat());

  let groups = null;
  const makeGroups = () => {
    const uniform = (target, slot, bytes) => ({ buffer: target, offset: SLOT * slot, size: bytes });
    const mipView = (level) => texture.texture.createView({ dimension: '2d-array', baseMipLevel: level, mipLevelCount: 1 });
    const levels = texture.mipLevelCount;
    const mipsIn = Array.from({ length: levels - 1 }, (_, l) => passes.mips.group([mipView(l), mipView(l + 1)]));
    return {
      perCascade: perCascade.map((p, c) => ({
        evolve: passes.evolve.group([uniform(evolveUniforms, c, 16), p.amplitudes, p.frequencies, p.cells[0]]),
        // Stage by stage, each reading what the last wrote: 2 log2(size) in all, an even
        // number, so the last writes the buffer the store reads.
        fft: Array.from({ length: 2 * stages }, (_, n) => {
          const stage = n < stages ? 2 * n : 2 * (n - stages) + 1; // along rows, then along columns
          return passes.fft.group([uniform(stageUniforms, stage, 16), twiddles, p.cells[n % 2], p.cells[(n + 1) % 2]]);
        }),
        store: passes.store.group([uniform(storeUniforms, c, 16), p.cells[0], mipView(0)]),
      })),
      mips: mipsIn,
    };
  };

  const bytes = new ArrayBuffer(16);
  const numbers = { u: new Uint32Array(bytes), f: new Float32Array(bytes) };
  let last = null;
  const workgroups = (n, per) => Math.ceil(n / per);

  return {
    texture,
    compiled,
    // Sums the waves for time t, unless they stand there already.
    compute(t) {
      const wrapped = t - loop * Math.floor(t / loop);
      if (wrapped === last) return;
      last = wrapped;
      groups ??= makeGroups();
      cascades.forEach((c, n) => {
        numbers.u[0] = size;
        numbers.f[1] = (2 * Math.PI) / c.patch;
        numbers.f[2] = wrapped;
        numbers.f[3] = c.choppy;
        queue.writeBuffer(evolveUniforms, SLOT * n, bytes);
      });
      const encoder = device.createCommandEncoder({ label: 'waves' });
      const pass = encoder.beginComputePass({ label: 'waves' });
      const across = workgroups(size, 16);
      groups.perCascade.forEach((group) => {
        pass.setPipeline(passes.evolve.pipeline);
        pass.setBindGroup(0, group.evolve);
        pass.dispatchWorkgroups(across, across);
        pass.setPipeline(passes.fft.pipeline);
        for (const stage of group.fft) {
          pass.setBindGroup(0, stage);
          pass.dispatchWorkgroups(across, across);
        }
        pass.setPipeline(passes.store.pipeline);
        pass.setBindGroup(0, group.store);
        pass.dispatchWorkgroups(across, across);
      });
      pass.setPipeline(passes.mips.pipeline);
      groups.mips.forEach((group, level) => {
        pass.setBindGroup(0, group);
        const texels = Math.max(1, size >> (level + 1));
        pass.dispatchWorkgroups(workgroups(texels, 8), workgroups(texels, 8));
      });
      pass.end();
      queue.submit([encoder.finish()]);
    },
    dispose() {
      for (const made of buffers) made.destroy();
      texture.destroy();
      for (const p of Object.values(passes)) p.dispose();
    },
  };
}
