// A compute pipeline with its layout taken from the shader (`layout: 'auto'`):
// { pipeline, group(entries), ready, dispose() }. The shader goes through the
// device's cache of modules, so a compile error reaches the error overlay (and
// fails a capture) as a render pipeline's does. Made in the background; `ready`
// resolves to the problems, as "name: message", once it is made. Each group's
// entries: [resource, ...] for the bindings 0, 1, 2...: a GPUBuffer as its whole
// range, a view or sampler as it is. No uniforms by name: a compute pass here is
// a few fixed steps its system knows, not a material.
export function createCompute(gpu, { name, shader, entry = 'main', constants = {} }) {
  const { device } = gpu;
  const { module, compiled } = gpu.module(shader, name);
  let pipeline = null;
  const ready = Promise.all([
    compiled,
    device.createComputePipelineAsync({ label: name, layout: 'auto', compute: { module, entryPoint: entry, constants } }).then(
      (made) => {
        pipeline = made;
        return null;
      },
      (err) => err.message,
    ),
  ]).then(([errors, error]) => [...errors, ...(error ? [error] : [])].map((message) => `${name}: ${message}`));
  return {
    ready,
    get pipeline() {
      return pipeline;
    },
    group(entries) {
      return device.createBindGroup({
        label: name,
        layout: pipeline.getBindGroupLayout(0),
        entries: entries.map((resource, binding) => ({ binding, resource: resource instanceof GPUBuffer ? { buffer: resource } : resource })),
      });
    },
    dispose() {
      gpu.releaseModule(shader);
    },
  };
}
