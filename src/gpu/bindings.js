// One bind group's resources of a shader module, filled by name from a
// uniforms object ({ name: { value } }, as three.js's): a uniform buffer per
// var<uniform> struct, packed field by field each time the group is used and
// written only when it changed; textures and their samplers (material.js has
// the naming). The bind group is made again when a bound texture changed.
import { structLayout, structSize, writeField } from './reflect.js';

const VISIBLE = () => GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT;

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

export class Bindings {
  constructor(gpu, reflection, group, label) {
    this.gpu = gpu;
    this.label = label;
    this.entries = reflection.bindings.filter((b) => b.group === group).sort((a, b) => a.binding - b.binding);
    this.layout = gpu.layout(this.entries.map((b) => layoutEntry(b, this.entries)));
    this.buffers = this.entries
      .filter((b) => b.kind === 'uniform')
      .map((b) => {
        const size = structSize(b.type, reflection.structs);
        const data = new ArrayBuffer(size);
        return {
          binding: b.binding,
          fields: structLayout(b.type, reflection.structs),
          structs: reflection.structs,
          buffer: gpu.device.createBuffer({ label: `${label} ${b.name}`, size, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST }),
          data,
          view: new DataView(data),
          last: null,
        };
      });
    this.groups = new Map();
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
          writeField(b.view, 0, field, uniform.value, b.structs);
        } catch (err) {
          throw new Error(`${this.label}: uniform "${field.name}": ${err.message}`);
        }
      }
      const bytes = new Uint8Array(b.data);
      if (!b.last || !equal(bytes, b.last)) {
        this.gpu.queue.writeBuffer(b.buffer, 0, b.data);
        b.last = bytes.slice();
      }
    }
    const resources = this.entries.map((b) => this.resource(b, uniforms));
    const key = resources.map((r) => r.key).join('|');
    let group = this.groups.get(key);
    if (!group) {
      if (this.groups.size > 8) this.groups.clear(); // of textures since resized or swapped
      group = this.gpu.device.createBindGroup({
        label: this.label,
        layout: this.layout,
        entries: resources.map((r, i) => ({ binding: this.entries[i].binding, resource: r.resource })),
      });
      this.groups.set(key, group);
    }
    return group;
  }

  resource(binding, uniforms) {
    if (binding.kind === 'uniform') {
      const { buffer } = this.buffers.find((b) => b.binding === binding.binding);
      return { key: 'u', resource: { buffer } };
    }
    if (binding.kind === 'sampler' && binding.name.endsWith('Texels')) {
      return { key: 'texels', resource: this.gpu.sampler({ mag: 'nearest', min: 'nearest' }) };
    }
    if (binding.kind === 'sampler') {
      const texture = uniforms[binding.name.replace(/Sampler$/, '')]?.value;
      const sampler = this.gpu.sampler(texture?.sampler);
      return { key: JSON.stringify(texture?.sampler ?? {}), resource: sampler };
    }
    if (binding.kind === 'storage') {
      const buffer = uniforms[binding.name]?.value;
      if (!buffer) throw new Error(`${this.label}: no storage buffer "${binding.name}"`);
      return { key: `s${buffer.label}`, resource: { buffer } };
    }
    if (!(binding.name in uniforms)) throw new Error(`${this.label}: no texture uniform "${binding.name}"`);
    const texture = uniforms[binding.name].value;
    if (!texture) return { key: 'null', resource: this.gpu.placeholder(binding.type) };
    return { key: `${texture.uid}:${texture.version}`, resource: texture.view };
  }

  dispose() {
    for (const b of this.buffers) b.buffer.destroy();
    this.buffers = [];
    this.groups.clear();
  }
}

function equal(a, b) {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}
