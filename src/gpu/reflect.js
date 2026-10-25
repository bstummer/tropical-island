// What a WGSL module declares, read from its source, so materials can bind by
// name: its structs, its resources by group and binding, its overrides and the
// vertex inputs of its entry points. A reader for the WGSL this project
// writes, not a parser for any WGSL: one declaration per statement, attributes
// on the same line as the `var` they belong to. Pure: tests/reflect.test.js.

// Scalar and vector types, and how they sit in a uniform buffer (WGSL's layout rules).
const SCALARS = { f32: 4, i32: 4, u32: 4 };
const VECTOR = /^vec([234])(?:<(f32|i32|u32)>|([fiu]))$/;
const MATRIX = /^mat([234])x([234])(?:<f32>|f)$/;
const ARRAY = /^array<(.+),\s*(\d+)\s*>$/;

export function stripComments(source) {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
}

// { structs: { Name: [{ name, type, location? }] }, bindings: [{ group, binding,
// name, kind, type }], overrides: { NAME: { type, value } }, entries: { name:
// { stage, input } } }. kind: 'uniform', 'storage', 'texture', 'sampler'.
export function reflect(source) {
  const code = stripComments(source);
  const structs = {};
  for (const [, name, body] of code.matchAll(/\bstruct\s+(\w+)\s*\{([^}]*)\}/g)) {
    structs[name] = splitTop(body).map((field) => {
      // The layout below knows nothing of them: a field would be written elsewhere than read.
      if (/@(align|size)\s*\(/.test(field)) throw new Error(`reflect: @align/@size in struct ${name}: lay the fields out without them`);
      const location = /@location\((\d+)\)/.exec(field);
      const [, fieldName, type] = /(\w+)\s*:\s*(.+)$/.exec(field.replace(/@\w+(\([^)]*\))?/g, '').trim());
      return { name: fieldName, type: type.trim(), ...(location && { location: Number(location[1]) }) };
    });
  }

  const bindings = [];
  const declaration = /@group\((\d+)\)\s*@binding\((\d+)\)\s*var(?:<([\w,\s]+)>)?\s+(\w+)\s*:\s*([^;]+);/g;
  for (const [, group, binding, space, name, type] of code.matchAll(declaration)) {
    const t = type.trim();
    const kind = space ? (space.trim().startsWith('uniform') ? 'uniform' : 'storage') : t.startsWith('sampler') ? 'sampler' : 'texture';
    bindings.push({ group: Number(group), binding: Number(binding), name, kind, type: t, ...(space && { access: space.split(',')[1]?.trim() ?? 'read' }) });
  }

  const overrides = {};
  for (const [, name, type, value] of code.matchAll(/\boverride\s+(\w+)\s*:\s*(\w+)\s*(?:=\s*([^;]+))?;/g)) {
    overrides[name] = { type, value: value?.trim() ?? null };
  }

  const entries = {};
  for (const match of code.matchAll(/@(vertex|fragment|compute)(?:\s*@workgroup_size\([^)]*\))?\s*fn\s+(\w+)\s*\(/g)) {
    const [, stage, name] = match;
    const input = [];
    for (const param of splitTop(balanced(code, match.index + match[0].length))) {
      const location = /@location\((\d+)\)/.exec(param);
      const [, paramName, type] = /(\w+)\s*:\s*([\w<>]+)\s*$/.exec(param.replace(/@\w+(\([^)]*\))?/g, '').trim());
      if (location) input.push({ name: paramName, type, location: Number(location[1]) });
      else if (structs[type]) input.push(...structs[type].filter((f) => f.location !== undefined));
    }
    entries[name] = { stage, input };
  }
  return { structs, bindings, overrides, entries };
}

// The text from `start` up to the ")" that closes the "(" before it.
function balanced(code, start) {
  let depth = 1;
  for (let i = start; i < code.length; i++) {
    if (code[i] === '(') depth++;
    else if (code[i] === ')' && --depth === 0) return code.slice(start, i);
  }
  throw new Error('reflect: unbalanced parentheses');
}

