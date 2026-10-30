// Textures and render targets. A Texture keeps its identity when it is resized
// (its GPU texture is replaced and `version` counts up), so materials can hold
// it as a uniform's value, as three.js's textures were held. Its sampler
// travels with it: a binding `<name>Sampler` beside `<name>` gets it.
//
// A render target (createTarget) is the textures one pass draws into: colour
// (with samples > 1, drawn multisampled and resolved into `color`, which is
// what others read) and optionally depth.
import { bytesPerTexel } from '../core/gpu-stats.js';
import { readTexture } from './readback.js';
import mipmapShader from './mipmap.wgsl';

let nextUid = 0;

const USAGE = () => GPUTextureUsage;

export class Texture {
  // width, height; depth: layers of an array, or the depth of a 3D texture;
  // dimension '2d' or '3d'; array: a 2D array (also with one layer); format;
  // mips: true for a full mip chain, or how many levels; samples; render: drawn into; data: uploaded into
  // (also when mipmaps are drawn); storage: a compute pass writes it; sampler: { mag, min, mipmap, wrap, anisotropy, compare } (device.js).
  constructor(gpu, { name = 'texture', width, height = 1, depth = 1, dimension = '2d', array = false, format = 'rgba8unorm', mips = false, samples = 1, render = false, data = false, storage = false, sampler = {} }) {
    Object.assign(this, { gpu, name, width, height, depth, dimension, array, format, samples, render, data, storage });
    this.uid = nextUid++;
    this.version = 0;
    this.mips = mips;
    this.sampler = { mipmap: mips ? 'linear' : 'nearest', ...sampler };
    this.viewDimension = dimension === '3d' ? '3d' : array ? '2d-array' : '2d';
    this.isDepth = format.startsWith('depth');
    this.create();
  }

  get mipLevelCount() {
    if (!this.mips) return 1;
    const largest = Math.max(this.width, this.height, this.dimension === '3d' ? this.depth : 1);
    const full = Math.floor(Math.log2(largest)) + 1;
    return this.mips === true ? full : Math.min(this.mips, full);
  }

  create() {
    const U = USAGE();
    let usage = U.COPY_SRC;
    if (this.samples === 1) usage |= U.TEXTURE_BINDING;
    if (this.samples > 1 && this.isDepth) usage |= U.TEXTURE_BINDING; // the after-opaque pass reads the opaque scene's depth
    if (this.render || (this.mips && !this.storage)) usage |= U.RENDER_ATTACHMENT;
    if (this.data) usage |= U.COPY_DST;
    if (this.storage) usage |= U.STORAGE_BINDING;
    this.texture = this.gpu.device.createTexture({
      label: this.name,
      size: [this.width, this.height, this.depth],
      dimension: this.dimension,
      format: this.format,
      mipLevelCount: this.mipLevelCount,
      sampleCount: this.samples,
      usage,
    });
    this.view = this.texture.createView({ label: this.name, dimension: this.viewDimension });
  }

  // A view of one mip level of one layer (array) or of the whole level (3D), to draw into.
  attachment(layer = 0, level = 0) {
    if (this.dimension === '3d') return { view: this.texture.createView({ dimension: '3d', baseMipLevel: level, mipLevelCount: 1 }), depthSlice: layer };
    return { view: this.texture.createView({ dimension: '2d', baseArrayLayer: layer, arrayLayerCount: 1, baseMipLevel: level, mipLevelCount: 1 }) };
  }

  // Uploads `data` (a typed array of the format's texels, tightly packed) into
  // `layers` layers from `layer`, at mip level 0. Half floats come as Uint16Array.
  upload(data, { layer = 0, layers = this.depth } = {}) {
    const bytesPerRow = this.width * bytesPerTexel(this.format);
    this.gpu.queue.writeTexture(
      { texture: this.texture, origin: [0, 0, layer] },
      data,
      { bytesPerRow, rowsPerImage: this.height },
      [this.width, this.height, layers],
    );
    return this;
  }

  // Fills mip levels 1 and up from level 0, each texel the average of the four
  // under it (a box filter, as WebGL's generateMipmap), layer by layer.
  generateMipmaps() {
    if (this.mipLevelCount > 1) generateMipmaps(this.gpu, this);
    return this;
  }

