// Draws meshes into render targets, the way three.js's WebGLRenderer did for
// this game: one call draws one pass (encoded and submitted at once, so
// uniforms set between calls apply to the calls after), with three.js's frustum
// culling and draw order. Pipelines are made per material, target and vertex
// layout on first use, or ahead with compile(); bind groups as material.js says.
// A pass packs each material's uniforms once, and the frame's (group 0) only
// if something in it binds them.
//
//   render(scene, camera, target, { pass, clearColor, clearDepth, layer, level, resolve, resolveInto, keepSamples, keepDepth, viewport })
//       scene: a Scene (its meshes in `pass`, or all) or a list of meshes; camera:
//       core/camera.js's, or null for passes that need none; target: createTarget's,
//       or canvas(); clearColor [r, g, b, a] and clearDepth clear first, else it
//       draws over what is there; layer, level: of an array or 3D target; resolve
//       false keeps a multisampled target from resolving (a pass that reads its colour);
//       resolveInto: a texture to resolve into instead of the target's colour;
//       keepSamples, keepDepth false: nothing after this pass reads the target's
//       multisampled colour or its depth, so they needn't be stored (tile-based
//       GPUs then never write them out);
//       viewport [x, y, width, height] in pixels from the top left draws into that part only;
//       eye: a Vector3 for the frame's cameraPosition instead of the camera's own (a shadow
//       map drawn from the sun takes the eye's, which the planet's bend and levels of detail measure from)
//   compile(scene, camera, target, { pass }) -> Promise of the materials whose
//       shaders or pipelines failed, as "name: message", made in the background
//       (it also waits for pipelines an earlier compile() is still making)
//   fullscreen(material) -> { material, uniforms, render(target, options), compile(target), dispose() }:
//       one triangle over the whole target; the material's vertex shader gets
//       the vertex index (post/fullscreen.wgsl)
//   setGlobals(uniforms)  ctx.frame.uniforms, bound at group 0 (chunks/frame.wgsl) with the camera
//   canvas()              the canvas as a target, for the frame's output
import { Box3, Frustum, Matrix3, Matrix4, Sphere, Vector3, Vector4 } from '../maths/index.js';
import { fieldWriter, reflect, structLayout, words } from './reflect.js';
import { Bindings, layoutEntry } from './bindings.js';
import { Geometry } from './geometry.js';
import { signature } from './texture.js';
import { drawOrder } from './scene.js';
import frameSource from '../shaders/chunks/frame.wgsl';
import objectSource from '../shaders/chunks/object.wgsl';

const OBJECT_SLOT = 256; // bytes per mesh in the objects' buffer: the uniform offset alignment
const CULL = { front: 'back', back: 'front', double: 'none' };

