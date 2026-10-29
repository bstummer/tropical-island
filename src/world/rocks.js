// Rocks and boulders (PLAN.md Stage 4.5): world/rock-shapes.js's prototypes,
// placed by world/rock-placement.js once the terrain's grids are in, and drawn
// instanced, a mesh per prototype. Their surface is the cliffs' (chunks/rock.wgsl,
// with the terrain's tile: ctx.terrain.surfaces), so a boulder is the same rock
// as the cliff it fell from.
//
// Each frame the rocks in view that stand out of the ground at least
// quality.rockPixels pixels go to their meshes; the rest cost nothing. Thinner,
// a rock would crawl (CLAUDE.md §8). A rock sinks into the ground as it shrinks
// towards that (config.world.rocks.fade), so it is gone before it is dropped.
// TEMPORARY: a rock wholly under the placeholder water isn't drawn (rocks.wgsl).
//
// Placement sinks each rock into the ground at its finest. Far from the camera
// the terrain's mesh strays from that, by metres on far cliffs, so each frame
// a pass works out, for every rock, how far the mesh as drawn
// (chunks/terrain-mesh.wgsl) lies below that height at its place and round it,
// and the rock moves by that: it stays sunk in the ground as drawn, near and
// far. src/fixtures/rocks.js checks that pass and the vertex shader against
// their JS twins, with the helpers exported here. Needs the terrain
// (ctx.terrain), so comes after it in WORLD_SYSTEMS.
//
// They cast shadows into the sun's shadow maps (sky/shadows.js), from where
// they are drawn: the same vertex shader, sunk alike, with instances of their
// own, picked each frame from all of them, in view or not, that stand out
// enough to be drawn and can cast into a map.
//
// Puts ctx.rocks on the context: { ready, placed (rock-placement.js's rocks,
// once ready), shapes, clearance }. clearance (world/scatter.js) holds the
// rocks' footprints once ready: later placement (Stages 8–9) passes it to
// scatter, which keeps what it places clear of the rocks and adds it. Casts
// into the shadows (ctx.shadows) where they are, so comes after them.
import { Frustum, Matrix4, Sphere, Vector2 } from '../maths/index.js';
import shader from './rocks.wgsl';
import offsetsShader from './rock-offsets.wgsl';
import { Material } from '../gpu/material.js';
import { Attribute, Geometry } from '../gpu/geometry.js';
import { Mesh } from '../gpu/scene.js';
import { createTarget, Texture } from '../gpu/texture.js';
import { makeRockShapes } from './rock-shapes.js';
import { placeRocks } from './rock-placement.js';
import { createClearance } from './scatter.js';

// What depends on the seed alone, kept across quality changes as the
// terrain's grids are: the prototypes, and the rocks, placed as soon as the
// grids are in (ctx.terrain.grids), while the terrain waits for its surfaces.
const kept = new Map(); // seed -> { shapes, placed: Promise of placeRocks's rocks }

