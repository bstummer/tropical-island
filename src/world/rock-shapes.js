// Rock prototypes (PLAN.md Stage 4.5): a handful of basalt shapes made at
// boot, each drawn thousands of times by world/rocks.js, turned, tipped,
// scaled and sunk into the ground (world/rock-placement.js). Pure and
// Node-importable.
//
// Basalt breaks along flat fractures into angular blocks with crisp edges,
// and its columns into five- and six-sided prisms with broken, slanting ends.
// So every shape is convex, where a few half-spaces meet: a block is a squat
// prism round an ellipse, its sides and top leaning, cut across its upper
// edges by large fractures; a column is a prism of uneven sides with
// slanting ends, some stepped by a further break. Then each loses a few
// small chips off its corners and the ends of its edges. A hull of random
// points would give many small facets of one size; planes give a few large
// faces, straight edges and facets of every size, and keep the shape closed.
// The rock shader adds cracks, pits and grain in world space
// (chunks/rock.wgsl), so the meshes carry only the form.
//
// Each prototype lies in its resting pose: a block on its bottom, a column on
// its broadest side with its axis along x. y runs from 0, its lowest point,
// to `height`; the smallest circle round its footprint is centred on the y
// axis with radius 1, so the placer's scale is the rock's half-width. Facets
// are flat: each has its own vertices and normal, drawn indexed.
//
// Shapes are made at a block's half-length or a column's radius of 1, and
// the settings' lengths (edges, chips) are in those units.

const DEG = Math.PI / 180;
const EPS = 1e-9; // how near a plane a corner counts as on it
const ATTEMPTS = 20; // draws for a shape or a cut before giving up on it
const BOX = 10; // half-size of the cube the shapes are cut from, well beyond any of them

// rng: a seeded stream (core/random.js). settings: config.world.rocks.shapes.
// Returns [{ kind: 'block' | 'column', positions, normals (Float32Array, xyz),
// index (Uint16Array, triangles), height }].
export function makeRockShapes(rng, settings) {
  const shapes = [
    ...Array.from({ length: settings.blocks.count }, () => ({ kind: 'block', poly: block(rng, settings) })),
    ...Array.from({ length: settings.columns.count }, () => ({ kind: 'column', poly: column(rng, settings) })),
  ];
  // Chipped once all are shaped, so changing the chips leaves the shapes beneath as they are.
  return shapes.map(({ kind, poly }) => finish(kind, chip(poly, rng, settings), settings));
}

// A block: a prism round an ellipse of half-length 1 along x, on a level
// bottom, its sides spaced unevenly and leaning, its top tilted; then a few
// fractures across its upper edges and corners.
function block(rng, s) {
  const b = s.blocks;
  for (let attempt = 0; attempt < ATTEMPTS; attempt++) {
    const width = rng.range(...b.width);
    const height = 2 * rng.range(...b.height);
    const sides = rng.int(...b.sides);
    const top = tilt([0, 1, 0], rng.range(0, b.topTilt) * DEG, rng.range(0, 2 * Math.PI));
    const planes = [{ n: [0, -1, 0], d: 0 }, { n: top, d: height * top[1] }];
    for (let i = 0; i < sides; i++) {
      const theta = (2 * Math.PI * (i + rng.range(-b.jitter, b.jitter))) / sides;
      const lean = rng.range(...b.lean) * DEG;
      const n = [Math.cos(theta) * Math.cos(lean), Math.sin(lean), Math.sin(theta) * Math.cos(lean)];
      // Through the ellipse's tangent, at half height.
      const reach = Math.hypot(Math.cos(theta), width * Math.sin(theta)) * (1 + rng.range(-b.offset, b.offset));
      planes.push({ n, d: reach * Math.cos(lean) + (height / 2) * Math.sin(lean) });
    }
    let poly = intersect(planes, s);
    if (!poly) continue;
    for (let k = rng.int(...b.fractures); k > 0; k--) {
      poly = cutWith(poly, s, (p) => {
        const up = rng.range(...b.fractureElevation) * DEG;
        const around = rng.range(0, 2 * Math.PI);
        const n = [Math.cos(up) * Math.cos(around), Math.sin(up), Math.cos(up) * Math.sin(around)];
        return { n, depth: rng.range(...b.fractureDepth) * extent(p, n) };
      });
    }
    return poly;
  }
  throw new Error('rock shapes: no block came out well shaped; see config.world.rocks.shapes');
}

