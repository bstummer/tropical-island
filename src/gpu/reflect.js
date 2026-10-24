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
    // A uniform array's elements must lie 16 bytes apart, as core WGSL wants
    // them. Narrower ones (f32, vec2f) lie closer where the browser has
    // uniform_buffer_standard_layout and fail to compile where it hasn't:
    // hold them in vec4f instead.
    const element = typeLayout(m[1].trim(), structs);
    const stride = roundUp(element.size, element.align);
    if (stride % 16) throw new Error(`reflect: a uniform array of ${m[1].trim()} (${stride} bytes apart); use vec4f elements`);
    return { align: Math.max(element.align, 16), size: stride * Number(m[2]), stride, element: m[1].trim(), count: Number(m[2]) };
  }
  if (structs[type]) {
    const fields = structLayout(type, structs);
    const align = Math.max(16, ...fields.map((f) => f.align));
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
    offset = roundUp(offset, layout.align);
    const placed = { ...field, ...layout, offset };
    offset += layout.size;
    return placed;
  });
}

export function structSize(name, structs) {
  return typeLayout(name, structs).size;
}

function roundUp(n, align) {
  return Math.ceil(n / align) * align;
}

// Writes `value` (a number, boolean, array, or a three.js vector, colour or
// matrix) as `field` (from structLayout) into `view` at `base`.
export function writeField(view, base, field, value, structs = {}) {
  const at = base + field.offset;
  const type = field.type;
  if (SCALARS[type]) return writeScalar(view, at, type, value);
  let m = VECTOR.exec(type);
  if (m) {
    const scalar = m[2] ?? { f: 'f32', i: 'i32', u: 'u32' }[m[3]];
    const values = components(value, Number(m[1]));
    values.forEach((v, i) => writeScalar(view, at + 4 * i, scalar, v));
    return;
  }
  m = MATRIX.exec(type);
  if (m) {
    const [columns, rows] = [Number(m[1]), Number(m[2])];
    const stride = rows === 2 ? 8 : 16;
    const elements = value?.elements ?? value; // three.js matrices are column-major, as WGSL's
    for (let c = 0; c < columns; c++) for (let r = 0; r < rows; r++) view.setFloat32(at + c * stride + 4 * r, elements[c * rows + r], true);
    return;
  }
  if (field.count !== undefined) {
    const element = { type: field.element, offset: 0, ...typeLayout(field.element, structs) };
    for (let i = 0; i < field.count; i++) {
      if (value[i] === undefined) throw new Error(`reflect: "${field.name}" has ${value.length} elements, the shader ${field.count}`);
      writeField(view, at + i * field.stride, element, value[i], structs);
    }
    return;
  }
  if (field.fields) {
    for (const f of field.fields) writeField(view, at, f, value[f.name], structs);
    return;
  }
  throw new Error(`reflect: can't write "${field.name}" of type ${type}`);
}

function writeScalar(view, at, type, value) {
  const v = typeof value === 'boolean' ? Number(value) : value;
  if (typeof v !== 'number') throw new Error(`reflect: expected a number, got ${value}`);
  if (type === 'f32') view.setFloat32(at, v, true);
  else if (type === 'i32') view.setInt32(at, v, true);
  else view.setUint32(at, v, true);
}

function components(value, n) {
  if (Array.isArray(value) || ArrayBuffer.isView(value)) return Array.from(value).slice(0, n);
  if (value?.isColor) return [value.r, value.g, value.b, 1].slice(0, n);
  if (value && typeof value === 'object' && 'x' in value) return [value.x, value.y, value.z ?? 0, value.w ?? 0].slice(0, n);
  throw new Error(`reflect: expected a vector, got ${value}`);
}
