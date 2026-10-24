// Draws meshes into render targets, the way three.js's WebGLRenderer did for
// this game: one call draws one pass (encoded and submitted at once, so
// uniforms set between calls apply to the calls after), with three.js's frustum
// culling and draw order. Pipelines are made per material, target and vertex
// layout on first use, or ahead with compile(); bind groups as material.js says.
//
//   render(scene, camera, target, { pass, clearColor, clearDepth, layer, level })
//       scene: a Scene (its meshes in `pass`, or all) or a list of meshes; camera:
//       core/camera.js's, or null for passes that need none; target: createTarget's,
//       or canvas(); clearColor [r, g, b, a] and clearDepth clear first, else it
//       draws over what is there; layer, level: of an array or 3D target; resolve
//       false keeps a multisampled target from resolving (a pass that reads its colour);
//       viewport [x, y, width, height] in pixels from the top left draws into that part only
//   compile(scene, camera, target, { pass }) -> Promise of the materials whose
//       shaders or pipelines failed, as "name: message", made in the background
//   fullscreen(material) -> { material, uniforms, render(target, options), compile(target), dispose() }:
//       one triangle over the whole target; the material's vertex shader gets
//       the vertex index (post/fullscreen.wgsl)
//   setGlobals(uniforms)  ctx.frame.uniforms, bound at group 0 (chunks/frame.wgsl) with the camera
//   canvas()              the canvas as a target, for the frame's output
import { Box3, Frustum, Matrix3, Matrix4, Sphere, Vector3, Vector4 } from '../maths/index.js';
import { reflect, structLayout, writeField } from './reflect.js';
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

  // Group 0: the frame's uniforms and the camera.
  const frameReflection = reflect(frameSource);
  const frameBindings = new Bindings(gpu, frameReflection, 0, 'frame');
  const camera = {
    projectionMatrix: { value: new Matrix4() },
    viewMatrix: { value: new Matrix4() },
    cameraPosition: { value: new Vector3() },
  };
  let globals = { ...camera };

  // Group 2: every mesh's matrices, in one buffer with a slot per mesh drawn in a pass.
  const objectReflection = reflect(objectSource);
  const objectFields = structLayout('Object', objectReflection.structs);
  const objectLayout = device.createBindGroupLayout({
    label: 'object',
    entries: [{ binding: 0, visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT, buffer: { type: 'uniform', hasDynamicOffset: true } }],
  });
  let objectSlots = 0;
  let objectBuffer = null;
  let objectGroup = null;
  const objectData = new ArrayBuffer(OBJECT_SLOT);
  const objectView = new DataView(objectData);
  const objectValues = { modelMatrix: { value: null }, modelViewMatrix: { value: new Matrix4() }, normalMatrix: { value: new Matrix3() } };
  function objectSlotsFor(n) {
    if (n <= objectSlots) return;
    objectBuffer?.destroy();
    objectSlots = Math.max(64, 2 ** Math.ceil(Math.log2(n)));
    objectBuffer = stats.untracked(() => device.createBuffer({ label: 'objects', size: objectSlots * OBJECT_SLOT, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST }));
    objectGroup = device.createBindGroup({ label: 'objects', layout: objectLayout, entries: [{ binding: 0, resource: { buffer: objectBuffer, size: OBJECT_SLOT } }] });
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
      if (!reflection.entries[entry]) throw new Error(`material ${material.name}: its shader has no entry point "${entry}"`);
    }
    const shader = gpu.module(material.shader, material.name);
    const bindings = new Bindings(gpu, reflection, 1, material.name);
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
      shader,
      bindings,
      layout,
      constants,
      pipelines,
      dispose() {
        for (const { pipeline } of pipelines.values()) if (pipeline) stats.pipelineReleased(pipeline);
        pipelines.clear();
        bindings.dispose();
        gpu.releaseModule(source);
      },
    };
  }

  function sameGroup(reflection, expected, group, name, chunk) {
    const entries = (r) => JSON.stringify(r.bindings.filter((b) => b.group === group).map((b) => layoutEntry(b, r.bindings)));
    if (entries(reflection) !== entries(expected)) throw new Error(`material ${name}: bind group ${group} must be ${chunk}'s, included as it is`);
  }

  function vertexBuffers(material, s, geometry) {
    return s.reflection.entries[material.vertex].input.map((input) => {
      const attribute = geometry.attributes[input.name];
      if (!attribute) throw new Error(`material ${material.name}: the geometry has no attribute "${input.name}"`);
      return {
        arrayStride: attribute.itemSize * 4,
        stepMode: attribute.instance ? 'instance' : 'vertex',
        attributes: [{ shaderLocation: input.location, offset: 0, format: attribute.format }],
      };
    });
  }

  function pipelineDescriptor(material, s, target, buffers) {
    const { module } = s.shader;
    return {
      label: material.name,
      layout: s.layout,
      vertex: { module, entryPoint: material.vertex, buffers, constants: s.constants },
      fragment: {
        module,
        entryPoint: material.fragment,
        constants: s.constants,
        targets: [{ format: target.format, ...(material.blend && { blend: material.blend }), writeMask: material.colorWrite === false ? 0 : GPUColorWrite.ALL }],
      },
      primitive: { topology: 'triangle-list', cullMode: CULL[material.side], frontFace: 'ccw' },
      ...(target.depthFormat && {
        depthStencil: { format: target.depthFormat, depthWriteEnabled: material.depthWrite, depthCompare: material.depthTest ? 'greater-equal' : 'always' },
      }),
      multisample: { count: target.samples, alphaToCoverageEnabled: material.alphaToCoverage },
    };
  }

  // The pipeline for drawing `geometry` with `material` into `target`: made now if compile() didn't.
  function pipeline(material, target, geometry) {
    const s = state(material);
    const buffers = vertexBuffers(material, s, geometry);
    const key = `${signature(target)}|${JSON.stringify(buffers)}`;
    let entry = s.pipelines.get(key);
    if (!entry?.pipeline) {
      const made = device.createRenderPipeline(pipelineDescriptor(material, s, target, buffers));
      stats.pipelineCreated(made);
      entry = { pipeline: made };
      s.pipelines.set(key, entry);
    }
    return { s, pipeline: entry.pipeline };
  }

  // Makes the pipelines for drawing the meshes into `target` in the background.
  // Resolves to the problems, as "material: message".
  function compile(scene, _camera, target, { pass } = {}) {
    const meshes = Array.isArray(scene) ? scene : scene.meshes(pass, [], true); // hidden ones too: they may show later
    const work = [];
    const problems = [];
    const seen = new Set();
    for (const mesh of meshes) {
      const { material, geometry } = mesh;
      let s;
      let buffers;
      try {
        s = state(material);
        buffers = vertexBuffers(material, s, geometry);
      } catch (err) {
        problems.push(`${material.name}: ${err.message}`);
        continue;
      }
      const key = `${signature(target)}|${JSON.stringify(buffers)}`;
      if (!seen.has(material)) {
        seen.add(material);
        work.push(s.shader.compiled.then((errors) => problems.push(...errors.map((e) => `${material.name}: ${e}`))));
      }
      if (s.pipelines.has(key)) continue;
      const entry = { pipeline: null };
      s.pipelines.set(key, entry);
      work.push(
        device.createRenderPipelineAsync(pipelineDescriptor(material, s, target, buffers)).then(
          (made) => {
            if (s.pipelines.get(key) !== entry || entry.pipeline) return; // disposed, or made by a draw meanwhile
            entry.pipeline = made;
            stats.pipelineCreated(made);
          },
          (err) => {
            s.pipelines.delete(key);
            problems.push(`${material.name}: ${err.message}`);
          },
        ),
      );
    }
    return Promise.all(work).then(() => [...new Set(problems)]);
  }

  // ---------------------------------------------------------------- geometry

  function geometryBuffers(geometry) {
    let g = geometry.gpu;
    if (!g) g = geometry.gpu = { buffers: new Map(), index: null };
    for (const [name, attribute] of Object.entries(geometry.attributes)) {
      let buffer = g.buffers.get(name);
      if (!buffer || buffer.size !== attribute.array.byteLength) {
        buffer?.destroy();
        buffer = device.createBuffer({ label: name, size: Math.max(4, attribute.array.byteLength), usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST });
        g.buffers.set(name, buffer);
        attribute.dirty = [0, attribute.array.length];
      }
      if (attribute.dirty) {
        const [from, to] = attribute.dirty;
        queue.writeBuffer(buffer, from * 4, attribute.array, from, to - from);
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

  // resolve: whether a multisampled target resolves into its colour at the end
  // of the pass (not while the pass reads that colour, as the after-opaque pass does).
  function attachments(target, layer, level, resolve) {
    if (target.canvas) return { view: gpu.context.getCurrentTexture().createView() };
    if (target.msaa) return { view: target.msaa.view, ...(resolve && { resolveTarget: target.color.attachment(layer, level).view }) };
    return target.color.attachment(layer, level);
  }

  function setCamera(cam) {
    camera.projectionMatrix.value.copy(cam.projectionMatrix);
    camera.viewMatrix.value.copy(cam.matrixWorldInverse);
    camera.cameraPosition.value.setFromMatrixPosition(cam.matrixWorld);
  }

  function render(scene, cam, target, { pass, clearColor = null, clearDepth = null, layer = 0, level = 0, resolve = true, viewport = null } = {}) {
    if (cam) {
      if (!Array.isArray(scene)) scene.updateMatrixWorld();
      setCamera(cam);
      projScreen.multiplyMatrices(cam.projectionMatrix, cam.matrixWorldInverse);
      frustum.setFromProjectionMatrix(projScreen);
    }
    const meshes = Array.isArray(scene) ? scene : scene.meshes(pass);

    const entries = [];
    for (const mesh of meshes) {
      if (!mesh.visible) continue;
      if (cam && mesh.frustumCulled !== false) {
        sphere.copy(boundingSphere(mesh.geometry)).applyMatrix4(mesh.matrixWorld);
        if (!frustum.intersectsSphere(sphere)) continue;
      }
      let depth = 0;
      if (cam) depth = z.copy(boundingSphere(mesh.geometry).center).applyMatrix4(mesh.matrixWorld).applyMatrix4(projScreen).z;
      entries.push({ mesh, z: depth });
    }
    const items = drawOrder(entries);

    // Uniforms first: everything written before this pass is submitted applies to it.
    const frameGroup = frameBindings.update(globals);
    const draws = [];
    let slots = 0;
    for (const { mesh } of items) {
      const { geometry, material } = mesh;
      const instances = geometry.instances;
      if (instances <= 0 || geometry.count <= 0) continue;
      const { s, pipeline: made } = pipeline(material, target, geometry);
      const draw = { mesh, s, pipeline: made, group: s.bindings.update(material.uniforms), buffers: geometryBuffers(geometry), instances, slot: -1 };
      if (s.groups.has(2)) draw.slot = slots++;
      draws.push(draw);
    }
    if (slots) {
      objectSlotsFor(slots);
      for (const draw of draws) {
        if (draw.slot < 0) continue;
        const { mesh } = draw;
        objectValues.modelMatrix.value = mesh.matrixWorld;
        if (cam) objectValues.modelViewMatrix.value.multiplyMatrices(cam.matrixWorldInverse, mesh.matrixWorld);
        objectValues.normalMatrix.value.getNormalMatrix(objectValues.modelViewMatrix.value);
        for (const field of objectFields) writeField(objectView, 0, field, objectValues[field.name].value, objectReflection.structs);
        queue.writeBuffer(objectBuffer, draw.slot * OBJECT_SLOT, objectData);
      }
    }

    const color = { ...attachments(target, layer, level, resolve), loadOp: clearColor ? 'clear' : 'load', storeOp: 'store', ...(clearColor && { clearValue: clearColor }) };
    const descriptor = { label: target.name, colorAttachments: [color] };
    if (target.depth) {
      descriptor.depthStencilAttachment = {
        view: target.depth.view,
        depthLoadOp: clearDepth !== null ? 'clear' : 'load',
        depthStoreOp: 'store',
        ...(clearDepth !== null && { depthClearValue: clearDepth }),
      };
    }
    // A pass that neither draws nor clears still resolves a multisampled target.
    if (!draws.length && !clearColor && clearDepth === null && !(target.msaa && resolve)) return;
    const encoder = device.createCommandEncoder({ label: target.name });
    const encoded = encoder.beginRenderPass(descriptor);
    if (viewport) {
      encoded.setViewport(...viewport, 0, 1);
      encoded.setScissorRect(...viewport);
    }
    for (const draw of draws) {
      const { geometry } = draw.mesh;
      encoded.setPipeline(draw.pipeline);
      encoded.setBindGroup(0, draw.s.groups.has(0) ? frameGroup : gpu.emptyGroup);
      encoded.setBindGroup(1, draw.group);
      if (draw.slot >= 0) encoded.setBindGroup(2, objectGroup, [draw.slot * OBJECT_SLOT]);
      else encoded.setBindGroup(2, gpu.emptyGroup);
      draw.s.reflection.entries[draw.mesh.material.vertex].input.forEach((input, i) => encoded.setVertexBuffer(i, draw.buffers.buffers.get(input.name)));
      if (geometry.index) {
        encoded.setIndexBuffer(draw.buffers.index, draw.buffers.indexFormat);
        encoded.drawIndexed(geometry.count, draw.instances);
      } else {
        encoded.draw(geometry.count, draw.instances);
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
