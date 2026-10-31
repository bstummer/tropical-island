// What the sea mirrors of what stands over it, from the opaque scene (after
// Cichocki 2017, pixel-projected reflections): a compute pass between the opaque
// scene and the water throws what stands above the sea to where its mirror image
// lies on screen (mirror-project.wgsl), which the water reads (water-land.wgsl). No
// second pass over the land's geometry, so it costs the same however much stands
// there, and it holds whatever the opaque scene draws. What is off the frame it can't
// mirror: the water lets that fade away (config.water.mirror.edge).
//
// createMirror(gpu, groundRadius, stride) -> { cells, across, down, stride, compiled, project(depth, camera), dispose() }:
// cells the GPU buffer of keys, as the material's uniform value, across by down of
// them, made anew as the frame's size changes; stride: pixels a cell, more than asked
// for if a frame has more cells than a key can name.
import { Matrix4 } from '../maths/index.js';
import { createCompute } from '../gpu/compute.js';
import shader from './mirror-project.wgsl';

const UNIFORM_BYTES = 192; // mirror-project.wgsl's Project
const WORKGROUP = 16;
const MOST_CELLS = 2 ** 22; // mirror-project.wgsl's INDEX_BITS

export function createMirror(gpu, groundRadius, wanted) {
  const { device, queue } = gpu;
  const pass = createCompute(gpu, { name: 'water-mirror', shader });
  const uniforms = device.createBuffer({ label: 'water-mirror uniforms', size: UNIFORM_BYTES, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
  const bytes = new ArrayBuffer(UNIFORM_BYTES);
  const floats = new Float32Array(bytes);
  const whole = new Uint32Array(bytes);
  const clip = new Matrix4();

  let cells = null;
  let across = 0;
  let down = 0;
  let stride = wanted;
  let group = null;
  let groupDepth = null;

  return {
    compiled: pass.ready,
    get cells() {
      return cells;
    },
    get across() {
      return across;
    },
    get down() {
      return down;
    },
    get stride() {
      return stride;
    },
    // Throws the opaque scene as its depth (a Texture) now stands.
    project(depth, camera) {
      stride = wanted;
      while (Math.ceil(depth.width / stride) * Math.ceil(depth.height / stride) > MOST_CELLS) stride++;
      const [wide, tall] = [Math.ceil(depth.width / stride), Math.ceil(depth.height / stride)];
      if (wide !== across || tall !== down) {
        [across, down] = [wide, tall];
        cells?.destroy();
        cells = device.createBuffer({ label: 'water-mirror cells', size: 4 * across * down, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST | GPUBufferUsage.COPY_SRC });
        group = null;
      }
      if (group === null || groupDepth !== depth.view) {
        group = pass.group([uniforms, depth.view, cells]);
        groupDepth = depth.view;
      }
      clip.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
      const p = camera.projectionMatrix.elements;
      floats.set(clip.elements, 0);
      floats.set(camera.matrixWorldInverse.elements, 16);
      floats.set([p[0], p[5], p[10], p[14]], 32);
      floats.set([camera.position.x, camera.position.y, camera.position.z, groundRadius], 36);
      floats.set([depth.width, depth.height], 40);
      whole.set([across, down, stride], 42);
      queue.writeBuffer(uniforms, 0, bytes);

      const encoder = device.createCommandEncoder({ label: 'water-mirror' });
      encoder.clearBuffer(cells);
      const compute = encoder.beginComputePass({ label: 'water-mirror' });
      compute.setPipeline(pass.pipeline);
      compute.setBindGroup(0, group);
      compute.dispatchWorkgroups(Math.ceil(across / WORKGROUP), Math.ceil(down / WORKGROUP));
      compute.end();
      queue.submit([encoder.finish()]);
    },
    dispose() {
      cells?.destroy();
      uniforms.destroy();
      pass.dispose();
    },
  };
}
