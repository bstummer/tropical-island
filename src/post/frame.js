// The frame: everything from the systems' update to the pixels on screen. The
// only place tonemapping happens. In order:
//
//   1. beforeScene passes: the systems' own (shadow maps, lookup tables)
//   2. opaque pass: meshes in pass 'opaque' (every mesh's default) into the
//      HDR target. The sky draws last in it (renderOrder skyOrder), only where
//      nothing else did.
//   3. after-opaque pass: meshes in pass 'afterOpaque' into the same target.
//      They may read the opaque scene through `opaque` (water: the seabed's
//      colour, the depth below the surface): the opaque pass then resolves
//      into a texture of its own, and this one into the HDR target's colour.
//   4. translucent pass: meshes marked with translucent() into a layer of their
//      own, in linear light, depth-tested against everything above.
//   5. composite: scene x the layer's transmittance + the layer, in linear light
//   6. post chain: the addPost() passes, linear HDR in and out (bloom, god rays, grade)
//   7. output pass (output.wgsl): tonemap, sRGB, dither, onto the canvas
//
// Steps 3 to 6 cost nothing in a frame with nothing for them: without
// translucent meshes and post passes the output reads the HDR target directly.
// What no later pass reads (the target's samples once resolved, its depth) is
// not stored, which tile-based GPUs would otherwise write out every frame.
//
// The HDR target holds half-float colour (the compressed, exposed radiance of
// chunks/scene-output.wgsl), with 4 samples, and reversed 32-bit float depth
// (see config.camera). MSAA averages in the compressed space, which keeps dark
// edges against a bright sky anti-aliased; blending does too, which is right
// for coverage but darkens a translucent layer over bright light by stops.
// Hence the translucent pass.
//
// Systems reach it as ctx.frame:
//   size              the drawing buffer, { width, height } in pixels
//   onResize(fn)      fn(size) now and after every resize; returns a remover
//   uniforms          shared by every scene material (chunks/frame.wgsl, bind group 0):
//                     uExposure, the light state that chunks/lighting.wgsl reads and
//                     sky/sky.js keeps in step with the time of day, and the terrain's
//                     grids that chunks/terrain.wgsl reads and world/terrain.js fills
//                     (neutral until then)
//   beforeScene(fn)   fn(renderer) every frame after all systems updated and before
//                     the scene renders, for passes of their own; returns a remover
//   passes            the frame's passes, in the order they draw: a mesh's `pass` is one
//   skyOrder          the sky's renderOrder: after every other opaque mesh
//   translucent(node) puts the meshes under node in the translucent pass and sets up
//                     their materials: blending, no depth writes, and sceneOutput()
//                     writing linear, premultiplied colour. Returns node.
//   opaque            { color, depth }: the opaque scene, resolved, compressed like the HDR target
//                     (sceneRadiance() reads the colour back as radiance times the
//                     exposure, as sceneOutput() takes it) and its depth (one sample
//                     a pixel, texture_depth_2d), for materials of meshes in pass
//                     'afterOpaque' only: a pass can't read what it draws into, so no
//                     other material may bind them.
//   addPost(fn, { order, depth })  fn(renderer, input, output, depth) every frame:
//                     input is a texture of linear, exposed radiance, output a render
//                     target to draw the whole result into, and with `depth` set, depth
//                     is the scene's depth texture, after-opaque meshes included (god
//                     rays need it), else null.
//                     Passes run by `order`, then by when they were added. Returns a remover.
//   sceneTarget       the HDR target
//   output            capture mode only: the output pass's texture, which the canvas shows a copy of
import { Vector2, Vector3, Vector4 } from '../maths/index.js';
import outputShader from './output.wgsl';
import compositeShader from './composite.wgsl';
import depthShader from './depth-resolve.wgsl';
import { Material, TRANSLUCENT_BLEND } from '../gpu/material.js';
import { createTarget } from '../gpu/texture.js';
import { lookup } from '../core/params.js';

const PASSES = ['opaque', 'afterOpaque', 'translucent'];
const SAMPLES = 4; // WebGPU has 1 or 4; the after-opaque pass needs the samples kept apart from what it reads