// A column: a prism of uneven sides round the x axis at radius 1, its ends
// slanting, some stepped by a break; laid on its broadest side.
function column(rng, s) {
  const c = s.columns;
  for (let attempt = 0; attempt < ATTEMPTS; attempt++) {
    const sides = rng.int(...c.sides);
    const half = rng.range(...c.length); // half its length at radius 1 is its length over its width
    const turn = rng.range(0, 2 * Math.PI);
    const planes = [];
    for (let i = 0; i < sides; i++) {
      const phi = turn + (2 * Math.PI * (i + rng.range(-c.jitter, c.jitter))) / sides;
      planes.push({ n: [0, Math.cos(phi), Math.sin(phi)], d: 1 + rng.range(-c.offset, c.offset), tag: 'side' });
    }
    for (const end of [-1, 1]) {
      const n = tilt([end, 0, 0], rng.range(...c.endTilt) * DEG, rng.range(0, 2 * Math.PI));
      planes.push({ n, d: half * end * n[0] });
    }
    let poly = intersect(planes, s);
    if (!poly) continue;
    for (let k = rng.int(...c.breaks); k > 0; k--) {
      poly = cutWith(poly, s, () => ({
        n: tilt([rng.pick([-1, 1]), 0, 0], rng.range(...c.breakTilt) * DEG, rng.range(0, 2 * Math.PI)),
        depth: 2 * rng.range(...c.breakDepth),
      }));
    }
    const faces = poly.faces.filter((f) => f.tag === 'side');
    if (faces.length === sides) return layDown(poly, faces); // else a break took a whole side
  }
  throw new Error('rock shapes: no column came out well shaped; see config.world.rocks.shapes');
}

// Turned about its axis (x) until the broadest of `sides` faces down.
function layDown(poly, sides) {
  const broadest = sides.reduce((a, f) => (area(poly, f) > area(poly, a) ? f : a));
  const angle = Math.PI - Math.atan2(broadest.n[2], broadest.n[1]);
  const [cos, sin] = [Math.cos(angle), Math.sin(angle)];
  const turn = ([x, y, z]) => [x, y * cos - z * sin, y * sin + z * cos];
  return { verts: poly.verts.map(turn), faces: poly.faces.map((f) => ({ ...f, n: turn(f.n) })) };
}

// A few small chips off its corners and the ends of its edges, none off the
// face it rests on: that lies in the ground. Where faces meet at a shallow
// angle a cut can plane off a whole face; a chip's new facet stays small.
function chip(poly, rng, s) {
  const small = (cut) => {
    const corners = cut.faces.at(-1).loop.map((i) => cut.verts[i]);
    return corners.every((p) => corners.every((q) => length(sub(p, q)) <= s.chips.span));
  };
  for (let k = rng.int(...s.chips.count); k > 0; k--) poly = cutWith(poly, s, (p) => chipPlane(p, rng, s), small);
  return poly;
}

function chipPlane(poly, rng, s) {
  const c = s.chips;
  const bottom = Math.min(...poly.verts.map((v) => v[1]));
  const a = rng.pick(poly.verts.flatMap((v, i) => (v[1] > bottom + s.minEdge ? [i] : [])));
  const around = poly.faces.filter((f) => f.loop.includes(a));
  const depth = rng.range(...c.depth);
  // Between the faces it breaks across, weighted unevenly: chips are lopsided.
  const between = (faces) => normalize(faces.reduce((sum, f) => add(sum, scale(f.n, 1 + rng.range(-c.skew, c.skew))), [0, 0, 0]));
  if (!rng.chance(c.edgeChance)) return { n: between(around), depth };
  // Off the end of an edge: tilted along it, so the cut runs out partway down it.
  const b = rng.pick(around.map(({ loop }) => loop[(loop.indexOf(a) + 1) % loop.length]));
  const across = between(around.filter((f) => f.loop.includes(b)));
  const along = normalize(sub(poly.verts[a], poly.verts[b]));
  const taper = rng.range(...c.taper) * DEG;
  return { n: add(scale(across, Math.cos(taper)), scale(along, Math.sin(taper))), depth };
}

// The polyhedron cut by the first plane from draw(poly) that leaves it well
// shaped and passes fits(cut), or as it was if none of ATTEMPTS does. draw
// gives { n, depth }: shave `depth` off it from its furthest point along n.
function cutWith(poly, s, draw, fits = () => true) {
  for (let attempt = 0; attempt < ATTEMPTS; attempt++) {
    const { n, depth } = draw(poly);
    const cut = clip(poly, { n, d: Math.max(...poly.verts.map((v) => dot(n, v))) - depth });
    if (cut && wellShaped(cut, s) && fits(cut)) return cut;
  }
  return poly;
}

