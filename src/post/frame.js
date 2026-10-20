// The frame: everything from the systems' update to the pixels on screen. The
// scene renders into an HDR target, then the output pass (output.frag) turns it
// into the picture on the canvas. The only place tonemapping happens.
//
// The HDR target holds half-float colour (the compressed, exposed radiance of
// chunks/scene-output.glsl), with quality.msaa samples, and 32-bit float depth.
// The depth is reversed (see config.camera) when the browser supports it.
//
// Systems reach it as ctx.frame:
//   size              the drawing buffer, { width, height } in pixels
//   onResize(fn)      fn(size) now and after every resize; returns a remover
//   uniforms          shared by every scene material: { uExposure }
//   beforeScene(fn)   fn(renderer) every frame after all systems updated and before
//                     the scene renders, for passes of their own (shadow maps,
//                     reflections); returns a remover
//   sceneTarget       the HDR target; sceneTarget.depthTexture holds the resolved depth
//   outputScene       the output pass, for the dev shader hot-swap
import * as THREE from 'three';
import vertexShader from './output.vert';
import fragmentShader from './output.frag';

export function createFrame(ctx, display) {
  const { renderer, scene, camera, config, quality, params } = ctx;
  const tonemap = params.tonemap ?? config.post.tonemap;
  if (!config.post.tonemaps[tonemap]) {
    throw new Error(`Unknown tonemap "${tonemap}". Tonemaps: ${Object.keys(config.post.tonemaps).join(', ')}`);
  }

  const sceneTarget = new THREE.WebGLRenderTarget(1, 1, {
    type: THREE.HalfFloatType,
    samples: quality.msaa,
    depthTexture: new THREE.DepthTexture(1, 1, THREE.FloatType),
  });

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute([-1, -1, 0, 3, -1, 0, -1, 3, 0], 3));
  const output = new THREE.Mesh(
    geometry,
    new THREE.ShaderMaterial({
      name: 'post-output',
      vertexShader,
      fragmentShader,
      uniforms: { uScene: { value: sceneTarget.texture } },
      defines: { TONEMAP: config.post.tonemaps[tonemap] },
      depthTest: false,
      depthWrite: false,
    }),
  );
  output.frustumCulled = false;
  const outputScene = new THREE.Scene();
  outputScene.add(output);
  const outputCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);

  const size = { width: 1, height: 1 };
  const listeners = new Set();
  const passes = new Set();
  const stopResize = display.onResize(() => {
    const buffer = renderer.getDrawingBufferSize(new THREE.Vector2());
    size.width = buffer.x;
    size.height = buffer.y;
    sceneTarget.setSize(size.width, size.height);
    for (const fn of listeners) fn(size);
  });

  return {
    size,
    uniforms: { uExposure: { value: config.post.exposure } },
    sceneTarget,
    outputScene,
    tonemap,
    onResize(fn) {
      listeners.add(fn);
      fn(size);
      return () => listeners.delete(fn);
    },
    beforeScene(fn) {
      passes.add(fn);
      return () => passes.delete(fn);
    },
    // Compiles every shader ahead of the first frame. Scene shaders compile for
    // the HDR target: three.js builds different programs for the canvas.
    compile() {
      renderer.setRenderTarget(sceneTarget);
      renderer.compile(scene, camera);
      renderer.setRenderTarget(null);
      renderer.compile(outputScene, outputCamera);
    },
    render() {
      for (const pass of passes) pass(renderer);
      renderer.setRenderTarget(sceneTarget);
      renderer.render(scene, camera);
      renderer.setRenderTarget(null);
      renderer.render(outputScene, outputCamera);
    },
    dispose() {
      stopResize();
      listeners.clear();
      passes.clear();
      sceneTarget.depthTexture.dispose();
      sceneTarget.dispose();
      geometry.dispose();
      output.material.dispose();
    },
  };
}