export function createRenderer(gpu) {
  const { device, queue, stats } = gpu;
  const reflections = new Map();
  const reflectionOf = (source) => {
    if (!reflections.has(source)) reflections.set(source, reflect(source));
    return reflections.get(source);
  };

  // Group 0: the frame's uniforms and the camera. Its buffer lives as long as
  // the renderer, as the objects' does: untracked, so a teardown leaves nothing counted.
  const frameReflection = reflect(frameSource);
  const frameBindings = stats.untracked(() => new Bindings(gpu, frameReflection, 0, 'frame'));
  const camera = {
    projectionMatrix: { value: new Matrix4() },
    viewMatrix: { value: new Matrix4() },
    cameraPosition: { value: new Vector3() },
  };
  let globals = { ...camera };

  // Group 2: every mesh's matrices, in one buffer with a slot per mesh drawn in a pass.
  const objectReflection = reflect(objectSource);
  const objectWriters = structLayout('Object', objectReflection.structs).map((field) => [field.name, fieldWriter(field, 0, objectReflection.structs)]);
  const objectLayout = device.createBindGroupLayout({
    label: 'object',
    entries: [{ binding: 0, visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT, buffer: { type: 'uniform', hasDynamicOffset: true } }],
  });
  let objectSlots = 0;
  let objectBuffer = null;
  let objectGroup = null;
  let objectData = null;
  let objectWords = []; // words() of each slot of objectData
  const objectValues = { modelMatrix: null, modelViewMatrix: new Matrix4(), normalMatrix: new Matrix3() };
  function objectSlotsFor(n) {
    if (n <= objectSlots) return;
    objectBuffer?.destroy();
    objectSlots = Math.max(64, 2 ** Math.ceil(Math.log2(n)));
    objectBuffer = stats.untracked(() => device.createBuffer({ label: 'objects', size: objectSlots * OBJECT_SLOT, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST }));
    objectGroup = device.createBindGroup({ label: 'objects', layout: objectLayout, entries: [{ binding: 0, resource: { buffer: objectBuffer, size: OBJECT_SLOT } }] });
    objectData = new ArrayBuffer(objectSlots * OBJECT_SLOT);
    objectWords = Array.from({ length: objectSlots }, (_, i) => words(objectData, i * OBJECT_SLOT, OBJECT_SLOT / 4));
  }
  objectSlotsFor(64);

  // ---------------------------------------------------------------- materials

  function state(material) {
    if (material.gpu && material.gpu.version !== material.version) material.gpu.dispose();
    if (!material.gpu || material.gpu.version !== material.version) material.gpu = materialState(material);
    return material.gpu;
  }

  function materialState(material) {
    const reflection = reflectionOf(material.shader);
    const groups = new Set(reflection.bindings.map((b) => b.group));
    if (groups.has(0)) sameGroup(reflection, frameReflection, 0, material.name, 'chunks/frame.wgsl');
    if (groups.has(2)) sameGroup(reflection, objectReflection, 2, material.name, 'chunks/object.wgsl');
    for (const entry of [material.vertex, material.fragment]) {
      if (entry !== null && !reflection.entries[entry]) throw new Error(`material ${material.name}: its shader has no entry point "${entry}"`);
    }
    const shader = gpu.module(material.shader, material.name);
    const own = ownBindings(reflection, material);
    const { bindings } = own;
    const layout = device.createPipelineLayout({
      label: material.name,
      bindGroupLayouts: [groups.has(0) ? frameBindings.layout : gpu.emptyLayout, bindings.layout, groups.has(2) ? objectLayout : gpu.emptyLayout],
    });
    const constants = {};
    for (const [name, value] of Object.entries(material.overrides)) {
      if (!reflection.overrides[name]) throw new Error(`material ${material.name}: its shader has no override "${name}"`);
      constants[name] = Number(value);
    }
    const pipelines = new Map();
    const source = material.shader;
    return {
      version: material.version,
      reflection,
      groups,
      input: reflection.entries[material.vertex].input,
      shader,
      own,
      layout,
      constants,
      pipelines,
      dispose() {
        for (const { pipeline } of pipelines.values()) if (pipeline) stats.pipelineReleased(pipeline);
        pipelines.clear();
        own.release();
        gpu.releaseModule(source);
      },
    };
  }

  // A material's group 1. Materials with the same shader and the same
  // uniforms object (the terrain's variants, which differ in overrides only)
  // pack the same bytes: they share buffers and bind groups, packed once a
  // pass for all of them. { bindings, packed: the pass `group` is for, group, release() }
  const shared = new Map(); // reflection -> Map(uniforms -> its entry)
  function ownBindings(reflection, material) {
    let byUniforms = shared.get(reflection);
    if (!byUniforms) shared.set(reflection, (byUniforms = new Map()));
    const { uniforms } = material;
    let own = byUniforms.get(uniforms);
    if (!own) {
      own = { bindings: new Bindings(gpu, reflection, 1, material.name), packed: -1, group: null, users: 0 };
      own.release = () => {
        if (--own.users > 0) return;
        own.bindings.dispose();
        byUniforms.delete(uniforms);
      };
      byUniforms.set(uniforms, own);
    }
    own.users++;
    return own;
  }

  function sameGroup(reflection, expected, group, name, chunk) {
    const entries = (r) => JSON.stringify(r.bindings.filter((b) => b.group === group).map((b) => layoutEntry(b, r.bindings)));
    if (entries(reflection) !== entries(expected)) throw new Error(`material ${name}: bind group ${group} must be ${chunk}'s, included as it is`);
  }

  // How a material's vertex shader reads `geometry`: its vertex buffers'
  // layout, the attributes in their order, and a number per distinct layout
  // for pipelines' keys. Worked out again only when the geometry's attributes change.
  const layoutIds = new Map(); // a layout as JSON -> its number
  function vertexLayout(material, s, geometry) {
    const g = geometryState(geometry);
    let layout = g.layouts.get(s.input);
    if (layout?.version === geometry.version) return layout;
    const buffers = s.input.map((input) => {
      const attribute = geometry.attributes[input.name];
      if (!attribute) throw new Error(`material ${material.name}: the geometry has no attribute "${input.name}"`);
      return {
        arrayStride: attribute.itemSize * 4,
        stepMode: attribute.instance ? 'instance' : 'vertex',
        attributes: [{ shaderLocation: input.location, offset: 0, format: attribute.format }],
      };
    });
    const json = JSON.stringify(buffers);
    if (!layoutIds.has(json)) layoutIds.set(json, layoutIds.size);
    layout = { version: geometry.version, buffers, names: s.input.map((input) => input.name), id: layoutIds.get(json) };
    g.layouts.set(s.input, layout);
    return layout;
  }

  // What a pipeline drawing into a target must know of it, once per target.
  const signatures = new WeakMap();
  function signatureOf(target) {
    let sig = signatures.get(target);
    if (sig === undefined) signatures.set(target, (sig = signature(target)));
    return sig;
  }

  // A material without a fragment entry point draws depth alone; into a target
  // without colour (a shadow map), one that has one runs it for what it
  // discards (a leaf's cut-out) and writes no colour.
  function pipelineDescriptor(material, s, target, buffers) {
    const { module } = s.shader;
    const targets = target.format ? [{ format: target.format, ...(material.blend && { blend: material.blend }), writeMask: material.colorWrite === false ? 0 : GPUColorWrite.ALL }] : [];
    return {
      label: material.name,
      layout: s.layout,
      vertex: { module, entryPoint: material.vertex, buffers, constants: s.constants },
      ...(material.fragment !== null && { fragment: { module, entryPoint: material.fragment, constants: s.constants, targets } }),
      primitive: { topology: 'triangle-list', cullMode: CULL[material.side], frontFace: 'ccw' },
      ...(target.depthFormat && {
        depthStencil: {
          format: target.depthFormat,
          depthWriteEnabled: material.depthWrite,
          depthCompare: material.depthTest ? 'greater-equal' : 'always',
          depthBias: material.depthBias,
          depthBiasSlopeScale: material.depthBiasSlope,
        },
      }),
      multisample: { count: target.samples, alphaToCoverageEnabled: material.alphaToCoverage },
    };
  }

  // The pipeline for drawing `geometry` with `material` into `target`: made now if compile() didn't.
  function pipeline(material, target, geometry) {
    const s = state(material);
    const layout = vertexLayout(material, s, geometry);
    const key = `${signatureOf(target)}|${layout.id}`;
    let entry = s.pipelines.get(key);
    if (!entry?.pipeline) {
      const made = device.createRenderPipeline(pipelineDescriptor(material, s, target, layout.buffers));
      stats.pipelineCreated(made);
      entry = { pipeline: made };
      s.pipelines.set(key, entry);
    }
    return { s, layout, pipeline: entry.pipeline };
  }

  // Makes the pipelines for drawing the meshes into `target` in the background.
  // Resolves to the problems, as "material: message", once they are made,
  // with those an earlier call is still making.
  function compile(scene, _camera, target, { pass } = {}) {
    const meshes = Array.isArray(scene) ? scene : scene.meshes(pass, [], true); // hidden ones too: they may show later
    const work = [];
    const problems = [];
    const seen = new Set();
    for (const mesh of meshes) {
      const { material, geometry } = mesh;
      let s;
      let layout;
      try {
        s = state(material);
        layout = vertexLayout(material, s, geometry);
      } catch (err) {
        problems.push(`${material.name}: ${err.message}`);
        continue;
      }
      if (!seen.has(material)) {
        seen.add(material);
        work.push(s.shader.compiled.then((errors) => problems.push(...errors.map((e) => `${material.name}: ${e}`))));
      }
      const key = `${signatureOf(target)}|${layout.id}`;
      let entry = s.pipelines.get(key);
      if (!entry) {
        const made = { pipeline: null };
        // Resolves to the error's message, or null once made.
        made.done = device.createRenderPipelineAsync(pipelineDescriptor(material, s, target, layout.buffers)).then(
          (pipeline) => {
            if (s.pipelines.get(key) !== made) return null; // disposed, or made by a draw meanwhile
            made.pipeline = pipeline;
            stats.pipelineCreated(pipeline);
            return null;
          },
          (err) => {
            if (s.pipelines.get(key) === made) s.pipelines.delete(key);
            return err.message;
          },
        );
        s.pipelines.set(key, made);
        entry = made;
      }
      if (entry.done) work.push(entry.done.then((error) => error && problems.push(`${material.name}: ${error}`)));
    }
    return Promise.all(work).then(() => [...new Set(problems)]);
  }

  // ---------------------------------------------------------------- geometry

  function geometryState(geometry) {
    return (geometry.gpu ??= { index: null, layouts: new Map() });
  }

  // Uploads what changed of the geometry's attributes (each once, however many share it) and its index.
  function geometryBuffers(geometry) {
    const g = geometryState(geometry);
    for (const name in geometry.attributes) {
      const attribute = geometry.attributes[name];
      const size = Math.max(4, attribute.array.byteLength);
      if (attribute.gpu?.size !== size) {
        attribute.gpu?.destroy();
        attribute.gpu = device.createBuffer({ label: name, size, usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST });
        attribute.dirty = [0, attribute.array.length];
      }
      if (attribute.dirty) {
        const [from, to] = attribute.dirty;
        queue.writeBuffer(attribute.gpu, from * 4, attribute.array, from, to - from);
        attribute.dirty = null;
      }
    }
    if (geometry.index && (!g.index || geometry.index.dirty)) {
      const { array } = geometry.index;
      g.index?.destroy();
      // writeBuffer needs a multiple of 4 bytes: an odd count of 16-bit indices gets one more.
      const size = Math.ceil(array.byteLength / 4) * 4;
      g.index = device.createBuffer({ label: 'index', size, usage: GPUBufferUsage.INDEX | GPUBufferUsage.COPY_DST });
      let padded = array;
      if (size !== array.byteLength) {
        padded = new array.constructor(size / array.BYTES_PER_ELEMENT);
        padded.set(array);
      }
      queue.writeBuffer(g.index, 0, padded);
      g.indexFormat = array instanceof Uint32Array ? 'uint32' : 'uint16';
      geometry.index.dirty = false;
    }
    return g;
  }

  // three.js's bounding sphere of a geometry: about its box's centre.
  function boundingSphere(geometry) {
    if (geometry.boundingSphere) return geometry.boundingSphere;
    const position = geometry.attributes.position;
    const sphere = new Sphere();
    if (position) {
      const box = new Box3();
      const v = new Vector3();
      const a = position.array;
      for (let i = 0; i < a.length; i += 3) box.expandByPoint(v.set(a[i], a[i + 1], a[i + 2]));
      box.getCenter(sphere.center);
      let max = 0;
      for (let i = 0; i < a.length; i += 3) max = Math.max(max, sphere.center.distanceToSquared(v.set(a[i], a[i + 1], a[i + 2])));
      sphere.radius = Math.sqrt(max);
    }
    geometry.boundingSphere = sphere;
    return sphere;
  }

  // ---------------------------------------------------------------- drawing

  const projScreen = new Matrix4();
  const frustum = new Frustum();
  const sphere = new Sphere();
  const z = new Vector4();
  let passes = 0; // render() calls so far, so a material packs its uniforms once a pass

  // resolve: whether a multisampled target resolves at the end of the pass
  // (not while the pass reads that colour, as the after-opaque pass does), into
  // its colour or `into`.
  function attachments(target, layer, level, resolve, into) {
    if (target.canvas) return { view: gpu.context.getCurrentTexture().createView() };
    if (target.msaa) return { view: target.msaa.view, ...(resolve && { resolveTarget: (into ?? target.color).attachment(layer, level).view }) };
    return target.color.attachment(layer, level);
  }

  function setCamera(cam, eye) {
    camera.projectionMatrix.value.copy(cam.projectionMatrix);
    camera.viewMatrix.value.copy(cam.matrixWorldInverse);
    if (eye) camera.cameraPosition.value.copy(eye);
    else camera.cameraPosition.value.setFromMatrixPosition(cam.matrixWorld);
  }

  function render(scene, cam, target, options = {}) {
    const { pass, clearColor = null, clearDepth = null, layer = 0, level = 0, resolve = true, resolveInto = null, keepSamples = true, keepDepth = true, viewport = null, eye = null } = options;
    if (cam) {
      if (!Array.isArray(scene)) scene.updateMatrixWorld();
      setCamera(cam, eye);
      projScreen.multiplyMatrices(cam.projectionMatrix, cam.matrixWorldInverse);
      frustum.setFromProjectionMatrix(projScreen);
    }
    const meshes = Array.isArray(scene) ? scene : scene.meshes(pass);

    const entries = [];
    for (const mesh of meshes) {
      if (!mesh.visible) continue;
      // A mesh that culls itself (instanced, or one following the camera) has
      // no place of its own to cull or sort it by: its sphere is its geometry's.
      let depth = 0;
      if (cam && mesh.frustumCulled !== false) {
        sphere.copy(boundingSphere(mesh.geometry)).applyMatrix4(mesh.matrixWorld);
        if (!frustum.intersectsSphere(sphere)) continue;
        depth = z.copy(sphere.center).applyMatrix4(projScreen).z;
      }
      entries.push({ mesh, z: depth });
    }
    const items = drawOrder(entries);

    // Uniforms first: everything written before this pass is submitted applies to it.
    const thisPass = passes++;
    let frameGroup = null;
    const draws = [];
    let slots = 0;
    for (const { mesh } of items) {
      const { geometry, material } = mesh;
      const instances = geometry.instances;
      if (instances <= 0 || geometry.count <= 0) continue;
      const { s, layout, pipeline: made } = pipeline(material, target, geometry);
      const { own } = s;
      if (own.packed !== thisPass) {
        own.group = own.bindings.update(material.uniforms);
        own.packed = thisPass;
      }
      if (s.groups.has(0)) frameGroup ??= frameBindings.update(globals);
      const draw = { mesh, s, layout, pipeline: made, group: own.group, buffers: geometryBuffers(geometry), instances, slot: -1 };
      if (s.groups.has(2)) draw.slot = slots++;
      draws.push(draw);
    }
    if (slots) {
      objectSlotsFor(slots);
      for (const draw of draws) {
        if (draw.slot < 0) continue;
        const { mesh } = draw;
        objectValues.modelMatrix = mesh.matrixWorld;
        if (cam) objectValues.modelViewMatrix.multiplyMatrices(cam.matrixWorldInverse, mesh.matrixWorld);
        objectValues.normalMatrix.getNormalMatrix(objectValues.modelViewMatrix);
        for (const [name, write] of objectWriters) write(objectWords[draw.slot], objectValues[name]);
      }
      queue.writeBuffer(objectBuffer, 0, objectData, 0, slots * OBJECT_SLOT);
    }

    const samples = Boolean(target.msaa);
    const colorAttachments = [];
    if (target.canvas || target.color) {
      colorAttachments.push({
        ...attachments(target, layer, level, resolve, resolveInto),
        loadOp: clearColor ? 'clear' : 'load',
        storeOp: samples && !keepSamples ? 'discard' : 'store',
        ...(clearColor && { clearValue: clearColor }),
      });
    }
    const descriptor = { label: target.name, colorAttachments };
    if (target.depth) {
      descriptor.depthStencilAttachment = {
        // A target of depth alone may have layers: one at a time.
        view: target.color ? target.depth.view : target.depth.attachment(layer, 0).view,
        depthLoadOp: clearDepth !== null ? 'clear' : 'load',
        depthStoreOp: keepDepth ? 'store' : 'discard',
        ...(clearDepth !== null && { depthClearValue: clearDepth }),
      };
    }
    // A pass that neither draws nor clears still resolves a multisampled target.
    if (!draws.length && !clearColor && clearDepth === null && !(samples && resolve)) return;
    const encoder = device.createCommandEncoder({ label: target.name });
    const encoded = encoder.beginRenderPass(descriptor);
    if (viewport) {
      encoded.setViewport(...viewport, 0, 1);
      encoded.setScissorRect(...viewport);
    }
    // State persists from draw to draw: set only what changes.
    let bound = null;
    const groups = [null, null, null];
    const vertexBuffers = [];
    let indexBuffer = null;
    for (const draw of draws) {
      const { geometry } = draw.mesh;
      if (draw.pipeline !== bound) encoded.setPipeline((bound = draw.pipeline));
      const frame = draw.s.groups.has(0) ? frameGroup : gpu.emptyGroup;
      if (frame !== groups[0]) encoded.setBindGroup(0, (groups[0] = frame));
      if (draw.group !== groups[1]) encoded.setBindGroup(1, (groups[1] = draw.group));
      if (draw.slot >= 0) encoded.setBindGroup(2, (groups[2] = objectGroup), [draw.slot * OBJECT_SLOT]);
      else if (groups[2] !== gpu.emptyGroup) encoded.setBindGroup(2, (groups[2] = gpu.emptyGroup));
      draw.layout.names.forEach((name, i) => {
        const buffer = geometry.attributes[name].gpu;
        if (vertexBuffers[i] !== buffer) encoded.setVertexBuffer(i, (vertexBuffers[i] = buffer));
      });
      if (geometry.index) {
        if (draw.buffers.index !== indexBuffer) encoded.setIndexBuffer((indexBuffer = draw.buffers.index), draw.buffers.indexFormat);
        encoded.drawIndexed(geometry.count, draw.instances, 0, 0, geometry.firstInstance);
      } else {
        encoded.draw(geometry.count, draw.instances, 0, geometry.firstInstance);
      }
    }
    encoded.end();
    queue.submit([encoder.finish()]);
  }

  // ---------------------------------------------------------------- fullscreen

  const triangle = new Geometry();
  triangle.vertexCount = 3;

  function fullscreen(material) {
    Object.assign(material, { depthTest: false, depthWrite: false });
    const mesh = { geometry: triangle, material, visible: true, frustumCulled: false, renderOrder: 0, id: -1 };
    return {
      material,
      uniforms: material.uniforms,
      render(target, options = {}) {
        render([mesh], null, target, options);
      },
      compile(target) {
        return compile([mesh], null, target);
      },
      dispose() {
        material.dispose();
      },
    };
  }

  const canvasTarget = { name: 'canvas', canvas: true, samples: 1, depthFormat: null, depth: null, get format() {
    return gpu.canvasFormat;
  } };

  return {
    gpu,
    render,
    compile,
    fullscreen,
    canvas: () => canvasTarget,
    setGlobals(uniforms) {
      globals = { ...uniforms, ...camera };
    },
    get globals() {
      return globals;
    },
    dispose() {
      frameBindings.dispose();
      objectBuffer?.destroy();
    },
  };
}
