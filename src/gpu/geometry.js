// Vertex data for draws: named attributes, each in a buffer of its own, matched
// by name to the vertex shader's inputs (renderer.js), per vertex or per
// instance, and an optional index. The renderer creates the GPU buffers on
// first use and uploads what changed since (update()).
//
// Geometries may share an Attribute, and with it its buffer: a system that
// draws its instances with several meshes (a shader variant or a shape each)
// keeps them all in one set of attributes, each mesh drawing a range of them
// (firstInstance, instanceCount), and uploads them at once.
//
// plane(), box() and sphere() build the shapes three.js's PlaneGeometry,
// BoxGeometry and SphereGeometry do, vertex for vertex (three.js, MIT).

import { Matrix3, Vector3 } from '../maths/index.js';

const FORMATS = { 1: 'float32', 2: 'float32x2', 3: 'float32x3', 4: 'float32x4' };

// array: a Float32Array (or plain array); itemSize: floats per vertex or instance.
export class Attribute {
  constructor(array, itemSize, { instance = false } = {}) {
    this.array = array instanceof Float32Array ? array : new Float32Array(array);
    this.itemSize = itemSize;
    this.format = FORMATS[itemSize];
    this.instance = instance;
    this.dirty = [0, this.array.length]; // the floats changed since the last upload
    this.users = 0; // geometries that hold it
    this.gpu = null; // the renderer's buffer
  }

  // Marks `count` items (vertices or instances) from `start` for upload.
  update(start = 0, count = Infinity) {
    const from = start * this.itemSize;
    const to = Math.min(this.array.length, count === Infinity ? Infinity : from + count * this.itemSize);
    if (to <= from) return;
    this.dirty = this.dirty ? [Math.min(this.dirty[0], from), Math.max(this.dirty[1], to)] : [from, to];
  }
}

// A geometry lets go of an attribute: the last one frees its buffer.
function release(attribute) {
  if (attribute && --attribute.users === 0) {
    attribute.gpu?.destroy();
    attribute.gpu = null;
  }
}

export class Geometry {
  constructor() {
    this.attributes = {};
    this.index = null;
    // Instances to draw, from firstInstance; Infinity: as many as the per-instance attributes hold, or 1.
    this.instanceCount = Infinity;
    this.firstInstance = 0;
    this.version = 0; // counts layout changes (attributes added), which pipelines depend on
    this.gpu = null; // the renderer's
  }

  // array: a Float32Array (or plain array) and itemSize, floats per vertex or
  // instance; or an Attribute to share, made by the caller or another geometry.
  setAttribute(name, array, itemSize, { instance = false } = {}) {
    const attribute = array instanceof Attribute ? array : new Attribute(array, itemSize, { instance });
    release(this.attributes[name]);
    attribute.users++;
    this.attributes[name] = attribute;
    this.version++;
    return this;
  }


  // Indices as three.js stores them: 16-bit unless one needs 32.
  setIndex(indices) {
    const big = indices.some ? indices.some((i) => i > 65535) : false;
    this.index = { array: ArrayBuffer.isView(indices) ? indices : big ? new Uint32Array(indices) : new Uint16Array(indices), dirty: true };
    this.version++;
    return this;
  }

  // Transforms the positions, and the normals with their matrix, in place, as three.js's applyMatrix4.
  applyMatrix4(matrix) {
    const v = new Vector3();
    const transform = (name, fn) => {
      const attribute = this.attributes[name];
      if (!attribute) return;
      const a = attribute.array;
      for (let i = 0; i < a.length; i += 3) fn(v.set(a[i], a[i + 1], a[i + 2])).toArray(a, i);
      attribute.dirty = [0, a.length];
    };
    const normalMatrix = new Matrix3().getNormalMatrix(matrix);
    transform('position', (p) => p.applyMatrix4(matrix));
    transform('normal', (n) => n.applyNormalMatrix(normalMatrix));
    this.boundingSphere = null;
    return this;
  }

  // Marks `count` items (vertices or instances) from `start` of an attribute for upload.
  update(name, start = 0, count = Infinity) {
    this.attributes[name].update(start, count);
  }

  // Vertices (or indices) one instance draws.
  get count() {
    if (this.vertexCount !== undefined) return this.vertexCount; // drawn without vertex data
    if (this.index) return this.index.array.length;
    const position = this.attributes.position;
    return position ? position.array.length / position.itemSize : 0;
  }

  get instances() {
    if (this.instanceCount !== Infinity) return this.instanceCount;
    let n = Infinity;
    for (const a of Object.values(this.attributes)) if (a.instance) n = Math.min(n, a.array.length / a.itemSize);
    return n === Infinity ? 1 : n - this.firstInstance;
  }

