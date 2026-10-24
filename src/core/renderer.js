import { createDevice } from '../gpu/device.js';
import { createRenderer as createGpuRenderer } from '../gpu/renderer.js';
import { instrument } from './gpu-stats.js';

// The display: the WebGPU device, the renderer (gpu/renderer.js) and the
// canvas's size. Drawing-buffer size = CSS size x pixel ratio, where pixel
// ratio = min(devicePixelRatio, preset.maxPixelRatio) x preset.renderScale.
// onError(err) hears of errors on the GPU that nothing caught (gpu/device.js).
export async function createRenderer({ canvas, quality: preset, capture, onError }) {
  let quality = preset;
  const gpu = await createDevice(canvas, { capture, onError, instrument });
  const renderer = createGpuRenderer(gpu);
  const { stats } = gpu;

  const listeners = new Set();
  const size = { width: 1, height: 1, pixelRatio: 1 };

  function resize() {
    size.width = Math.max(1, canvas.clientWidth || window.innerWidth);
    size.height = Math.max(1, canvas.clientHeight || window.innerHeight);
    size.pixelRatio = Math.min(window.devicePixelRatio || 1, quality.maxPixelRatio) * quality.renderScale;
    // As three.js sized it: the drawing buffer rounds down.
    canvas.width = Math.floor(size.width * size.pixelRatio);
    canvas.height = Math.floor(size.height * size.pixelRatio);
    stats.setCanvas(canvas.width, canvas.height, gpu.canvasFormat);
    for (const fn of listeners) fn(size);
  }

  window.addEventListener('resize', resize);
  resize();

  return {
    gpu,
    renderer,
    stats, // see gpu-stats.js
    size,
    // The drawing buffer in pixels.
    get buffer() {
      return { width: canvas.width, height: canvas.height };
    },
    // fn(size) runs now and after every resize.
    onResize(fn) {
      listeners.add(fn);
      fn(size);
      return () => listeners.delete(fn);
    },
    // A new preset changes the pixel ratio: resizes and tells the listeners.
    setQuality(preset) {
      quality = preset;
      resize();
    },
    // The adapter, e.g. "google swiftshader" or "nvidia turing".
    backend() {
      return gpu.describe();
    },
    dispose() {
      window.removeEventListener('resize', resize);
      listeners.clear();
      renderer.dispose();
      gpu.destroy();
    },
  };
}
