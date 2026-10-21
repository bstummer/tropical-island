// The frame: everything from the systems' update to the pixels on screen. The
// only place tonemapping happens. In order:
//
//   1. beforeScene passes: the systems' own (shadow maps, lookup tables)
//   2. opaque pass: objects on layers.opaque (every object's default) into the
//      HDR target. The sky draws last in it (renderOrder skyOrder), only where
//      nothing else did.
//   3. after-opaque pass: objects on layers.afterOpaque into the same target.
//      They may read the opaque scene through `opaque` (water: the seabed's
//      colour, the depth below the surface).
//   4. translucent pass: objects marked with translucent() into a layer of their
//      own, in linear light, depth-tested against everything above.
//   5. composite: scene x the layer's transmittance + the layer, in linear light
//   6. post chain: the addPost() passes, linear HDR in and out (bloom, god rays, grade)
//   7. output pass (output.frag): tonemap, sRGB, dither, onto the canvas
//
// Steps 3 to 6 cost nothing in a frame with nothing for them: without
// translucent objects and post passes the output reads the HDR target directly.
//
// The HDR target holds half-float colour (the compressed, exposed radiance of
// chunks/scene-output.glsl), with quality.msaa samples, and 32-bit float depth.
// The depth is reversed (see config.camera) when the browser supports it.
// MSAA averages in the compressed space, which keeps dark edges against a bright
// sky anti-aliased; blending does too, which is right for coverage but darkens
// a translucent layer over bright light by stops. Hence the translucent pass.
//
// Systems reach it as ctx.frame:
//   size              the drawing buffer, { width, height } in pixels
//   onResize(fn)      fn(size) now and after every resize; returns a remover
//   uniforms          shared by every scene material: uExposure, and the light state
//                     that chunks/lighting.glsl reads and sky/sky.js keeps in step with
//                     the time of day (neutral until then)
//   beforeScene(fn)   fn(renderer) every frame after all systems updated and before
//                     the scene renders, for passes of their own; returns a remover
//   layers            { opaque, afterOpaque, translucent }: object.layers.set(...)
//                     picks an object's pass (translucent() sets it for that one)
//   skyOrder          the sky's renderOrder: after every other opaque object
//   translucent(obj)  puts obj, and everything under it, in the translucent pass and
//                     sets up their materials: blending, no depth writes, and
//                     sceneOutput() writing linear, premultiplied colour. Returns obj.
//   opaque            { color, depth }: the opaque scene, compressed like the HDR target
//                     (read the colour with sceneRadiance()) and its depth, for objects
//                     on layers.afterOpaque. Valid only during that pass.
//   addPost(fn, { order, depth })  fn(renderer, input, output, depth) every frame:
//                     input is a texture of linear, exposed radiance, output a render
//                     target to draw the whole result into, and with `depth` set, depth
//                     is the opaque scene's depth texture (god rays need it). Passes run
//                     by `order`, then by when they were added. Returns a remover.
//   sceneTarget       the HDR target
//   outputScene       the output pass, for the dev shader hot-swap
import * as THREE from 'three';
import vertexShader from './output.vert';
import fragmentShader from './output.frag';
import compositeShader from './composite.frag';
import { createFullscreen } from './fullscreen.js';

const LAYERS = { opaque: 0, afterOpaque: 1, translucent: 2 };
const PASS_LAYERS = [LAYERS.opaque, LAYERS.afterOpaque, LAYERS.translucent];

