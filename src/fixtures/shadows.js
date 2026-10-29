// Tool fixture (?fixture=shadows): the sun's shadow maps (sky/shadows.js) shade
// what JS's rays say they shade. On level ground ahead of the camera, in a row
// across the sun's way, so no shadow falls on another's patch, stand a block,
// which its vertex shader moves 2 m from its mesh's place, a thin pole, a slab
// floating 1.6 m up, a card with round holes square to the sun, cast through a
// cut-out (its shadow material's fragment discards where the holes are), a
// wall 25 m high, further out a block 70 m off, in the last cascade, and
// further along the row two patches of sloping ground, one facing the sun and
// one turned from it, each with a block standing in it. The slopes cast
// nothing, as the island's ground casts nothing into the maps. JS casts rays
// towards the sun from points on the ground around them, and the GPU reads the
// maps there (chunks/shadows.wgsl shadowMap, in shadows-check.wgsl), where
// each point is clearly in shade or clearly lit (its neighbours a few
// centimetres round agree, more as the sun's disk softens the shadow further
// from its caster): in shade, lit, lit through the card's holes, at the
// blocks' feet on their shady side (a shadow starts at its caster), on the
// faces of the blocks and the slab that face the sun (a surface doesn't shade
// itself), and on ground far past the maps' far end, away from the sun (lit:
// nothing casts there). Only points the maps hold (ctx.shadows.covers) count,
// and along the sun's way a point is clear only if it is so further out the
// lower the sun: a point is read a texel or two off its surface, which on the
// ground under a grazing sun lies tenths of a metre along a shadow (invisible
// in a shadow tens of metres long). A foot counts as shaded below half the
// sun: at a grazing sun the filter half-lights a shadow's first centimetres.
//
// And how soft: across each side of the wall's shadow, at distances from the
// wall, the GPU's penumbra against the one the sun's disk makes there (as
// config.shadows.softness widens it), or, where that is sharper than the maps'
// texels can show, the one the finest map that holds it makes (`contact`).
//
// And its deliberate mistakes, which each set must catch: the faces read 2
// texels into themselves (acne), the feet read 2.5 m towards the sun (a
// shadow off its caster), a second moved block whose shadow material doesn't
// move it (cast from where its mesh is, not where it is drawn), a second card
// whose shadow material has no cut-out (cast solid), further along the row,
// and the wall's shadow as sharp far out as at its foot, and as soft at its
// foot as far out. window.__SHADOWS__ holds each set's share of points the
// GPU gets wrong, for tools/screenshot.js. Not part of the island.
import shader from './shadows.wgsl';
import checkShader from './shadows-check.wgsl';
import { Material } from '../gpu/material.js';
import { box, plane } from '../gpu/geometry.js';
import { Mesh, Node } from '../gpu/scene.js';
import { Texture, createTarget } from '../gpu/texture.js';
import { Matrix4, Vector3 } from '../maths/index.js';
import { sunPath } from '../sky/sun.js';

const MOVE = 2; // m: how far the moved blocks' vertex shader moves them, across the sun's way
const HOLE = { spacing: 0.6, radius: 0.24 }; // the card's holes (shadows.wgsl inHole)
const WALL = { width: 2.5, height: 25 }; // m: high, so its shadow reaches far enough from it to soften under a high sun too
const SLOPE = { size: 14, tilt: 20 }; // m across; degrees, the one turned from the sun less under a low sun, so the sun still reaches it
// m from the wall along its shadow's sides, where the contact check measures them.
const DISTANCES = [0.3, 0.6, 1, 1.5, 2.2, 3, 4, 5.5, 7.5, 10, 13, 17, 22, 28, 35];
const PROFILE = 41; // points across a side