// A convex polyhedron is { verts: [[x, y, z]], faces: [{ loop, n, tag }] }:
// each loop the indices of a face's corners, counter-clockwise seen from
// outside, n its outward normal.

// Where the half-spaces n·x <= d of `planes` meet, or null if a plane misses
// it, they leave it unbounded, or it comes out badly shaped.
function intersect(planes, s) {
  let poly = cube(BOX);
  for (const plane of planes) {
    poly = clip(poly, plane);
    if (!poly) return null;
  }
  return poly.faces.some((f) => f.tag === 'cube') || !wellShaped(poly, s) ? null : poly;
}

function cube(size) {
  const verts = [];
  for (let i = 0; i < 8; i++) verts.push([0, 1, 2].map((axis) => ((i >> axis) & 1 ? size : -size)));
  const faces = [];
  for (let axis = 0; axis < 3; axis++) {
    for (const sign of [-1, 1]) {
      const n = [0, 0, 0];
      n[axis] = sign;
      const corners = [...verts.keys()].filter((i) => verts[i][axis] === sign * size);
      faces.push({ n, tag: 'cube', loop: orderLoop(corners, n, verts) });
    }
  }
  return { verts, faces };
}

// The part of a convex polyhedron with n·x <= d, closed by a new face on the
// plane, its last; null if the plane misses it or takes it all.
function clip(poly, { n, d, tag }) {
  const dist = poly.verts.map((v) => dot(n, v) - d);
  if (dist.every((x) => x <= EPS) || dist.every((x) => x >= -EPS)) return null;
  const verts = poly.verts.slice();
  const inside = (i) => dist[i] <= EPS;
  const onPlane = new Set(dist.flatMap((x, i) => (Math.abs(x) <= EPS ? [i] : [])));
  // Where an edge from inside to out meets the plane: made once, so the faces either side share it.
  const meets = new Map();
  const meet = (i, o) => {
    if (onPlane.has(i)) return i;
    const key = `${i},${o}`;
    if (!meets.has(key)) {
      const at = verts.push(lerp(poly.verts[i], poly.verts[o], dist[i] / (dist[i] - dist[o]))) - 1;
      meets.set(key, at);
      onPlane.add(at);
    }
    return meets.get(key);
  };
  const faces = [];
  for (const face of poly.faces) {
    const loop = [];
    face.loop.forEach((a, k) => {
      const b = face.loop[(k + 1) % face.loop.length];
      if (inside(a)) loop.push(a);
      if (inside(a) !== inside(b)) loop.push(inside(a) ? meet(a, b) : meet(b, a));
    });
    // A corner on the plane meets itself: once is enough.
    const corners = loop.filter((v, k) => v !== loop[(k + 1) % loop.length]);
    if (corners.length >= 3) faces.push({ ...face, loop: corners });
  }
  const cap = [...new Set(faces.flatMap((f) => f.loop))].filter((i) => onPlane.has(i));
  if (cap.length < 3) return null;
  faces.push({ n, tag, loop: orderLoop(cap, n, verts) });
  return compact(verts, faces);
}

// Corners on a plane, in order counter-clockwise seen from n's side.
function orderLoop(corners, n, verts) {
  const centre = scale(corners.reduce((sum, i) => add(sum, verts[i]), [0, 0, 0]), 1 / corners.length);
  const [u, w] = basis(n);
  const angle = (i) => {
    const p = sub(verts[i], centre);
    return Math.atan2(dot(p, w), dot(p, u));
  };
  return corners.map((i) => [angle(i), i]).sort((p, q) => p[0] - q[0]).map(([, i]) => i);
}

// Drops the corners no face uses any more.
function compact(verts, faces) {
  const kept = [];
  const index = new Map();
  const remap = (i) => {
    if (!index.has(i)) index.set(i, kept.push(verts[i]) - 1);
    return index.get(i);
  };
  const remapped = faces.map((f) => ({ ...f, loop: f.loop.map(remap) }));
  return { verts: kept, faces: remapped };
}

// Whether every edge is long enough, every facet broad enough and every corner
// sharp enough to draw without slivers, within the vertex budget.
function wellShaped(poly, s) {
  const minTurn = Math.PI - s.maxAngle * DEG;
  let count = 0;
  for (const { loop } of poly.faces) {
    count += loop.length;
    const p = loop.map((i) => poly.verts[i]);
    for (let k = 0; k < p.length; k++) {
      const edge = sub(p[(k + 1) % p.length], p[k]);
      const next = sub(p[(k + 2) % p.length], p[(k + 1) % p.length]);
      // A convex polygon is narrowest across one of its edges.
      const width = Math.max(...p.map((q) => length(cross(edge, sub(q, p[k]))))) / length(edge);
      if (length(edge) < s.minEdge || width < s.minWidth || angleBetween(edge, next) < minTurn) return false;
    }
  }
  return count <= s.maxVertices;
}