// Splits a list on its commas, but not those inside <> or ().
function splitTop(list) {
  const parts = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i <= list.length; i++) {
    const c = list[i];
    if (c === '<' || c === '(') depth++;
    else if (c === '>' || c === ')') depth--;
    else if (i === list.length || (c === ',' && depth === 0)) {
      const part = list.slice(start, i).trim();
      if (part) parts.push(part);
      start = i + 1;
    }
  }
  return parts;
}

// Alignment and size in bytes of a type in a uniform buffer.
export function typeLayout(type, structs = {}) {
  if (SCALARS[type]) return { align: 4, size: 4 };
  let m = VECTOR.exec(type);
  if (m) {
    const n = Number(m[1]);
    return { align: n === 2 ? 8 : 16, size: 4 * n };
  }
  m = MATRIX.exec(type);
  if (m) {
    const [columns, rows] = [Number(m[1]), Number(m[2])];
    const column = rows === 2 ? 8 : 16;
    return { align: column, size: column * columns };
  }
  m = ARRAY.exec(type);
  if (m) {
    // A uniform array's elements must be aligned to 16 bytes and lie 16 apart,
    // as core WGSL wants them. Narrower ones (f32, vec2f, mat2x2f) lie closer
    // where the browser has uniform_buffer_standard_layout and fail to compile
    // where it hasn't: hold them in vec4f instead.
    const element = typeLayout(m[1].trim(), structs);
    const stride = roundUp(element.size, element.align);
    if (stride % 16 || element.align % 16) throw new Error(`reflect: a uniform array of ${m[1].trim()} (${stride} bytes apart); use vec4f elements`);
    return { align: element.align, size: stride * Number(m[2]), stride, element: m[1].trim(), count: Number(m[2]) };
  }
  if (structs[type]) {
    const fields = structLayout(type, structs);
    const align = Math.max(...fields.map((f) => f.align));
    const end = fields.length ? fields.at(-1).offset + fields.at(-1).size : 0;
    return { align, size: roundUp(end, align), fields };
  }
  throw new Error(`reflect: no uniform layout for type "${type}"`);
}

// The fields of a struct with their offsets, as a uniform buffer holds them.
export function structLayout(name, structs) {
  let offset = 0;
  return structs[name].map((field) => {
    const layout = typeLayout(field.type, structs);
    // Likewise a struct within one: aligned to 16 bytes by a field of its own.
    if (layout.fields && layout.align % 16) throw new Error(`reflect: struct ${field.type} in a uniform struct aligns to ${layout.align} bytes; give it a vec3f or vec4f field`);
    offset = roundUp(offset, layout.align);
    const placed = { ...field, ...layout, offset };
    offset += layout.size;
    return placed;
  });
}

// A whole uniform buffer's size, rounded up to 16 bytes.
export function structSize(name, structs) {
  return roundUp(typeLayout(name, structs).size, 16);
}

function roundUp(n, align) {
  return Math.ceil(n / align) * align;
}

// Float, signed and unsigned 32-bit views of the same bytes, which
// fieldWriter's writers write into.
export function words(buffer, byteOffset = 0, length = (buffer.byteLength - byteOffset) / 4) {
  return { f32: new Float32Array(buffer, byteOffset, length), i32: new Int32Array(buffer, byteOffset, length), u32: new Uint32Array(buffer, byteOffset, length) };
}