export function create(ctx) {
  const { scene, camera, frame, renderer } = ctx;
  const group = new Node();
  scene.add(group);
  const sun = sunPath.position(ctx.timeOfDay).direction;
  const across = Math.hypot(sun[0], sun[2]);
  const toSun = [sun[0] / across, sun[2] / across]; // level, towards the sun
  const elevation = Math.asin(sun[1]);
  // Across the sun's way, so a block cast from its mesh's place casts a shadow of its own.
  const shift = [-toSun[1] * MOVE, 0, toSun[0] * MOVE];

  // On the ground ahead of the camera, and along a row across the sun's way.
  const m = camera.matrixWorld.elements;
  const ahead = Math.hypot(m[8], m[10]);
  const f = [-m[8] / ahead, -m[10] / ahead];
  const at = (forward, aside) => [camera.position.x + f[0] * forward - toSun[1] * aside, camera.position.z + f[1] * forward + toSun[0] * aside];

  const materials = [];
  const geometries = [];
  const casterMaterial = (name, uniforms) => {
    const material = new Material({ name, shader, uniforms, side: 'double' });
    materials.push(material);
    return material;
  };
  const uniformsOf = (shift, holes, albedo) => ({ uShift: { value: new Vector3(...shift) }, uHoles: { value: holes }, uAlbedo: { value: new Vector3(...albedo) } });

  // Each caster: a mesh drawn where `centre` (world) is, and one in the shadow
  // pass, with the same material's shader and uniforms unless a mistake says otherwise.
  // JS's twins: { kind: 'box', min, max, standing, ground? } or { kind: 'card', centre, right, up, normal, half: [across, up], holes }.
  function add(geometry, centre, { shift = [0, 0, 0], holes = 0, turn = [0, 0], shadow = {} } = {}) {
    geometries.push(geometry);
    const uniforms = uniformsOf(shift, holes, [0.35, 0.3, 0.25]);
    const drawn = casterMaterial('fixture-shadows', uniforms);
    const cast = new Material({
      name: 'fixture-shadows-cast',
      shader,
      uniforms: shadow.uniforms ?? uniforms,
      side: 'double',
      fragment: shadow.fragment === undefined ? (holes ? 'cutOut' : null) : shadow.fragment,
      depthBiasSlope: -1.5,
    });
    materials.push(cast);
    for (const [material, pass] of [[drawn, 'opaque'], [cast, 'shadow']]) {
      const mesh = new Mesh(geometry, material);
      mesh.pass = pass;
      mesh.position.set(centre[0] - shift[0], centre[1] - shift[1], centre[2] - shift[2]);
      mesh.rotation.set(turn[0], turn[1], 0, 'YXZ');
      // Its vertex shader moves it: the renderer would cull it where its mesh is.
      mesh.frustumCulled = false;
      group.add(mesh);
    }
  }
  const block = (forward, aside, [w, h, d], options = {}) => {
    const [x, z] = at(forward, aside);
    const centre = [x, h / 2 + (options.lift ?? 0), z];
    add(box(w, h, d), centre, options);
    return { kind: 'box', min: [x - w / 2, centre[1] - h / 2, z - d / 2], max: [x + w / 2, centre[1] + h / 2, z + d / 2], standing: !options.lift };
  };
  const yaw = Math.atan2(toSun[0], toSun[1]); // turns a card's face (+z) to the sun
  const right = [toSun[1], 0, -toSun[0]];
  const card = (forward, aside, options = {}) => {
    const [x, z] = at(forward, aside);
    const centre = [x, 0.3, z];
    // Its face to the sun, tilted back by the sun's height, so its holes
    // cast round spots at any hour, not slits; low, partly in the ground, so
    // under a low sun some cast theirs close by, where the maps keep them sharp.
    add(plane(2.4, 2.4), centre, { ...options, holes: 1, turn: [-elevation, yaw] });
    const [s, c] = [Math.sin(elevation), Math.cos(elevation)];
    return { kind: 'card', centre, normal: [...sun], right, up: [-s * toSun[0], c, -s * toSun[1]], half: [1.2, 1.2], holes: true };
  };
  const wall = (forward, aside) => {
    const [x, z] = at(forward, aside);
    const centre = [x, WALL.height / 2, z];
    add(plane(WALL.width, WALL.height, 1, 8), centre, { turn: [0, yaw] });
    return { kind: 'card', centre, normal: [toSun[0], 0, toSun[1]], right, up: [0, 1, 0], half: [WALL.width / 2, WALL.height / 2], holes: false };
  };
  // Sloping ground, tilted by `tilt` (degrees) to face the sun (negative: turned
  // from it), its lowest edge on the level ground, which casts nothing; and a
  // block standing in it, its foot below the slope all round.
  const slope = (forward, aside, tilt) => {
    const [x, z] = at(forward, aside);
    const t = (tilt * Math.PI) / 180;
    const normal = [toSun[0] * Math.sin(t), Math.cos(t), toSun[1] * Math.sin(t)];
    const uphill = cross(normal, right);
    const y = (SLOPE.size / 2) * Math.abs(Math.sin(t)) + 0.02;
    const geometry = plane(SLOPE.size, SLOPE.size, 8, 8).applyMatrix4(new Matrix4().set(right[0], uphill[0], normal[0], 0, right[1], uphill[1], normal[1], 0, right[2], uphill[2], normal[2], 0, 0, 0, 0, 1));
    geometries.push(geometry);
    const mesh = new Mesh(geometry, casterMaterial('fixture-shadows', uniformsOf([0, 0, 0], 0, [0.3, 0.3, 0.3])));
    mesh.position.set(x, y, z);
    group.add(mesh);
    const ground = { normal, heightAt: (px, pz) => y - (normal[0] * (px - x) + normal[2] * (pz - z)) / normal[1], half: SLOPE.size / 2 - 1 };
    const corners = [[-0.5, -0.5], [0.5, -0.5], [-0.5, 0.5], [0.5, 0.5]].map(([a, b]) => ground.heightAt(x + a, z + b));
    const foot = Math.min(...corners) - 0.05;
    const caster = block(forward, aside, [1, Math.max(...corners) + 1.5 - foot, 1], { lift: foot });
    return { ...caster, standing: true, ground };
  };

  const theWall = wall(10, -16);
  const correct = [
    card(10, -9),
    block(10, -4.5, [0.1, 3, 0.1]),
    block(10, 0, [1, 1.5, 1], { shift }),
    block(10, 4.5, [2, 0.2, 2], { lift: 1.6 }),
    block(70, -25, [2, 3, 2]),
    theWall,
    slope(10, 24, SLOPE.tilt),
    slope(10, 40, -Math.min(SLOPE.tilt, 0.6 * (elevation * 180) / Math.PI)),
  ];
  // The mistakes: a moved block whose shadow isn't moved, a card cast solid.
  const movedWrong = block(10, 9, [1, 1.5, 1], { shift, shadow: { uniforms: uniformsOf([0, 0, 0], 0, [0, 0, 0]) } });
  const solid = card(10, 13.5, { shadow: { fragment: null } });

  const groundGeometry = plane(400, 400, 40, 40).applyMatrix4(new Matrix4().makeRotationX(-Math.PI / 2));
  geometries.push(groundGeometry);
  const ground = new Mesh(groundGeometry, casterMaterial('fixture-shadows', uniformsOf([0, 0, 0], 0, [0.3, 0.3, 0.3])));
  ground.position.set(camera.position.x, 0, camera.position.z);
  group.add(ground);

  const ready = ctx.sky.ready.then(async () => {
    // The maps for this camera, then the GPU's reading at every point they hold.
    frame.render();
    const { penumbra, covers, texelsAt } = ctx.shadows;
    const sets = pointSets({ sun, toSun, at, correct, movedWrong, solid, shift, camera, penumbra, texelsAt });
    for (const set of Object.values(sets)) set.points = set.points.filter((point) => covers(point.at));
    const profiles = contactProfiles({ wall: theWall, sun, toSun, penumbra, texelsAt, covers });
    const all = [...Object.values(sets).flatMap((s) => s.points), ...profiles.flatMap((p) => p.points.map((at) => ({ at, normal: [0, 1, 0] })))];
    // A texel per point, in rows of up to 2048.
    const width = Math.min(all.length, 2048);
    const height = Math.ceil(all.length / width);
    const texture = (name, values) => {
      const data = new Float32Array(4 * width * height);
      values.forEach((v, i) => data.set(v, 4 * i));
      return new Texture(renderer.gpu, { name, width, height, format: 'rgba32float', data: true }).upload(data);
    };
    const points = texture('fixture-shadows points', all.map((p) => p.at));
    const normals = texture('fixture-shadows normals', all.map((p) => p.normal));
    const target = createTarget(renderer.gpu, { name: 'fixture-shadows', width, height, format: 'rgba32float' });
    const read = async (overrides) => {
      const pass = renderer.fullscreen(new Material({ name: 'fixture-shadows-check', shader: checkShader, uniforms: { uPoints: { value: points }, uNormals: { value: normals } }, overrides }));
      pass.render(target);
      const pixels = await target.color.read();
      pass.dispose();
      return all.map((_, i) => pixels[4 * i]);
    };
    const reads = await read({});
    const acne = await read({ SHADOW_NORMAL_OFFSET: 0, SHADOW_SUN_OFFSET: -2 });
    const detached = await read({ SHADOW_SUN_METRES: 2.5 }); // past the blocks, a shadow off its caster
    const softest = Math.max(0, ...profiles.map((p) => p.h));
    const hard = await read({ SHADOW_PENUMBRA: 0 });
    const blurred = await read({ SHADOW_PENUMBRA: softest });
    points.destroy();
    normals.destroy();
    target.dispose();

    // Per set, the share of its points the GPU gets wrong: lit where it should
    // shade (more than a quarter of the sun), or shading where it should be lit.
    const offsets = new Map();
    let k = 0;
    for (const [name, set] of Object.entries(sets)) {
      offsets.set(name, k);
      k += set.points.length;
    }
    const wrong = (name, values) => {
      const { points: list, shaded } = sets[name];
      const from = offsets.get(name);
      const most = name === 'foot' ? 0.5 : 0.25; // the sun a shaded point may see
      const bad = list.filter((_, i) => (shaded ? values[from + i] > most : values[from + i] < 0.75)).length;
      return list.length ? bad / list.length : 1;
    };
    const checked = Object.fromEntries(['shade', 'lit', 'holes', 'foot', 'faces', 'beyond'].map((name) => [name, { points: sets[name].points.length, wrong: wrong(name, reads) }]));
    const contact = penumbraWidths(profiles, k);
    window.__SHADOWS__ = {
      elevation,
      sets: checked,
      contact: contact(reads),
      mistakes: {
        acne: wrong('faces', acne),
        detached: wrong('foot', detached),
        moved: wrong('moved', reads),
        solid: wrong('solid', reads),
      },
      // The contact check's mistakes: each profile's width against the one it should have.
      contactMistakes: { hard: contact(hard), blurred: contact(blurred) },
    };
  });

  return {
    ready,
    update() {},
    dispose() {
      delete window.__SHADOWS__;
      scene.remove(group);
      for (const geometry of geometries) geometry.dispose();
      for (const material of materials) material.dispose();
    },
  };
}