export function create(ctx) {
  const { scene, camera, frame, config, renderer, quality } = ctx;
  const settings = config.world.rocks;
  const { shapes, placed } = layoutFor(ctx, settings);
  const clearance = createClearance();

  const material = new Material({
    name: 'rocks',
    shader,
    uniforms: {
      ...ctx.terrain.surfaces,
      uRockOffsets: { value: null },
    },
    overrides: { ROCK_DETAIL: true, SHADE_ONCE: true },
  });
  // Into the shadow maps: depth alone, pushed a little away from the sun along
  // its slope, so a face doesn't shade itself.
  const shadowMaterial = new Material({ name: 'rocks-shadow', shader, uniforms: material.uniforms, overrides: material.overrides, fragment: null, depthBiasSlope: -1.5 });

  let rocks = [];
  // Every prototype's rocks in one set of attributes, each mesh drawing its range of them.
  let instances = rockInstances(1);
  let shadowInstances = rockInstances(1); // the shadow maps' own
  let sinks = new Float64Array(0); // how far each rock picked sinks this frame; -1 if left out
  const meshesOf = (rockMaterial, of, pass) =>
    shapes.map((shape) => {
      const mesh = new Mesh(rockGeometry(shape, of), rockMaterial);
      mesh.name = rockMaterial.name;
      mesh.pass = pass;
      mesh.frustumCulled = false; // culled rock by rock
      mesh.renderOrder = -1; // before the terrain, which they hide in part
      mesh.visible = false; // until they are placed
      scene.add(mesh);
      return mesh;
    });
  const meshes = meshesOf(material, instances, 'opaque');
  const shadowMeshes = meshesOf(shadowMaterial, shadowInstances, 'shadow');

  let places = null;
  let offsets = null;
  const offsetsPass = createOffsetsPass(ctx);

  let disposed = false;
  let stopReaching = () => {};
  const ready = Promise.all([placed, ctx.terrain.ready]).then(([all]) => {
    if (disposed) return;
    const { island } = ctx.terrain;
    rocks = all;
    for (const rock of rocks) clearance.claim(rock.footprint); // as placement claimed them
    ctx.rocks.placed = rocks;
    instances = rockInstances(rocks.length);
    shadowInstances = rockInstances(rocks.length);
    sinks = new Float64Array(rocks.length);
    meshes.forEach((mesh, k) => {
      mesh.geometry.dispose();
      mesh.geometry = rockGeometry(shapes[k], instances);
    });
    shadowMeshes.forEach((mesh, k) => {
      mesh.geometry.dispose();
      mesh.geometry = rockGeometry(shapes[k], shadowInstances);
    });
    places = rockPlaces(ctx, rocks, island);
    offsets = offsetsTarget(ctx, rocks.length);
    offsetsPass.uniforms.uRockPlaces.value = places;
    material.uniforms.uRockOffsets.value = offsets.color;
    for (const mesh of [...meshes, ...shadowMeshes]) mesh.visible = true;
    // Where they stand, so the ground reads the shadow maps only where their shadows can fall.
    const spheres = new Float32Array(4 * rocks.length);
    rocks.forEach((rock, i) => spheres.set([...rock.centre, rock.radius], 4 * i));
    stopReaching = ctx.shadows?.from(spheres) ?? stopReaching;
  });

  ctx.rocks = { ready, placed: rocks, shapes, clearance };

  // Each frame, once the camera is where it will be: the rocks to draw.
  const frustum = new Frustum();
  const viewProjection = new Matrix4();
  const sphere = new Sphere();
  const groundRadius = config.sky.atmosphere.groundRadius * 1000;
  const least = quality.rockPixels;
  const full = settings.fade * least;
  // The offsets, once a frame, before the shadow maps or the view need them.
  let offsetsFrame = -1;
  function offsetsNow() {
    if (offsetsFrame === ctx.clock.frame) return;
    offsetsFrame = ctx.clock.frame;
    offsetsPass.uniforms.uCamera.value.fromArray(ctx.terrain.island.toCove(camera.position.x, camera.position.z));
    offsetsPass.render(offsets);
  }
  // The rocks that keeps() keeps (given a rock's sphere as drawn) into the
  // meshes `into`, whose instances are `of`, each sunk as far as it is drawn.
  function pick(into, of, keeps) {
    // Something h tall at distance d stands about h / d x pixelsPerRadian pixels.
    const pixelsPerRadian = frame.size.height / ((camera.fov * Math.PI) / 180);
    for (const mesh of into) mesh.geometry.instanceCount = 0;
    rocks.forEach((rock, id) => {
      sinks[id] = -1;
      sphere.center.fromArray(rock.centre);
      const d = sphere.center.distanceTo(camera.position);
      const pixels = (rock.shows / d) * pixelsPerRadian;
      if (pixels < least) return;
      // Where it is drawn: bent down with the planet, and moved by its offset,
      // which strays further from the finest height the further away it is.
      sphere.center.y -= (d * d) / (2 * groundRadius);
      sphere.radius = rock.radius + settings.stray * d;
      if (!keeps(sphere)) return;
      sinks[id] = rock.shows * Math.min(Math.max((full - pixels) / (full - least), 0), 1);
      into[rock.shape].geometry.instanceCount++;
    });
    // Each prototype's range of the rocks, in their order.
    let count = 0;
    for (const { geometry } of into) {
      geometry.firstInstance = count;
      count += geometry.instanceCount;
      geometry.instanceCount = 0;
    }
    rocks.forEach((rock, id) => {
      if (sinks[id] < 0) return;
      const { geometry } = into[rock.shape];
      setInstance(geometry, geometry.firstInstance + geometry.instanceCount++, rock, id, sinks[id]);
    });
    for (const name of INSTANCED) of[name].update(0, count);
  }
  // The shadow maps draw before the view: what casts into them, from all the rocks.
  const stopCasting = (ctx.shadows?.cast ?? (() => () => {}))((shadows) => {
    if (!rocks.length) return;
    offsetsNow();
    pick(shadowMeshes, shadowInstances, (s) => shadows.holds(s.center.toArray(), s.radius));
  });
  const stopSelecting = frame.beforeScene(() => {
    if (!rocks.length) return;
    offsetsNow();
    viewProjection.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
    frustum.setFromProjectionMatrix(viewProjection);
    pick(meshes, instances, (s) => frustum.intersectsSphere(s));
  });

  return {
    ready,
    update() {},
    dispose() {
      disposed = true;
      stopSelecting();
      stopCasting();
      stopReaching();
      for (const mesh of [...meshes, ...shadowMeshes]) {
        scene.remove(mesh);
        mesh.geometry.dispose();
      }
      material.dispose();
      shadowMaterial.dispose();
      offsetsPass.dispose();
      places?.destroy();
      offsets?.dispose();
      delete ctx.rocks;
    },
  };
}

