import * as THREE from 'three';

// WebGL2 renderer setup. Drawing-buffer size = CSS size x pixel ratio, where
// pixel ratio = min(devicePixelRatio, preset.maxPixelRatio) x preset.renderScale.
export function createRenderer({ canvas, quality, capture }) {
  let renderer;
  try {
    renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: quality.antialias,
      alpha: false,
      stencil: false,
      powerPreference: 'high-performance',
      // Capture mode stops rendering once ready; keep the last frame readable.
      preserveDrawingBuffer: capture,
    });
  } catch (err) {
    throw new Error(`WebGL2 is not available: ${err.message}`);
  }

  // Linear workflow, sRGB output. Tonemapping belongs to the post pass, not here.
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.NoToneMapping;

  const listeners = new Set();
  const size = { width: 1, height: 1, pixelRatio: 1 };

  function resize() {
    size.width = Math.max(1, canvas.clientWidth || window.innerWidth);
    size.height = Math.max(1, canvas.clientHeight || window.innerHeight);
    size.pixelRatio = Math.min(window.devicePixelRatio || 1, quality.maxPixelRatio) * quality.renderScale;
    renderer.setPixelRatio(size.pixelRatio);
    renderer.setSize(size.width, size.height, false);
    for (const fn of listeners) fn(size);
  }

  window.addEventListener('resize', resize);
  resize();

  return {
    renderer,
    size,
    // fn(size) runs now and after every resize.
    onResize(fn) {
      listeners.add(fn);
      fn(size);
      return () => listeners.delete(fn);
    },
    // Human-readable GL backend, e.g. "ANGLE (NVIDIA, ... Direct3D11 ...)" or "... SwiftShader ...".
    backend() {
      const gl = renderer.getContext();
      const ext = gl.getExtension('WEBGL_debug_renderer_info');
      return ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER);
    },
    dispose() {
      window.removeEventListener('resize', resize);
      listeners.clear();
      renderer.dispose();
    },
  };
}