// The points each set checks: { points: [{ at, normal }], shaded }.
function pointSets({ sun, toSun, at, correct, movedWrong, solid, shift, camera, penumbra, texelsAt }) {
  const up = [0, 1, 0];
  const level = { normal: up, heightAt: () => 0, half: Infinity };
  const sets = {
    shade: { points: [], shaded: true },
    lit: { points: [], shaded: false },
    holes: { points: [], shaded: false },
    foot: { points: [], shaded: true },
    faces: { points: [], shaded: false },
    beyond: { points: [], shaded: false },
    moved: { points: [], shaded: true },
    solid: { points: [], shaded: false },
  };
  const tanE = sun[1] / Math.hypot(sun[0], sun[2]);
  const eye = [camera.position.x, camera.position.z];
  // Clearly in shade or clearly lit: the same a margin round, which grows with
  // the distance, as the maps' texels do, and with how far the point lies
  // from its caster (`away`, m), as the sun's disk softens its shadow.
  // And clear of what other casters may shade (`others`): the mistakes cast
  // where they shouldn't, and the card's holes may be cast solid.
  const clearly = (casters, others, ground, away, x, z) => {
    const margin = 0.06 + 0.002 * Math.hypot(x - eye[0], z - eye[1]) + 1.5 * penumbra * away;
    const along = margin / Math.max(Math.sin(Math.asin(sun[1])), 0.1); // along the sun's way
    const point = (px, pz) => [px, ground.heightAt(px, pz), pz];
    const here = shaded(casters, point(x, z), sun);
    for (let a = 0; a <= 8; a++) {
      const angle = (a * Math.PI) / 4;
      const [u, v] = [Math.cos(angle), Math.sin(angle)]; // u along the sun's way, v across it
      const p = a === 8 ? point(x, z) : point(x + toSun[0] * u * along - toSun[1] * v * margin, z + toSun[1] * u * along + toSun[0] * v * margin);
      if (shaded(casters, p, sun) !== here || others.some((c) => (c.kind === 'box' ? hitsBox(c, p, sun) : hitsCard(c, p, sun, false)))) return null;
    }
    return here;
  };
  // The mistaken block where its mesh is, which casts there; the cards solid.
  const unmoved = { kind: 'box', min: movedWrong.min.map((c, i) => c - shift[i]), max: movedWrong.max.map((c, i) => c - shift[i]) };
  const mistakes = [movedWrong, unmoved, solid];
  // A grid over the ground round a caster, out along its shadow, on its own
  // patch of ground if it stands on a slope.
  const around = (caster, casters, others, add) => {
    const ground = caster.ground ?? level;
    const rows = caster.kind === 'card' ? 64 : 24;
    const columns = caster.kind === 'card' ? 64 : 12;
    const corners = caster.kind === 'box' ? [caster.min, caster.max] : cardCorners(caster);
    const box = { min: [0, 1, 2].map((i) => Math.min(...corners.map((c) => c[i]))), max: [0, 1, 2].map((i) => Math.max(...corners.map((c) => c[i]))) };
    const cx = (box.min[0] + box.max[0]) / 2;
    const cz = (box.min[2] + box.max[2]) / 2;
    const size = Math.max(box.max[0] - box.min[0], box.max[2] - box.min[2]);
    const length = Math.min(box.max[1] / tanE + size + 2, 40, ground.half);
    const wide = Math.min(size + 2, ground.half);
    for (let i = 0; i <= rows; i++) {
      for (let j = 0; j <= columns; j++) {
        const along = -2 + (i / rows) * (length + 2);
        const aside = (j / columns - 0.5) * 2 * wide;
        const x = cx - toSun[0] * along - toSun[1] * aside;
        const z = cz - toSun[1] * along + toSun[0] * aside;
        // Under a block, or on a card's foot.
        if (caster.kind === 'box' ? x > box.min[0] - 0.05 && x < box.max[0] + 0.05 && z > box.min[2] - 0.05 && z < box.max[2] + 0.05 : Math.abs(along) < 0.1 && Math.abs(aside) < caster.half[0] + 0.1) continue;
        // How far the caster is along the sun's rays: to a card's plane, else at most.
        const away = (caster.kind === 'card' && cardDistance(caster, [x, ground.heightAt(x, z), z], sun)) || Math.max(along, 0) / Math.cos(Math.atan(tanE)) + (box.max[1] - box.min[1]);
        const state = clearly(casters, others, ground, away, x, z);
        if (state !== null) add(state, [x, ground.heightAt(x, z), z], ground.normal, away);
      }
    }
  };
  // Lit through a hole, where the map the GPU reads as the sun's disk softens
  // the hole's edge (its texels about the penumbra's half-width, between the
  // finest and the coarsest map's) holds the hole two texels clear of that
  // edge: a gap only a few of its texels across comes out dim.
  const resolved = (p, away) => {
    const texels = texelsAt(p);
    const h = penumbra * away;
    return Boolean(texels) && HOLE.radius >= 1.5 * h + 2 * Math.min(Math.max(h / WIDEST, texels.finest), texels.coarsest);
  };
  for (const caster of correct) {
    around(caster, correct, mistakes, (state, p, normal, away) => {
      if (state) sets.shade.points.push({ at: p, normal });
      else if (caster.kind === 'card' && caster.holes && throughHole(caster, p, sun)) resolved(p, away) && sets.holes.points.push({ at: p, normal });
      else sets.lit.points.push({ at: p, normal });
    });
  }
  around(movedWrong, [movedWrong], [...correct, unmoved, solid], (state, p, normal) => state && sets.moved.points.push({ at: p, normal }));
  around(solid, [solid], [...correct, movedWrong, unmoved], (state, p, normal) => !state && throughHole(solid, p, sun) && sets.solid.points.push({ at: p, normal }));

  for (const b of correct.filter((c) => c.kind === 'box')) {
    // On the ground (or its slope) just out from the foot of each side that
    // faces away from the sun (a block standing on it: not the floating slab):
    // 3 cm, and 3 mm more a metre from the camera, as the maps' texels grow.
    // Closer, under a high sun, a point lies within the filter's reach of the
    // block's outline as the sun sees it, half lit or not by a hair of
    // rasterizing. And clear of the shadow's sides, as `clearly` has it across
    // the sun's way: by a corner, a side runs close past the foot. Not the
    // pole: its shadow, 10 cm wide, lies within the filter's reach of both its sides.
    const ground = b.ground ?? level;
    if (b.standing && b.max[0] - b.min[0] > 0.5) {
      const distance = Math.hypot((b.min[0] + b.max[0]) / 2 - eye[0], (b.min[2] + b.max[2]) / 2 - eye[1]);
      const out = 0.03 + 0.003 * distance;
      const aside = 0.06 + 0.002 * distance;
      const point = (x, z) => [x, ground.heightAt(x, z), z];
      for (const [nx, nz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        if (nx * toSun[0] + nz * toSun[1] > -0.3) continue;
        for (let s = 1; s <= 9; s++) {
          const t = s / 10;
          const x = nx ? (nx > 0 ? b.max[0] + out : b.min[0] - out) : b.min[0] + t * (b.max[0] - b.min[0]);
          const z = nz ? (nz > 0 ? b.max[2] + out : b.min[2] - out) : b.min[2] + t * (b.max[2] - b.min[2]);
          const clear = [-1, 0, 1].every((k) => shaded(correct, point(x - toSun[1] * k * aside, z + toSun[0] * k * aside), sun));
          if (clear) sets.foot.points.push({ at: point(x, z), normal: ground.normal });
        }
      }
    }
    // On the faces that face the sun, inset from their edges, above the ground.
    for (const normal of [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, 0, 1], [0, 0, -1]]) {
      if (normal[0] * sun[0] + normal[1] * sun[1] + normal[2] * sun[2] < 0.3) continue;
      const axis = normal.findIndex((c) => c !== 0);
      const others = [0, 1, 2].filter((c) => c !== axis);
      for (let u = 1; u <= 4; u++) {
        for (let v = 1; v <= 4; v++) {
          const p = [0, 0, 0];
          p[axis] = normal[axis] > 0 ? b.max[axis] : b.min[axis];
          p[others[0]] = b.min[others[0]] + (u / 5) * (b.max[others[0]] - b.min[others[0]]);
          p[others[1]] = b.min[others[1]] + (v / 5) * (b.max[others[1]] - b.min[others[1]]);
          if (p[1] < ground.heightAt(p[0], p[2]) + 0.05) continue;
          if (!shaded(correct, p.map((c, i) => c + normal[i] * 0.01), sun)) sets.faces.points.push({ at: p, normal });
        }
      }
    }
  }
  // Far past the maps' far end, away from the sun, behind the camera's own
  // place: nothing casts there.
  for (let i = 0; i < 24; i++) {
    const d = 200 + 10 * i;
    const [x, z] = at(0, (i % 5) - 2);
    sets.beyond.points.push({ at: [x - sun[0] * d, camera.position.y - sun[1] * d, z - sun[2] * d], normal: sun });
  }
  return sets;
}