  dispose() {
    for (const attribute of Object.values(this.attributes)) release(attribute);
    this.attributes = {};
    this.gpu?.index?.destroy();
    this.gpu = null;
  }
}

export function plane(width = 1, height = 1, widthSegments = 1, heightSegments = 1) {
  const gridX = Math.floor(widthSegments);
  const gridY = Math.floor(heightSegments);
  const [segmentWidth, segmentHeight] = [width / gridX, height / gridY];
  const [vertices, normals, uvs, indices] = [[], [], [], []];
  for (let iy = 0; iy <= gridY; iy++) {
    const y = iy * segmentHeight - height / 2;
    for (let ix = 0; ix <= gridX; ix++) {
      vertices.push(ix * segmentWidth - width / 2, -y, 0);
      normals.push(0, 0, 1);
      uvs.push(ix / gridX, 1 - iy / gridY);
    }
  }
  for (let iy = 0; iy < gridY; iy++) {
    for (let ix = 0; ix < gridX; ix++) {
      const a = ix + (gridX + 1) * iy;
      const b = ix + (gridX + 1) * (iy + 1);
      const c = ix + 1 + (gridX + 1) * (iy + 1);
      const d = ix + 1 + (gridX + 1) * iy;
      indices.push(a, b, d, b, c, d);
    }
  }
  return shape(vertices, normals, uvs, indices);
}

export function box(width = 1, height = 1, depth = 1) {
  const [vertices, normals, uvs, indices] = [[], [], [], []];
  const side = (u, v, w, udir, vdir, sw, sh, sd) => {
    const first = vertices.length / 3;
    const vector = { x: 0, y: 0, z: 0 };
    for (let iy = 0; iy <= 1; iy++) {
      for (let ix = 0; ix <= 1; ix++) {
        vector[u] = (ix * sw - sw / 2) * udir;
        vector[v] = (iy * sh - sh / 2) * vdir;
        vector[w] = sd / 2;
        vertices.push(vector.x, vector.y, vector.z);
        vector[u] = 0;
        vector[v] = 0;
        vector[w] = sd > 0 ? 1 : -1;
        normals.push(vector.x, vector.y, vector.z);
        uvs.push(ix, 1 - iy);
      }
    }
    const [a, b, c, d] = [first, first + 2, first + 3, first + 1];
    indices.push(a, b, d, b, c, d);
  };
  side('z', 'y', 'x', -1, -1, depth, height, width);
  side('z', 'y', 'x', 1, -1, depth, height, -width);
  side('x', 'z', 'y', 1, 1, width, depth, height);
  side('x', 'z', 'y', 1, -1, width, depth, -height);
  side('x', 'y', 'z', 1, -1, width, height, depth);
  side('x', 'y', 'z', -1, -1, width, height, -depth);
  return shape(vertices, normals, uvs, indices);
}

export function sphere(radius = 1, widthSegments = 32, heightSegments = 16) {
  const ws = Math.max(3, Math.floor(widthSegments));
  const hs = Math.max(2, Math.floor(heightSegments));
  const [vertices, normals, uvs, indices] = [[], [], [], []];
  const grid = [];
  let index = 0;
  for (let iy = 0; iy <= hs; iy++) {
    const row = [];
    const v = iy / hs;
    const theta = v * Math.PI;
    const y = radius * Math.cos(theta);
    const ring = Math.sqrt(radius * radius - y * y);
    const uOffset = iy === 0 ? 0.5 / ws : iy === hs ? -0.5 / ws : 0;
    for (let ix = 0; ix <= ws; ix++) {
      const u = ix / ws;
      const phi = u * Math.PI * 2;
      const [x, z] = [-ring * Math.cos(phi), ring * Math.sin(phi)];
      vertices.push(x, y, z);
      const scale = 1 / (Math.sqrt(x * x + y * y + z * z) || 1); // as three.js's normalize()
      normals.push(x * scale, y * scale, z * scale);
      uvs.push(u + uOffset, 1 - v);
      row.push(index++);
    }
    grid.push(row);
  }
  for (let iy = 0; iy < hs; iy++) {
    for (let ix = 0; ix < ws; ix++) {
      const [a, b, c, d] = [grid[iy][ix + 1], grid[iy][ix], grid[iy + 1][ix], grid[iy + 1][ix + 1]];
      if (iy !== 0) indices.push(a, b, d);
      if (iy !== hs - 1) indices.push(b, c, d);
    }
  }
  return shape(vertices, normals, uvs, indices);
}

function shape(vertices, normals, uvs, indices) {
  return new Geometry().setAttribute('position', vertices, 3).setAttribute('normal', normals, 3).setAttribute('uv', uvs, 2).setIndex(indices);
}
