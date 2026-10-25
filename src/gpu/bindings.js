// One bind group's resources of a shader module, filled by name from a
// uniforms object ({ name: { value } }, as three.js's): a uniform buffer per
// var<uniform> struct, packed field by field by writers made once
// (reflect.js fieldWriter) each time the group is used, and written only when
// it changed; textures and their samplers (material.js has the naming). The
// bind group is made again when a bound resource changed (a texture resized
// or swapped), and kept for when the same resources come back.
import { fieldWriter, structLayout, structSize, words } from './reflect.js';

const VISIBLE = () => GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT;
// Bind groups kept per Bindings, the least recently used going first: a
// material may cycle through a few sets of textures (the sky's two sets of
// tables, the output's inputs), never many.
const GROUPS = 16;
const TEXELS = { mag: 'nearest', min: 'nearest' }; // the sampler of `<name>Texels`

// The bind group layout entry of a reflected binding. A float texture with a
// `<name>Sampler` beside it is filtered; one without is read unfiltered, which
// any float format allows (r32float and rgba32float can't be filtered in core
// WebGPU): texel by texel (textureLoad), or with textureGather through a
// `<name>Texels` sampler, a nearest one that clamps to the edge.
export function layoutEntry(binding, all) {
  const entry = { binding: binding.binding, visibility: VISIBLE() };
  const { type } = binding;
  if (binding.kind === 'uniform') return { ...entry, buffer: { type: 'uniform' } };
  if (binding.kind === 'storage') {
    return { ...entry, visibility: GPUShaderStage.FRAGMENT | GPUShaderStage.COMPUTE, buffer: { type: binding.access === 'read_write' ? 'storage' : 'read-only-storage' } };
  }
  if (binding.kind === 'sampler') {
    if (type === 'sampler_comparison') return { ...entry, sampler: { type: 'comparison' } };
    return { ...entry, sampler: { type: binding.name.endsWith('Texels') ? 'non-filtering' : 'filtering' } };
  }
  const multisampled = type.includes('multisampled');
  const viewDimension = type.includes('3d') ? '3d' : type.includes('array') ? '2d-array' : '2d';
  let sampleType;
  if (type.startsWith('texture_depth')) sampleType = 'depth';
  else if (/<i32>/.test(type)) sampleType = 'sint';
  else if (/<u32>/.test(type)) sampleType = 'uint';
  else sampleType = !multisampled && all.some((b) => b.name === `${binding.name}Sampler`) ? 'float' : 'unfilterable-float';
  return { ...entry, texture: { sampleType, viewDimension, multisampled } };
}

// A number per GPU object, for keys of the bind groups made from them.
const ids = new WeakMap();
let nextId = 0;
function idOf(object) {
  let id = ids.get(object);
  if (id === undefined) ids.set(object, (id = nextId++));
  return id;
}

export class Bindings {
  constructor(gpu, reflection, group, label) {
    this.gpu = gpu;
    this.label = label;
    this.entries = reflection.bindings
      .filter((b) => b.group === group)
      .sort((a, b) => a.binding - b.binding)
      .map((b) => (b.kind === 'sampler' ? { ...b, texture: b.name.replace(/Sampler$/, '') } : b)); // a sampler's texture
    this.layout = gpu.layout(this.entries.map((b) => layoutEntry(b, this.entries)));
    this.buffers = this.entries
      .filter((b) => b.kind === 'uniform')
      .map((b) => {
        const size = structSize(b.type, reflection.structs);
        const data = new ArrayBuffer(size);
        return {
          binding: b.binding,
          fields: structLayout(b.type, reflection.structs).map((field) => ({ name: field.name, write: fieldWriter(field, 0, reflection.structs) })),
          buffer: gpu.device.createBuffer({ label: `${label} ${b.name}`, size, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST }),
          words: words(data),
          last: null, // the words last written to the buffer
        };
      });
    this.resources = new Array(this.entries.length);
    this.groups = new Map(); // key of the resources -> bind group, least recently used first
    this.last = null; // { resources, group } of the last update
  }

  get empty() {
    return this.entries.length === 0;
  }

  // Packs `uniforms` and returns the bind group for them.
  update(uniforms) {
    for (const b of this.buffers) {
      for (const field of b.fields) {
        const uniform = uniforms[field.name];
        if (!uniform) throw new Error(`${this.label}: no uniform "${field.name}"`);
        try {
          field.write(b.words, uniform.value);
        } catch (err) {
          throw new Error(`${this.label}: uniform "${field.name}": ${err.message}`);
        }
      }
      const now = b.words.u32;
      if (b.last && equal(now, b.last)) continue;
      this.gpu.queue.writeBuffer(b.buffer, 0, now.buffer);
      if (b.last) b.last.set(now);
      else b.last = now.slice();
    }
    const resources = this.resources;
    let same = this.last !== null;
    for (let i = 0; i < resources.length; i++) {
      resources[i] = this.resource(this.entries[i], uniforms);
      same &&= resources[i] === this.last.resources[i];
    }
    if (same) return this.last.group;
    let key = '';
    for (const resource of resources) key += `${idOf(resource)},`;
    let group = this.groups.get(key);
    if (group) {
      this.groups.delete(key); // to the back: just used
    } else {
      group = this.gpu.device.createBindGroup({
        label: this.label,
        layout: this.layout,
        entries: resources.map((resource, i) => ({ binding: this.entries[i].binding, resource })),
      });
      if (this.groups.size >= GROUPS) this.groups.delete(this.groups.keys().next().value);
    }
    this.groups.set(key, group);
    this.last = { resources: resources.slice(), group };
    return group;
  }

  // What is bound at `binding`: a texture view, a sampler, or for a buffer a
  // { buffer } that keeps its identity, as the keys of the bind groups need.
  resource(binding, uniforms) {
    if (binding.kind === 'uniform') return this.uniformResource(binding);
    if (binding.kind === 'sampler' && binding.name.endsWith('Texels')) return this.gpu.sampler(TEXELS);
    if (binding.kind === 'sampler') return this.gpu.sampler(uniforms[binding.texture]?.value?.sampler);
    if (binding.kind === 'storage') {
      const buffer = uniforms[binding.name]?.value;
      if (!buffer) throw new Error(`${this.label}: no storage buffer "${binding.name}"`);
      return this.bufferResource(buffer);
    }
    if (!(binding.name in uniforms)) throw new Error(`${this.label}: no texture uniform "${binding.name}"`);
    const texture = uniforms[binding.name].value;
    return texture ? texture.view : this.gpu.placeholder(binding.type);
  }

  uniformResource(binding) {
    const b = this.buffers.find((u) => u.binding === binding.binding);
    return (b.resource ??= { buffer: b.buffer });
  }

  // A storage buffer by its identity (not its label, which two buffers may share).
  bufferResource(buffer) {
    this.storage ??= new WeakMap();
    if (!this.storage.has(buffer)) this.storage.set(buffer, { buffer });
    return this.storage.get(buffer);
  }

  dispose() {
    for (const b of this.buffers) b.buffer.destroy();
    this.buffers = [];
    this.groups.clear();
    this.last = null;
  }
}

function equal(a, b) {
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}