  resize(width, height) {
    if (width === this.width && height === this.height) return;
    this.texture.destroy();
    this.width = width;
    this.height = height;
    this.create();
    this.version++;
  }

  destroy() {
    this.texture?.destroy();
    this.texture = null;
  }

  // Reads a rectangle { x, y, width, height } of one layer of mip level `level`
  // back, the whole level by default: a Uint8Array for 8-bit formats, else a
  // Float32Array (half floats converted). Rows from the texture's first.
  read(region) {
    return readTexture(this.gpu, this, region);
  }
}

// What a pipeline drawing into a target must know of it.
export function signature({ format, samples, depthFormat }) {
  return `${format ?? 'none'}x${samples}${depthFormat ? `+${depthFormat}` : ''}`;
}

// A render target: { width, height, samples, format, depthFormat, color, msaa,
// depth, setSize(w, h), dispose() }. depth: a depth buffer with the colour's
// samples; layers with array or dimension '3d'. With `format` null, depth
// alone (a shadow map), its layers with array, filtered by `depthSampler`.
export function createTarget(gpu, { name = 'target', width, height, format = 'rgba16float', samples = 1, depth = false, layers = 1, array = false, dimension = '2d', mips = false, sampler = {}, depthSampler = { mag: 'nearest', min: 'nearest' } }) {
  const color = format ? new Texture(gpu, { name, width, height, depth: layers, array, dimension, format, mips, render: true, sampler }) : null;
  const msaa = format && samples > 1 ? new Texture(gpu, { name: `${name} samples`, width, height, format, samples, render: true }) : null;
  const depthLayers = format ? { depth: 1 } : { depth: layers, array };
  const depthTexture = depth ? new Texture(gpu, { name: `${name} depth`, width, height, ...depthLayers, format: 'depth32float', samples, render: true, sampler: depthSampler }) : null;
  const main = color ?? depthTexture;
  return {
    name,
    get width() {
      return main.width;
    },
    get height() {
      return main.height;
    },
    samples,
    format,
    depthFormat: depth ? 'depth32float' : null,
    layers,
    color,
    msaa,
    depth: depthTexture,
    setSize(w, h) {
      for (const t of [color, msaa, depthTexture]) t?.resize(w, h);
    },
    dispose() {
      for (const t of [color, msaa, depthTexture]) t?.destroy();
    },
  };
}

// ---------------------------------------------------------------- mipmaps

const mipPipelines = new WeakMap(); // device -> Map(format -> pipeline)

function generateMipmaps(gpu, texture) {
  const { device } = gpu;
  if (texture.dimension === '3d') throw new Error(`texture ${texture.name}: mipmaps of 3D textures aren't made`);
  if (!mipPipelines.has(device)) mipPipelines.set(device, new Map());
  const pipelines = mipPipelines.get(device);
  if (!pipelines.has(texture.format)) {
    const module = device.createShaderModule({ label: 'mipmap', code: mipmapShader });
    const constants = { UNORM8: Number(texture.format === 'rgba8unorm') };
    pipelines.set(
      texture.format,
      device.createRenderPipeline({
        label: `mipmap ${texture.format}`,
        layout: 'auto',
        vertex: { module, entryPoint: 'vertexMain' },
        fragment: { module, entryPoint: 'fragmentMain', targets: [{ format: texture.format }], constants },
        primitive: { topology: 'triangle-list' },
      }),
    );
  }
  const pipeline = pipelines.get(texture.format);
  const encoder = device.createCommandEncoder({ label: `mipmaps ${texture.name}` });
  for (let layer = 0; layer < texture.depth; layer++) {
    for (let level = 1; level < texture.mipLevelCount; level++) {
      const source = texture.texture.createView({ dimension: '2d', baseArrayLayer: layer, arrayLayerCount: 1, baseMipLevel: level - 1, mipLevelCount: 1 });
      const group = device.createBindGroup({ layout: pipeline.getBindGroupLayout(0), entries: [{ binding: 0, resource: source }] });
      const pass = encoder.beginRenderPass({ colorAttachments: [{ ...texture.attachment(layer, level), loadOp: 'clear', clearValue: [0, 0, 0, 0], storeOp: 'store' }] });
      pass.setPipeline(pipeline);
      pass.setBindGroup(0, group);
      pass.draw(3);
      pass.end();
    }
  }
  gpu.queue.submit([encoder.finish()]);
}
