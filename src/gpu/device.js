// The WebGPU device and what everything drawn with it shares: the canvas,
// error reporting, and caches of samplers, bind group layouts and shader
// modules. One per page (core/renderer.js creates it).
//
// Errors: validation errors nothing caught, a lost device and shader modules
// that don't compile go to onError, which stops the game (main.js) or fails
// the capture. The device is lost on purpose only by destroy().

const GPU_ERROR_NOTE =
  'This game needs WebGPU: a recent Chrome or Edge, Firefox 141 or later on Windows, or Safari 26. ' +
  'If your browser has it, it may be turned off or your graphics driver blocked.';

const DEFAULT_SAMPLER = {}; // linear, no mipmaps, clamped (sampler())

// Thrown when the browser has no WebGPU: main.js shows it as it is.
export class NeedsWebGPU extends Error {
  constructor(detail) {
    super(`${GPU_ERROR_NOTE}${detail ? `\n\n(${detail})` : ''}`);
    this.name = 'NeedsWebGPU';
  }
}

// `capture`: the canvas only shows a copy of the output (core/capture.js reads
// the output texture itself), in a format the readback knows.
export async function createDevice(canvas, { capture, onError, instrument }) {
  if (!navigator.gpu) throw new NeedsWebGPU('navigator.gpu is missing');
  const adapter = await navigator.gpu.requestAdapter({ powerPreference: 'high-performance' });
  if (!adapter) throw new NeedsWebGPU('no WebGPU adapter');
  // Optional features only: core WebGPU is the target (PLAN.md Stage 4b).
  const features = ['timestamp-query'].filter((f) => adapter.features.has(f));
  let device;
  try {
    device = await adapter.requestDevice({ requiredFeatures: features });
  } catch (err) {
    throw new NeedsWebGPU(`requestDevice failed: ${err.message}`);
  }
  let destroyed = false;
  device.addEventListener('uncapturederror', (e) => onError(new Error(`WebGPU error: ${e.error.message}`)));
  device.lost.then((info) => {
    if (!destroyed) onError(new Error(`The GPU device was lost (${info.reason || 'unknown'}): ${info.message}`));
  });
  const stats = instrument(device);

  const context = canvas.getContext('webgpu');
  if (!context) throw new NeedsWebGPU('the canvas has no webgpu context');
  const canvasFormat = capture ? 'rgba8unorm' : navigator.gpu.getPreferredCanvasFormat();
  context.configure({
    device,
    format: canvasFormat,
    alphaMode: 'opaque',
    usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_DST,
  });

  const samplers = new Map();
  const layouts = new Map();
  const modules = new Map();
  const placeholders = new Map();
  const samplersOf = new WeakMap(); // descriptor object -> sampler
  function samplerFor({ mag = 'linear', min = 'linear', mipmap = 'nearest', wrap = 'clamp-to-edge', anisotropy = 1 }) {
    const key = `${mag}/${min}/${mipmap}/${wrap}/${anisotropy}`;
    if (!samplers.has(key)) {
      samplers.set(
        key,
        device.createSampler({
          label: key,
          magFilter: mag,
          minFilter: min,
          mipmapFilter: mipmap,
          addressModeU: wrap,
          addressModeV: wrap,
          addressModeW: wrap,
          maxAnisotropy: anisotropy,
        }),
      );
    }
    return samplers.get(key);
  }
  const emptyLayout = device.createBindGroupLayout({ label: 'empty', entries: [] });
  const emptyGroup = device.createBindGroup({ label: 'empty', layout: emptyLayout, entries: [] });

  const gpu = {
    adapter,
    device,
    queue: device.queue,
    context,
    canvas,
    canvasFormat,
    stats,
    timestamps: features.includes('timestamp-query'),
    emptyLayout,
    emptyGroup,
    // "vendor architecture description", e.g. "google swiftshader" or "nvidia turing".
    describe() {
      const { vendor, architecture, device: name, description } = adapter.info ?? {};
      return [vendor, architecture, name, description].filter(Boolean).join(' ') || 'unknown adapter';
    },
    get software() {
      return /swiftshader|llvmpipe|software|basic render|warp/i.test(gpu.describe()) || Boolean(adapter.info?.isFallbackAdapter);
    },
    // A sampler per descriptor: { mag, min, mipmap: 'linear'|'nearest', wrap: 'clamp-to-edge'|'repeat'|'mirror-repeat', anisotropy }.
    // A descriptor object asked for again (a texture's, every frame) is found by its identity.
    sampler(descriptor = DEFAULT_SAMPLER) {
      let sampler = samplersOf.get(descriptor);
      if (!sampler) samplersOf.set(descriptor, (sampler = samplerFor(descriptor)));
      return sampler;
    },
    // A bind group layout per list of entries, so equal declarations share one.
    layout(entries) {
      if (!entries.length) return emptyLayout;
      const key = JSON.stringify(entries);
      if (!layouts.has(key)) layouts.set(key, device.createBindGroupLayout({ entries }));
      return layouts.get(key);
    },
    // A shader module per source, counted by its users: { module, compiled } where
    // compiled resolves to the compiler's error messages (empty when it compiled).
    module(source, label) {
      let entry = modules.get(source);
      if (!entry) {
        // A module that doesn't compile reports its messages through `compiled`
        // and onError, rather than as the bare error nothing caught.
        device.pushErrorScope('validation');
        const module = device.createShaderModule({ label, code: source });
        const scoped = device.popErrorScope();
        const compiled = Promise.all([module.getCompilationInfo(), scoped]).then(([info, error]) => {
          const messages = info.messages.filter((m) => m.type === 'error').map((m) => `line ${m.lineNum}:${m.linePos} ${m.message}`);
          return messages.length || !error ? messages : [error.message];
        });
        compiled.then((messages) => messages.length && onError(new Error(`shader compile failed: ${label}: ${messages.join('; ')}`)));
        entry = { module, compiled, users: 0 };
        modules.set(source, entry);
      }
      entry.users++;
      return entry;
    },
    releaseModule(source) {
      const entry = modules.get(source);
      if (entry && --entry.users <= 0) modules.delete(source);
    },
    get liveModules() {
      return modules.size;
    },
    // A 1 x 1 texture of zeros standing in for a binding with no texture yet, by
    // its WGSL type, in a format of the sample type the binding's layout says
    // (bindings.js layoutEntry). (WebGL's unset texture read alpha 1: shaders guard such reads.)
    placeholder(type) {
      if (!placeholders.has(type)) {
        const depth = type.startsWith('texture_depth');
        const multisampled = type.includes('multisampled');
        const dimension = type.includes('3d') ? '3d' : '2d';
        const integer = /<i32>/.test(type) ? 'rgba8sint' : /<u32>/.test(type) ? 'rgba8uint' : null;
        const texture = stats.untracked(() =>
          device.createTexture({
            label: `placeholder ${type}`,
            size: [1, 1, 1],
            dimension,
            format: depth ? 'depth32float' : (integer ?? (multisampled ? 'rgba16float' : 'rgba8unorm')),
            sampleCount: multisampled ? 4 : 1,
            usage: GPUTextureUsage.TEXTURE_BINDING | (multisampled || depth ? GPUTextureUsage.RENDER_ATTACHMENT : GPUTextureUsage.COPY_DST),
          }),
        );
        const view = texture.createView({ dimension: type.includes('array') ? '2d-array' : dimension });
        placeholders.set(type, { texture, view });
      }
      return placeholders.get(type).view;
    },
    // Placeholders and the caches stay with the device for the page's life:
    // a quality change keeps them, so teardown checks see them before and after.
    destroy() {
      destroyed = true;
      for (const { texture } of placeholders.values()) texture.destroy();
      device.destroy();
    },
  };
  return gpu;
}