// Across each side of the wall's shadow, at DISTANCES from the wall, short of
// its far end, where the maps hold it: PROFILE points from in the shadow to out of
// it, `step` m apart, with the half-width of the penumbra the sun's disk makes
// there (`h`, m; the ground lies `distance / cos(elevation)` from the wall
// along the sun's rays) and the texels of the finest and the coarsest map
// that hold it (`t` and `T`, m): the sharpest and the softest the maps can shade it.
function contactProfiles({ wall, sun, toSun, penumbra, texelsAt, covers }) {
  const elevation = Math.asin(sun[1]);
  const length = (2 * wall.half[1]) / Math.tan(elevation);
  const profiles = [];
  for (const side of [-1, 1]) {
    const out = wall.right.map((c) => c * side);
    const foot = [wall.centre[0] + out[0] * wall.half[0], 0, wall.centre[2] + out[2] * wall.half[0]];
    for (const distance of DISTANCES) {
      if (distance > 0.8 * length) continue;
      const middle = [foot[0] - toSun[0] * distance, 0, foot[2] - toSun[1] * distance];
      const texels = texelsAt(middle);
      if (!texels) continue;
      const { finest: t, coarsest: T } = texels;
      const h = (distance / Math.cos(elevation)) * penumbra;
      const reach = 3 * Math.max(Math.min(h, WIDEST * T), WIDEST * t) + 0.01;
      const step = (2 * reach) / (PROFILE - 1);
      const points = Array.from({ length: PROFILE }, (_, i) => middle.map((c, j) => c + out[j] * (-reach + i * step)));
      if (points.every(covers)) profiles.push({ points, step, h, t, T });
    }
  }
  return profiles;
}