// A writer of `field` (from structLayout) at byte `base`: write(w, value) puts
// `value` (a number, boolean, array, or a vector, colour or matrix of maths/)
// into w, words() of the buffer. The type is worked out once, here, so packing
// every frame costs no parsing.
export function fieldWriter(field, base = 0, structs = {}) {
  const at = (base + field.offset) / 4;
  const type = field.type;
  if (SCALARS[type]) {
    const put = scalarWriter(type);
    return (w, value) => put(w, at, value);
  }
  let m = VECTOR.exec(type);
  if (m) {
    const n = Number(m[1]);
    const put = scalarWriter(m[2] ?? { f: 'f32', i: 'i32', u: 'u32' }[m[3]]);
    const components = (count) => new Error(`reflect: "${field.name}" (${type}) got ${count} components`);
    return (w, value) => {
      if (Array.isArray(value) || ArrayBuffer.isView(value)) {
        if (value.length !== n) throw components(value.length);
        for (let i = 0; i < n; i++) put(w, at + i, value[i]);
      } else if (value?.isColor) {
        if (n !== 3) throw components(3);
        put(w, at, value.r);
        put(w, at + 1, value.g);
        put(w, at + 2, value.b);
      } else if (value && typeof value === 'object' && 'x' in value) {
        // The x, y, z, w a vector (of maths/ or a plain object) has: as many as the field's.
        if (!(AXES[n - 1] in value) || AXES[n] in value) throw components(AXES.filter((key) => key in value).length);
        put(w, at, value.x);
        put(w, at + 1, value.y);
        if (n > 2) put(w, at + 2, value.z);
        if (n > 3) put(w, at + 3, value.w);
      } else {
        throw new Error(`reflect: expected a vector, got ${value}`);
      }
    };
  }
  m = MATRIX.exec(type);
  if (m) {
    const [columns, rows] = [Number(m[1]), Number(m[2])];
    const stride = rows === 2 ? 2 : 4;
    return (w, value) => {
      const elements = value?.elements ?? value; // maths/ matrices are column-major, as WGSL's
      if (elements?.length !== columns * rows) throw new Error(`reflect: "${field.name}" (${type}) needs ${columns * rows} elements, got ${elements?.length}`);
      for (let c = 0; c < columns; c++) for (let r = 0; r < rows; r++) w.f32[at + c * stride + r] = elements[c * rows + r];
    };
  }
  if (field.count !== undefined) {
    const element = { type: field.element, offset: 0, ...typeLayout(field.element, structs) };
    const elements = Array.from({ length: field.count }, (_, i) => fieldWriter({ ...element, name: `${field.name}[${i}]` }, base + field.offset + i * field.stride, structs));
    return (w, value) => {
      for (let i = 0; i < elements.length; i++) {
        if (value[i] === undefined) throw new Error(`reflect: "${field.name}" has ${value.length} elements, the shader ${field.count}`);
        elements[i](w, value[i]);
      }
    };
  }
  if (field.fields) {
    const members = field.fields.map((f) => [f.name, fieldWriter(f, base + field.offset, structs)]);
    return (w, value) => {
      for (const [name, write] of members) write(w, value[name]);
    };
  }
  throw new Error(`reflect: can't write "${field.name}" of type ${type}`);
}

const AXES = ['x', 'y', 'z', 'w'];

// Writes a number as f32, or a whole number in range as i32 or u32; booleans
// only as u32 (WGSL's bool has no layout): put(w, word, value).
function scalarWriter(type) {
  if (type === 'f32') {
    return (w, at, value) => {
      if (typeof value !== 'number') throw new Error(`reflect: expected a number for f32, got ${value}`);
      w.f32[at] = value;
    };
  }
  const [min, max, view] = type === 'i32' ? [-(2 ** 31), 2 ** 31 - 1, 'i32'] : [0, 2 ** 32 - 1, 'u32'];
  return (w, at, value) => {
    const v = typeof value === 'boolean' && type === 'u32' ? Number(value) : value;
    if (typeof v !== 'number') throw new Error(`reflect: expected a number for ${type}, got ${value}`);
    if (!Number.isInteger(v) || v < min || v > max) throw new Error(`reflect: ${v} is no ${type}`);
    w[view][at] = v;
  };
}
