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
// Puts ctx.rocks on the context: { ready, placed (rock-placement.js's rocks,
// once ready), shapes, clearance }. clearance (world/scatter.js) holds the
// rocks' footprints once ready: later placement (Stages 8–9) passes it to
// scatter, which keeps what it places clear of the rocks and adds it.
import { Frustum, Matrix4, Sphere, Vector2 } from '../maths/index.js';
import shader from './rocks.wgsl';
import offsetsShader from './rock-offsets.wgsl';
import { Material } from '../gpu/material.js';
import { Geometry } from '../gpu/geometry.js';
import { Mesh } from '../gpu/scene.js';
import { createTarget, Texture } from '../gpu/texture.js';
import { makeRockShapes } from './rock-shapes.js';
import { placeRocks } from './rock-placement.js';
import { createClearance } from './scatter.js';

export function create(ctx) {
  const { scene, camera, frame, config, renderer, quality } = ctx;
  const settings = config.world.rocks;
  const shapes = makeRockShapes(ctx.rng('rocks/shapes'), settings.shapes);
  const clearance = createClearance();

  const material = new Material({
    name: 'rocks',
    shader,
    uniforms: {
      ...ctx.terrain.surfaces,
      uRockOffsets: { value: null },
    },
    overrides: { ROCK_DETAIL: true },
  });

  let rocks = [];
  const meshes = shapes.map((shape) => {
    const mesh = new Mesh(rockGeometry(shape, 1), material);
    mesh.name = 'rocks';
    mesh.frustumCulled = false; // culled rock by rock
    mesh.renderOrder = -1; // before the terrain, which they hide in part
    mesh.visible = false; // until they are placed
    scene.add(mesh);
    return mesh;
  });

  let places = null;
  let offsets = null;
  const offsetsPass = createOffsetsPass(ctx);

  let disposed = false;
  const ready = ctx.terrain.ready.then(() => {
    if (disposed) return;
    const { heightmap, island } = ctx.terrain;
    const { reach } = settings;
    const region = { a: [-reach, reach], o: [-reach, reach], radius: reach };
    rocks = placeRocks(heightmap, island, shapes, settings, region, (kind) => ctx.rng(`rocks/${kind}`).int(0, 0x7fffffff), clearance);
    ctx.rocks.placed = rocks;
    const count = shapes.map(() => 0);
    for (const rock of rocks) count[rock.shape]++;
    meshes.forEach((mesh, k) => {
      mesh.geometry.dispose();
      mesh.geometry = rockGeometry(shapes[k], count[k]);
    });
    places = rockPlaces(ctx, rocks, island);
    offsets = offsetsTarget(ctx, rocks.length);
    offsetsPass.uniforms.uRockPlaces.value = places;
    material.uniforms.uRockOffsets.value = offsets.color;
    for (const mesh of meshes) mesh.visible = true;
  });

  ctx.rocks = { ready, placed: rocks, shapes, clearance };

  // Each frame, once the camera is where it will be: the rocks to draw.
  const frustum = new Frustum();
  const viewProjection = new Matrix4();
  const sphere = new Sphere();
  const groundRadius = config.sky.atmosphere.groundRadius * 1000;
  const least = quality.rockPixels;
  const full = settings.fade * least;
  const stopSelecting = frame.beforeScene(() => {
    if (!rocks.length) return;
    offsetsPass.uniforms.uCamera.value.fromArray(ctx.terrain.island.toCove(camera.position.x, camera.position.z));
    offsetsPass.render(offsets);
    viewProjection.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
    frustum.setFromProjectionMatrix(viewProjection);
    // Something h tall at distance d stands about h / d x pixelsPerRadian pixels.
    const pixelsPerRadian = frame.size.height / ((camera.fov * Math.PI) / 180);
    for (const mesh of meshes) mesh.geometry.instanceCount = 0;
    rocks.forEach((rock, id) => {
      sphere.center.fromArray(rock.centre);
      const d = sphere.center.distanceTo(camera.position);
      const pixels = (rock.shows / d) * pixelsPerRadian;
      if (pixels < least) return;
      // Where it is drawn: bent down with the planet, and moved by its offset,
      // which strays further from the finest height the further away it is.
      sphere.center.y -= (d * d) / (2 * groundRadius);
      sphere.radius = rock.radius + settings.stray * d;
      if (!frustum.intersectsSphere(sphere)) return;
      const { geometry } = meshes[rock.shape];
      const sink = rock.shows * Math.min(Math.max((full - pixels) / (full - least), 0), 1);
      setInstance(geometry, geometry.instanceCount++, rock, id, sink);
    });
    for (const { geometry } of meshes) for (const name of INSTANCED) geometry.update(name, 0, geometry.instanceCount);
  });

  return {
    ready,
    update() {},
    dispose() {
      disposed = true;
      stopSelecting();
      for (const mesh of meshes) {
        scene.remove(mesh);
        mesh.geometry.dispose();
      }
      material.dispose();
      offsetsPass.dispose();
      places?.destroy();
      offsets?.dispose();
      delete ctx.rocks;
    },
  };
}

// Per instance (rocks.wgsl): its place and its texel of the offsets, its turn,
// its scale and height, and how far its top stands above its place.
const INSTANCED = ['aPlace', 'aTurn', 'aScale', 'aTop'];

// A prototype's mesh, with room for `count` instances.
export function rockGeometry(shape, count) {
  const geometry = new Geometry();
  geometry.setAttribute('position', shape.positions, 3);
  geometry.setAttribute('normal', shape.normals, 3);
  geometry.setIndex(shape.index);
  for (const name of INSTANCED) {
    const size = name === 'aTop' ? 1 : 4;
    geometry.setAttribute(name, new Float32Array(size * Math.max(1, count)), size, { instance: true });
  }
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