// How wide a profile's penumbra is: the integral of v (1 - v) across it, for
// the share v of the sun. The sun's disk's own, of half-width h, is h times
// DISK_WIDTH; the filter of 3 x 3 bilinear reads a map takes (chunks/shadows.wgsl
// mapLit), of texels t, t times SHARPEST at its narrowest (on the finest map)
// and t times SOFTEST at its widest (on the coarsest), its edge then as steep
// as a penumbra WIDEST texels each way.
function penumbraWidth(values, step) {
  return values.reduce((sum, v) => sum + v * (1 - v), 0) * step;
}
const DISK_WIDTH = integrate((c) => {
  const s = sunDiskAbove(c);
  return s * (1 - s);
}, -1, 1);
const filterWidth = (spread) =>
  integrate((u) => {
    const e = filterEdge(u, spread);
    return e * (1 - e);
  }, -3, 3);
const SHARPEST = filterWidth(0.5);
const SOFTEST = filterWidth(1);
const WIDEST = 1.92; // shadows.wgsl mapPenumbra(1)

// For the GPU's reads of each profile (from `offset` in them), each one's
// penumbra against what it should be: the sun's disk's, but no sharper than
// the finest map's filter there and no softer than the coarsest's (`ratio`),
// and which are `sharp` (the sun's disk's under half the finest map's filter,
// so that filter shows) and which `soft` (over twice: the sun's disk shows).
function penumbraWidths(profiles, offset) {
  return (values) => {
    let k = offset;
    return profiles.map(({ points, step, h, t, T }) => {
      const gpu = penumbraWidth(values.slice(k, (k += points.length)), step);
      const disk = Math.min(DISK_WIDTH * h, SOFTEST * T); // no softer than the coarsest map's filter
      const filter = SHARPEST * t;
      return { ratio: gpu / Math.max(disk, filter), sharp: disk < 0.5 * filter, soft: disk > 2 * filter };
    });
  };
}