export function createFrame(ctx, display) {
  const { renderer, scene, camera, config, quality, params } = ctx;
  const tonemap = params.tonemap ?? config.post.tonemap;
  if (!config.post.tonemaps[tonemap]) {
    throw new Error(`Unknown tonemap "${tonemap}". Tonemaps: ${Object.keys(config.post.tonemaps).join(', ')}`);
  }

  const sceneTarget = new THREE.WebGLRenderTarget(1, 1, {
    type: THREE.HalfFloatType,
    samples: quality.msaa,
    // A float depth texture is what makes three.js give MSAA a 32-bit float depth
    // buffer. Copying the depth out costs bandwidth every frame, so it stays
    // off until a pass reads it.
    depthTexture: new THREE.DepthTexture(1, 1, THREE.FloatType),
    resolveDepthBuffer: false,
  });

  // Created on first use, kept until dispose().
  let layerTarget = null; // the translucent pass: linear premultiplied colour, transmittance in alpha
  const postTargets = [null, null]; // linear HDR: the composite's, and the post chain's ping-pong partner

  const output = createFullscreen(
    new THREE.ShaderMaterial({
      name: 'post-output',
      vertexShader,
      fragmentShader,
      uniforms: { uScene: { value: sceneTarget.texture }, uCompressed: { value: true } },
      defines: { TONEMAP: config.post.tonemaps[tonemap] },
    }),
  );
  const composite = createFullscreen(
    new THREE.ShaderMaterial({
      name: 'post-composite',
      vertexShader,
      fragmentShader: compositeShader,
      uniforms: { uScene: { value: sceneTarget.texture }, uLayer: { value: null }, uHasLayer: { value: false } },
    }),
  );

  const size = { width: 1, height: 1 };
  const listeners = new Set();
  const passes = new Set();
  const posts = [];
  let postCount = 0;
  let postDepth = 0; // post passes that read the depth
  const stopResize = display.onResize(() => {
    const buffer = renderer.getDrawingBufferSize(new THREE.Vector2());
    size.width = buffer.x;
    size.height = buffer.y;
    for (const target of [sceneTarget, layerTarget, ...postTargets]) target?.setSize(size.width, size.height);
    for (const fn of listeners) fn(size);
  });

  function hdrTarget(depth) {
    return new THREE.WebGLRenderTarget(size.width, size.height, {
      type: THREE.HalfFloatType,
      depthBuffer: depth,
      depthTexture: depth ? new THREE.DepthTexture(size.width, size.height, THREE.FloatType) : null,
    });
  }

  // Which of the optional passes this frame needs.
  function used() {
    let afterOpaque = false;
    let translucent = false;
    scene.traverseVisible((object) => {
      if (!(object.isMesh || object.isPoints || object.isLine || object.isSprite)) return;
      afterOpaque ||= object.layers.isEnabled(LAYERS.afterOpaque);
      translucent ||= object.layers.isEnabled(LAYERS.translucent);
    });
    return { afterOpaque, translucent };
  }

  function drawLayer(layer) {
    camera.layers.set(layer);
    renderer.render(scene, camera);
  }

  const clearColor = new THREE.Color();
  function clear(target, color, alpha, depth) {
    renderer.getClearColor(clearColor);
    const clearAlpha = renderer.getClearAlpha();
    renderer.setRenderTarget(target);
    renderer.setClearColor(color, alpha);
    renderer.clear(true, depth, false);
    renderer.setClearColor(clearColor, clearAlpha);
  }

  return {
    size,
    uniforms: {
      uExposure: { value: params.exposure ?? config.post.exposure },
      uSunDirection: { value: new THREE.Vector3(0, 1, 0) },
      uSunRadiance: { value: new THREE.Vector3() },
      uSkySH: { value: Array.from({ length: 9 }, () => new THREE.Vector3()) },
      uSkyView: { value: null },
      uSkyViewSize: { value: new THREE.Vector2(1, 1) },
      uSkyViewHeight: { value: 0 },
      uGroundRadius: { value: config.sky.atmosphere.groundRadius },
      uAerial: { value: null },
      uAerialSize: { value: new THREE.Vector3(1, 1, 1) },
      uAerialRange: { value: config.sky.aerialRange },
    },
    layers: LAYERS,
    skyOrder: 1e9,
    sceneTarget,
    opaque: { color: sceneTarget.texture, depth: sceneTarget.depthTexture },
    outputScene: output.scene,
    tonemap,
    // The frame's passes as camera layers, in the order they draw (overdraw.js counts them so).
    passLayers: PASS_LAYERS,
    onResize(fn) {
      listeners.add(fn);
      fn(size);
      return () => listeners.delete(fn);
    },
    beforeScene(fn) {
      passes.add(fn);
      return () => passes.delete(fn);
    },
    translucent(object) {
      const materials = new Set();
      object.traverse((node) => {
        node.layers.set(LAYERS.translucent);
        for (const material of [].concat(node.material ?? [])) materials.add(material);
      });
      for (const material of materials) {
        // Premultiplied "over", back to front (three.js sorts transparent objects
        // so): colour = src + dst x (1 - a), and alpha keeps the product of the
        // layers' (1 - a), the share of the scene that shows through.
        Object.assign(material, {
          transparent: true,
          depthWrite: false,
          blending: THREE.CustomBlending,
          blendEquation: THREE.AddEquation,
          blendSrc: THREE.OneFactor,
          blendDst: THREE.OneMinusSrcAlphaFactor,
          blendSrcAlpha: THREE.ZeroFactor,
          blendDstAlpha: THREE.OneMinusSrcAlphaFactor,
          defines: { ...material.defines, SCENE_TRANSLUCENT: '' },
          needsUpdate: true,
        });
      }
      return object;
    },
    addPost(fn, { order = 0, depth = false } = {}) {
      const entry = { fn, order, n: postCount++ };
      posts.push(entry);
      posts.sort((a, b) => a.order - b.order || a.n - b.n);
      if (depth) postDepth++;
      return () => {
        const i = posts.indexOf(entry);
        if (i < 0) return;
        posts.splice(i, 1);
        if (depth) postDepth--;
      };
    },
    // Compiles every shader ahead of the first frame. Scene shaders compile for
    // the HDR target: three.js builds different programs for the canvas.
    compile() {
      renderer.setRenderTarget(sceneTarget);
      renderer.compile(scene, camera);
      composite.compile(renderer, sceneTarget);
      output.compile(renderer, null);
    },
    render() {
      for (const pass of passes) pass(renderer);
      const use = used();
      const linear = use.translucent || posts.length > 0;
      const autoClear = renderer.autoClear;
      const layers = camera.layers.mask;
      renderer.autoClear = false;
      sceneTarget.resolveDepthBuffer = use.afterOpaque || use.translucent || postDepth > 0;

      clear(sceneTarget, 0x000000, 1, true);
      drawLayer(LAYERS.opaque);
      if (use.afterOpaque) drawLayer(LAYERS.afterOpaque);

      if (use.translucent) {
        layerTarget ??= hdrTarget(true);
        clear(layerTarget, 0x000000, 1, false); // nothing in front yet: everything shows through
        // The scene's depth, so the layer hides behind it. Copied after the clear,
        // which allocates the target on first use; the copy unbinds it.
        renderer.copyTextureToTexture(sceneTarget.depthTexture, layerTarget.depthTexture);
        renderer.setRenderTarget(layerTarget);
        drawLayer(LAYERS.translucent);
      }
      camera.layers.mask = layers;

      let input = sceneTarget.texture;
      if (linear) {
        postTargets[0] ??= hdrTarget(false);
        if (posts.length) postTargets[1] ??= hdrTarget(false);
        composite.uniforms.uHasLayer.value = use.translucent;
        composite.uniforms.uLayer.value = use.translucent ? layerTarget.texture : null;
        composite.render(renderer, postTargets[0]);
        let [from, to] = postTargets;
        for (const { fn } of posts) {
          fn(renderer, from.texture, to, sceneTarget.depthTexture);
          [from, to] = [to, from];
        }
        input = from.texture;
      }

      output.uniforms.uScene.value = input;
      output.uniforms.uCompressed.value = !linear;
      output.render(renderer, null);
      renderer.autoClear = autoClear;
    },
    dispose() {
      stopResize();
      listeners.clear();
      passes.clear();
      posts.length = 0;
      for (const target of [sceneTarget, layerTarget, ...postTargets]) {
        target?.depthTexture?.dispose();
        target?.dispose();
      }
      output.dispose();
      composite.dispose();
    },
  };
}