// Rests it at y = 0, centres its footprint and scales it to radius 1, then
// lays out each facet's corners with its normal and fans it into triangles.
function finish(kind, poly, s) {
  const bottom = Math.min(...poly.verts.map((v) => v[1]));
  const { x, z, r } = enclosingCircle(poly.verts.map((v) => [v[0], v[2]]));
  const verts = poly.verts.map((v) => [(v[0] - x) / r, (v[1] - bottom) / r, (v[2] - z) / r]);
  const height = Math.max(...verts.map((v) => v[1]));
  const count = poly.faces.reduce((sum, f) => sum + f.loop.length, 0);
  const positions = new Float32Array(3 * count);
  const normals = new Float32Array(3 * count);
  const index = new Uint16Array(3 * (count - 2 * poly.faces.length));
  let vertex = 0;
  let triangle = 0;
  for (const { loop, n } of poly.faces) {
    for (let k = 1; k + 1 < loop.length; k++) index.set([vertex, vertex + k, vertex + k + 1], 3 * triangle++);
    for (const i of loop) {
      positions.set(verts[i], 3 * vertex);
      normals.set(n, 3 * vertex++);
    }
  }
  return { kind, positions, normals, index, height };
}

// The smallest circle round points [x, z] (Welzl's, iteratively): the footprint's.
function enclosingCircle(points) {
  const holds = (c, [x, z]) => Math.hypot(x - c.x, z - c.z) <= c.r * (1 + 1e-12) + 1e-12;
  let circle = { x: points[0][0], z: points[0][1], r: 0 };
  for (let i = 1; i < points.length; i++) {
    if (holds(circle, points[i])) continue;
    circle = { x: points[i][0], z: points[i][1], r: 0 };
    for (let j = 0; j < i; j++) {
      if (holds(circle, points[j])) continue;
      circle = circleOn(points[i], points[j]);
      for (let k = 0; k < j; k++) if (!holds(circle, points[k])) circle = circleThrough(points[i], points[j], points[k]);
    }
  }
  return circle;
}

// The circle with a and b at the ends of a diameter.
function circleOn(a, b) {
  return { x: (a[0] + b[0]) / 2, z: (a[1] + b[1]) / 2, r: Math.hypot(a[0] - b[0], a[1] - b[1]) / 2 };
}

function circleThrough(a, b, c) {
  const [bx, bz, cx, cz] = [b[0] - a[0], b[1] - a[1], c[0] - a[0], c[1] - a[1]];
  const d = 2 * (bx * cz - bz * cx);
  const [b2, c2] = [bx * bx + bz * bz, cx * cx + cz * cz];
  const [ux, uz] = [(cz * b2 - bz * c2) / d, (bx * c2 - cx * b2) / d];
  return { x: a[0] + ux, z: a[1] + uz, r: Math.hypot(ux, uz) };
}

// How far it reaches along unit vector n, from end to end.
function extent(poly, n) {
  const along = poly.verts.map((v) => dot(n, v));
  return Math.max(...along) - Math.min(...along);
}

function area(poly, { loop, n }) {
  const p = loop.map((i) => poly.verts[i]);
  let sum = [0, 0, 0];
  for (let k = 1; k + 1 < p.length; k++) sum = add(sum, cross(sub(p[k], p[0]), sub(p[k + 1], p[0])));
  return dot(sum, n) / 2;
}

// A unit vector `angle` from unit vector v, turned `around` about it.
function tilt(v, angle, around) {
  const [u, w] = basis(v);
  const side = add(scale(u, Math.cos(around)), scale(w, Math.sin(around)));
  return add(scale(v, Math.cos(angle)), scale(side, Math.sin(angle)));
}

// Unit vectors u, w at right angles to unit vector n and each other, u × w = n.
function basis(n) {
  const u = normalize(cross(Math.abs(n[0]) < 0.9 ? [1, 0, 0] : [0, 1, 0], n));
  return [u, cross(n, u)];
}

const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const scale = (a, k) => [a[0] * k, a[1] * k, a[2] * k];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const length = (a) => Math.sqrt(dot(a, a));
const normalize = (a) => scale(a, 1 / length(a));
const lerp = (a, b, t) => add(a, scale(sub(b, a), t));
const angleBetween = (a, b) => Math.acos(Math.min(1, Math.max(-1, dot(a, b) / (length(a) * length(b)))));