// The share of the sun's disk above a horizon c of its radii above its centre (chunks/shadows.wgsl sunDisk).
function sunDiskAbove(c) {
  const x = Math.min(Math.max(c, -1), 1);
  return (Math.acos(x) - x * Math.sqrt(1 - x * x)) / Math.PI;
}

// The share of the sun mapLit's filter lets through past an edge u texels
// from its middle, its reads `spread` texels apart: the integral of its
// kernel, three bilinear tents that far apart.
function filterEdge(u, spread) {
  const ramp = (x) => (x <= -1 ? 0 : x >= 1 ? 1 : x < 0 ? (x + 1) ** 2 / 2 : 1 - (1 - x) ** 2 / 2);
  return (ramp(u + spread) + ramp(u) + ramp(u - spread)) / 3;
}

function integrate(fn, from, to, steps = 2000) {
  const h = (to - from) / steps;
  let sum = 0;
  for (let i = 0; i < steps; i++) sum += fn(from + (i + 0.5) * h);
  return sum * h;
}

// The four corners of a card, world.
function cardCorners({ centre, right, up, half }) {
  return [-1, 1].flatMap((a) => [-1, 1].map((b) => centre.map((c, i) => c + a * half[0] * right[i] + b * half[1] * up[i])));
}

// Whether a ray from p towards the sun meets any of the casters.
function shaded(casters, p, sun) {
  return casters.some((c) => (c.kind === 'box' ? hitsBox(c, p, sun) : hitsCard(c, p, sun, true)));
}