export function createFrame(ctx, display) {
  const { renderer, scene, camera, config, params } = ctx;
  const { gpu } = renderer;
  const tonemap = params.tonemap ?? config.post.tonemap;
  const tonemapCurve = lookup(config.post.tonemaps, tonemap, 'tonemap', 'Tonemaps');

  const sceneTarget = createTarget(gpu, { name: 'scene', width: 1, height: 1, format: 'rgba16float', samples: SAMPLES, depth: true });
  // The translucent pass's target: linear premultiplied colour, transmittance
  // in alpha. Its depth is the scene's resolved to one sample, which is also
  // what `opaque.depth` and depth posts read.
  const layerTarget = createTarget(gpu, { name: 'layer', width: 1, height: 1, format: 'rgba16float', depth: true });
  // The opaque scene resolved, for after-opaque materials (`opaque.color`).
  const opaqueTarget = createTarget(gpu, { name: 'opaque', width: 1, height: 1, format: 'rgba16float' });
  // Those two exist from the start, for materials to hold, but take the
  // frame's size only once a frame uses them.
  const sized = new Set();
  const sizedTarget = (target) => {
    if (!sized.has(target)) target.setSize(size.width, size.height);
    sized.add(target);
    return target;
  };
  // Created on first use, kept until dispose().
  const postTargets = [null, null]; // linear HDR: the composite's, and the post chain's ping-pong partner
  // Capture mode reads the output back (core/capture.js): it draws into a texture the canvas then copies.
  const outputTarget = params.capture ? createTarget(gpu, { name: 'output', width: 1, height: 1, format: 'rgba8unorm' }) : null;

  const output = renderer.fullscreen(
    new Material({
      name: 'post-output',
      shader: outputShader,
      uniforms: { uScene: { value: sceneTarget.color }, uCompressed: { value: true }, uHeight: { value: 1 } },
      overrides: { TONEMAP: tonemapCurve },
    }),
  );
  const composite = renderer.fullscreen(
    new Material({
      name: 'post-composite',
      shader: compositeShader,
      uniforms: { uScene: { value: sceneTarget.color }, uLayer: { value: null }, uHasLayer: { value: false } },
    }),
  );
  const depthResolve = renderer.fullscreen(
    new Material({ name: 'post-depth-resolve', shader: depthShader, uniforms: { uDepth: { value: sceneTarget.depth } }, colorWrite: false }),
  );
  depthResolve.material.depthWrite = true;

  const size = { width: 1, height: 1 };
  const listeners = new Set();
  const passes = new Set();
  const posts = [];
  let postCount = 0;
  const stopResize = display.onResize(() => {
    ({ width: size.width, height: size.height } = display.buffer);
    for (const target of [sceneTarget, ...postTargets, outputTarget, ...sized]) target?.setSize(size.width, size.height);
    output.uniforms.uHeight.value = size.height;
    for (const fn of listeners) fn(size);
  });

  const hdrTarget = (name) => createTarget(gpu, { name, width: size.width, height: size.height, format: 'rgba16float' });
  // The layer's target as pipelines see it, before it exists.
  const layerSignature = { format: 'rgba16float', samples: 1, depthFormat: 'depth32float' };

  // Which of the optional passes this frame needs.
  function used() {
    let afterOpaque = false;
    let translucent = false;
    for (const mesh of scene.meshes()) {
      afterOpaque ||= mesh.pass === 'afterOpaque';
      translucent ||= mesh.pass === 'translucent';
    }
    return { afterOpaque, translucent };
  }

  const uniforms = {
    uExposure: { value: params.exposure ?? config.post.exposure },
    uSunDirection: { value: new Vector3(0, 1, 0) },
    uSunRadiance: { value: new Vector3() },
    uSkySH: { value: Array.from({ length: 9 }, () => new Vector3()) },
    uLevelLight: { value: new Vector3() },
    uBounceAlbedo: { value: new Vector3(...config.sky.atmosphere.groundAlbedo) },
    // The ground's albedo from above (lighting.wgsl groundAlbedo), which world/terrain.js fills.
    uBounceMap: { value: null },
    uBounceLayout: { value: new Vector4() },
    uSkyView: { value: null },
    uSkyViewSize: { value: new Vector2(1, 1) },
    uSkyViewHeight: { value: 0 },
    uGroundRadius: { value: config.sky.atmosphere.groundRadius },
    uAerial: { value: null },
    uAerialTransmittance: { value: null },
    uAerialSize: { value: new Vector3(1, 1, 1) },
    uAerialRange: { value: config.sky.aerialRange },
    uSunlight: { value: null },
    uSunlightSize: { value: config.sky.tables.sunlight[0] },
    uSunlightTop: { value: config.sky.sunlightTop },
    // The terrain's grids (chunks/terrain.wgsl), which world/terrain.js fills.
    uTerrainHeight: { value: null },
    uTerrainInfo: { value: null },
    uTerrainGround: { value: null },
    uTerrainHeightCoarse: { value: null },
    uTerrainInfoCoarse: { value: null },
    uTerrainGroundCoarse: { value: null },
    uTerrainLevels: { value: config.world.terrain.levels.map(() => new Vector4(0, 0, 1, 2)) },
    uTerrainFrame: { value: new Vector4(1, 0, 0, 1) },
    uTerrainBlend: { value: 1 },
    uTerrainReady: { value: 0 },
  };
  renderer.setGlobals(uniforms);

  // The output pass into its target: the canvas, or in capture mode the output
  // texture, which the canvas then shows a copy of.
  function present() {
    if (!outputTarget) {
      output.render(renderer.canvas());
      return;
    }
    output.render(outputTarget);
    const encoder = gpu.device.createCommandEncoder({ label: 'present' });
    encoder.copyTextureToTexture({ texture: outputTarget.color.texture }, { texture: gpu.context.getCurrentTexture() }, [size.width, size.height]);
    gpu.queue.submit([encoder.finish()]);
  }

  return {
    size,
    uniforms,
    passes: PASSES,
    skyOrder: 1e9,
    sceneTarget,
    opaque: { color: opaqueTarget.color, depth: layerTarget.depth },
    get output() {
      return outputTarget?.color ?? null;
    },
    outputMaterials: [output.material, composite.material, depthResolve.material],
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
    translucent(node) {
      const materials = new Set();
      node.traverse((child) => {
        if (!child.material) return;
        child.pass = 'translucent';
        materials.add(child.material);
      });
      for (const material of materials) {
        Object.assign(material, { transparent: true, depthWrite: false, blend: TRANSLUCENT_BLEND, overrides: { ...material.overrides, SCENE_TRANSLUCENT: true } });
        material.needsUpdate = true;
      }
      return node;
    },
    addPost(fn, { order = 0, depth = false } = {}) {
      const entry = { fn, order, depth, n: postCount++ };
      posts.push(entry);
      posts.sort((a, b) => a.order - b.order || a.n - b.n);
      return () => {
        const i = posts.indexOf(entry);
        if (i >= 0) posts.splice(i, 1);
      };
    },
    // Makes every pipeline the frame will draw with, ahead of the first frame,
    // also for meshes hidden until later. Resolves to the problems found, as
    // "material: message" (capture mode fails on any).
    compile() {
      const outputSignature = outputTarget ?? renderer.canvas();
      return Promise.all([
        renderer.compile(scene, camera, sceneTarget, { pass: 'opaque' }),
        renderer.compile(scene, camera, sceneTarget, { pass: 'afterOpaque' }),
        renderer.compile(scene, camera, layerSignature, { pass: 'translucent' }),
        composite.compile({ format: 'rgba16float', samples: 1 }),
        depthResolve.compile(layerSignature),
        output.compile(outputSignature),
      ]).then((lists) => lists.flat());
    },
    render() {
      // The camera moved since the last frame; passes that cull or follow it
      // (the terrain's nodes, shadow maps) need where it is now, which
      // rendering would only work out after them.
      camera.updateMatrixWorld();
      for (const pass of passes) pass(renderer);
      const use = used();
      const linear = use.translucent || posts.length > 0;
      // The layer hides behind the scene, after-opaque meshes included, and so do depth posts.
      const depthAfter = use.translucent || posts.some((p) => p.depth);
      // The scene's depth so far, one sample a pixel, into the layer's depth.
      // The layer's colour is cleared on the way: nothing in front yet, everything shows through.
      const resolveDepth = () => depthResolve.render(sizedTarget(layerTarget), { clearColor: [0, 0, 0, 1], clearDepth: 0 });

      // The after-opaque pass draws on the opaque pass's samples and depth, and
      // reads the opaque scene resolved into a texture of its own.
      const opaque = use.afterOpaque ? { resolveInto: sizedTarget(opaqueTarget).color } : { keepSamples: false, keepDepth: depthAfter };
      renderer.render(scene, camera, sceneTarget, { pass: 'opaque', clearColor: [0, 0, 0, 1], clearDepth: 0, ...opaque });
      if (use.afterOpaque) {
        resolveDepth();
        renderer.render(scene, camera, sceneTarget, { pass: 'afterOpaque', keepSamples: false, keepDepth: depthAfter });
      }

      if (depthAfter) resolveDepth();
      if (use.translucent) renderer.render(scene, camera, layerTarget, { pass: 'translucent' });

      let input = sceneTarget.color;
      if (linear) {
        postTargets[0] ??= hdrTarget('post');
        if (posts.length) postTargets[1] ??= hdrTarget('post');
        composite.uniforms.uHasLayer.value = use.translucent;
        composite.uniforms.uLayer.value = use.translucent ? layerTarget.color : null;
        composite.render(postTargets[0]);
        let [from, to] = postTargets;
        for (const { fn, depth } of posts) {
          fn(renderer, from.color, to, depth ? layerTarget.depth : null);
          [from, to] = [to, from];
        }
        input = from.color;
      }

      output.uniforms.uScene.value = input;
      output.uniforms.uCompressed.value = !linear;
      present();
    },
    dispose() {
      stopResize();
      listeners.clear();
      passes.clear();
      posts.length = 0;
      for (const target of [sceneTarget, layerTarget, opaqueTarget, ...postTargets, outputTarget]) target?.dispose();
      output.dispose();
      composite.dispose();
      depthResolve.dispose();
    },
  };
}
