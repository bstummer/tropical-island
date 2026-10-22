import * as THREE from 'three';
import { instrument } from './gl-stats.js';

// WebGL2 renderer setup. Drawing-buffer size = CSS size x pixel ratio, where
// pixel ratio = min(devicePixelRatio, preset.maxPixelRatio) x preset.renderScale.
// The context is created here, not by three.js, so gl-stats.js can count every
// call from the first one on.
export function createRenderer({ canvas, quality: preset, capture, fallbackDepth = false }) {
  let quality = preset;
  // The canvas only receives post's output pass (post/frame.js), so it needs no
  // depth and no MSAA. Alpha as three.js would request it.
  const gl = canvas.getContext('webgl2', {
    alpha: true,
    depth: false,
    stencil: false,
    antialias: false,
    premultipliedAlpha: true,
    powerPreference: 'high-performance',
    // Capture mode stops rendering once ready; keep the last frame readable.
    preserveDrawingBuffer: capture,
  });
  if (!gl) throw new Error('WebGL2 is not available.');
  // Every render target holds floats (the HDR scene, the sky's tables); without
  // this, drawing into them fails silently.
  if (!gl.getExtension('EXT_color_buffer_float')) throw new Error('This browser cannot render to float textures (EXT_color_buffer_float).');
  const stats = instrument(gl);

  let renderer;
  try {
    // Reversed depth needs EXT_clip_control; three.js falls back to normal depth
    // without it (renderer.capabilities.reversedDepthBuffer says which), as it
    // does with fallbackDepth.
    renderer = new THREE.WebGLRenderer({ canvas, context: gl, reversedDepthBuffer: !fallbackDepth });
  } catch (err) {
    throw new Error(`WebGL2 is not available: ${err.message}`);
  }
  // three.js clears transparent when the context has alpha; the frame is opaque.
  renderer.setClearAlpha(1);

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
    stats, // see gl-stats.js
    size,
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