// The seed's prototypes and its rocks' placement (see `kept`). A failed
// placement isn't kept, so the next try starts afresh.
function layoutFor(ctx, settings) {
  const seed = String(ctx.params.seed ?? ctx.config.defaults.seed);
  if (!kept.has(seed)) {
    const shapes = makeRockShapes(ctx.rng('rocks/shapes'), settings.shapes);
    const { island } = ctx.terrain;
    const { reach } = settings;
    const region = { a: [-reach, reach], o: [-reach, reach], radius: reach };
    const seedOf = (kind) => ctx.rng(`rocks/${kind}`).int(0, 0x7fffffff);
    const placed = ctx.terrain.grids.then((heightmap) => placeRocks(heightmap, island, shapes, settings, region, seedOf, createClearance()));
    placed.catch(() => kept.delete(seed));
    kept.set(seed, { shapes, placed });
  }
  return kept.get(seed);
}

// Per instance (rocks.wgsl): its place and its texel of the offsets, its turn,
// its scale and height, and how far its top stands above its place.
const INSTANCED = ['aPlace', 'aTurn', 'aScale', 'aTop'];

// The per-instance attributes, with room for `count` rocks.
export function rockInstances(count) {
  const size = (name) => (name === 'aTop' ? 1 : 4);
  return Object.fromEntries(INSTANCED.map((name) => [name, new Attribute(new Float32Array(size(name) * Math.max(1, count)), size(name), { instance: true })]));
}

// A prototype's mesh, drawing `instances` (rockInstances', its own or shared).
export function rockGeometry(shape, instances = rockInstances(1)) {
  const geometry = new Geometry();
  geometry.setAttribute('position', shape.positions, 3);
  geometry.setAttribute('normal', shape.normals, 3);
  geometry.setIndex(shape.index);
  for (const name of INSTANCED) geometry.setAttribute(name, instances[name]);
  geometry.instanceCount = 0;
  return geometry;
}

// Rock number `id` (its texel of the offsets) as instance i, sunk `sink` m.
export function setInstance(geometry, i, rock, id, sink) {
  const { aPlace, aTurn, aScale, aTop } = geometry.attributes;
  aPlace.array.set(rock.position, 4 * i);
  aPlace.array[4 * i + 1] -= sink;
  aPlace.array[4 * i + 3] = id;
  aTurn.array.set(rock.rotation, 4 * i);
  aScale.array.set(rock.scale, 4 * i);
  aScale.array[4 * i + 3] = rock.height;
  aTop.array[i] = rock.top;
}

// Per rock, a texel of its place in the cove's frame and how far it spreads,
// in a square, for the offsets pass: a texture of floats, read texel by texel.
export function rockPlaces(ctx, rocks, island) {
  const side = Math.max(1, Math.ceil(Math.sqrt(rocks.length)));
  const data = new Float32Array(4 * side * side);
  rocks.forEach((rock, i) => data.set([...island.toCove(rock.position[0], rock.position[2]), rock.spread], 4 * i));
  return new Texture(ctx.gpu, { name: 'rock places', width: side, height: side, format: 'rgba32float', data: true }).upload(data);
}

// The offsets: a block of 3 x 3 texels per rock, in a square, as many as
// rockPlaces has places, read texel by texel; half floats, or `format`.
export function offsetsTarget(ctx, count, format = 'rgba16float') {
  const side = 3 * Math.max(1, Math.ceil(Math.sqrt(count)));
  return createTarget(ctx.gpu, { name: 'rock offsets', width: side, height: side, format, sampler: { mag: 'nearest', min: 'nearest' } });
}

// The pass that works out the offsets (rock-offsets.wgsl): uRockPlaces from
// rockPlaces, uCamera the camera's a, o in the cove's frame.
export function createOffsetsPass(ctx) {
  return ctx.renderer.fullscreen(
    new Material({
      name: 'rock-offsets',
      shader: offsetsShader,
      uniforms: { ...ctx.terrain.mesh.uniforms, uRockPlaces: { value: null }, uCamera: { value: new Vector2() } },
      overrides: ctx.terrain.mesh.overrides,
    }),
  );
}