function hitsBox({ min, max }, p, d) {
  let near = 1e-6;
  let far = Infinity;
  for (let i = 0; i < 3; i++) {
    if (Math.abs(d[i]) < 1e-12) {
      if (p[i] < min[i] || p[i] > max[i]) return false;
      continue;
    }
    let t0 = (min[i] - p[i]) / d[i];
    let t1 = (max[i] - p[i]) / d[i];
    if (t0 > t1) [t0, t1] = [t1, t0];
    near = Math.max(near, t0);
    far = Math.min(far, t1);
  }
  return near <= far;
}

// How far a ray from p towards the sun runs to the card's plane, or null if it doesn't reach it.
function cardDistance({ centre, normal }, p, d) {
  const along = d[0] * normal[0] + d[1] * normal[1] + d[2] * normal[2];
  if (Math.abs(along) < 1e-9) return null;
  const t = ((centre[0] - p[0]) * normal[0] + (centre[1] - p[1]) * normal[1] + (centre[2] - p[2]) * normal[2]) / along;
  return t > 0 ? t : null;
}

// Where a ray from p towards the sun crosses the card's plane, in its own
// metres from its centre, or null if it doesn't.
function onCard(card, p, d) {
  const { centre, right, up } = card;
  const t = cardDistance(card, p, d);
  if (t === null) return null;
  const q = [0, 1, 2].map((i) => p[i] + t * d[i] - centre[i]);
  return [q[0] * right[0] + q[1] * right[1] + q[2] * right[2], q[0] * up[0] + q[1] * up[1] + q[2] * up[2]];
}

function hitsCard(card, p, d, holes) {
  const local = onCard(card, p, d);
  if (!local || Math.abs(local[0]) > card.half[0] || Math.abs(local[1]) > card.half[1]) return false;
  return !(holes && card.holes && inHole(local));
}

// Lit through one of the card's holes: the card's square in the way, a hole where it crosses.
function throughHole(card, p, d) {
  const local = onCard(card, p, d);
  return Boolean(local) && Math.abs(local[0]) <= card.half[0] && Math.abs(local[1]) <= card.half[1] && inHole(local);
}

// shadows.wgsl inHole, in the card's metres from its centre.
function inHole([x, y]) {
  const cx = x / HOLE.spacing - Math.round(x / HOLE.spacing);
  const cy = y / HOLE.spacing - Math.round(y / HOLE.spacing);
  return Math.hypot(cx, cy) < HOLE.radius / HOLE.spacing;
}

function cross(a, b) {
  return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
}
