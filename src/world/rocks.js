// Rocks and boulders (PLAN.md Stage 4.5): world/rock-shapes.js's prototypes,
// placed by world/rock-placement.js once the terrain's grids are in, and drawn
// instanced, a mesh per prototype. Each frame the rocks in view that would
// cover more than config.world.rocks.minPixels across go to their meshes;
// the rest cost nothing. Their surface is the cliffs' (chunks/rock.glsl,
// with the terrain's tile: ctx.terrain.surfaces), so a boulder is the same rock
// as the cliff it fell from.
//
// Placement sinks each rock into the ground at its finest. Far from the camera
// the terrain's mesh strays from that, by metres on far cliffs, so each frame
// a pass works out, for every rock, how far the mesh as drawn
// (chunks/terrain-mesh.glsl) lies below that height at its place and round it,
// and the rock moves by that: it stays sunk in the ground as drawn, near and far. Needs the terrain (ctx.terrain),
// so comes after it in WORLD_SYSTEMS.
import * as THREE from 'three';
import vertexShader from './rocks.vert';
import fragmentShader from './rocks.frag';
import offsetsShader from './rock-offsets.frag';
import passVertexShader from '../post/output.vert';
import { createFullscreen } from '../post/fullscreen.js';
import { makeRockShapes } from './rock-shapes.js';
import { placeRocks } from './rock-placement.js';

export function create(ctx) {
  const { scene, camera, frame, config, renderer } = ctx;
  const settings = config.world.rocks;
  const shapes = makeRockShapes(ctx.rng('rocks/shapes'), settings.shapes);

  const material = new THREE.ShaderMaterial({
    name: 'rocks',
    vertexShader,
    fragmentShader,
    uniforms: {
      ...frame.uniforms,
      ...ctx.terrain.surfaces,
      uRockOffsets: { value: null },
    },
    defines: { ROCK_DETAIL: 1 },
  });

  let rocks = [];
  const meshes = shapes.map((shape) => {
    const geometry = new THREE.InstancedBufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(shape.positions, 3));
    geometry.setAttribute('normal', new THREE.BufferAttribute(shape.normals, 3));
    geometry.setIndex(new THREE.BufferAttribute(shape.index, 1));
    geometry.instanceCount = 0;
    const mesh = new THREE.Mesh(geometry, material);
    mesh.name = 'rocks';
    mesh.frustumCulled = false; // culled rock by rock
    mesh.renderOrder = -1; // before the terrain, which they hide in part
    mesh.visible = false; // until they are placed
    scene.add(mesh);
    return mesh;
  });

  // Instance attributes per mesh, sized once the rocks are placed.
  function instances(count) {
    meshes.forEach((mesh, k) => {
      const n = Math.max(1, count[k]);
      for (const [name, size] of [['aPlace', 4], ['aTurn', 4], ['aScale', 4]]) {
        const attribute = new THREE.InstancedBufferAttribute(new Float32Array(size * n), size);
        attribute.setUsage(THREE.DynamicDrawUsage);
        mesh.geometry.setAttribute(name, attribute);
      }
    });
  }

  // The pass for the rocks' offsets: a block of 3 x 3 texels per rock, in a square.
  let places = null;
  let offsets = null;
  const offsetsPass = createFullscreen(
    new THREE.ShaderMaterial({
      name: 'rock-offsets',
      vertexShader: passVertexShader,
      fragmentShader: offsetsShader,
      uniforms: { ...frame.uniforms, ...ctx.terrain.mesh.uniforms, uRockPlaces: { value: null }, uCamera: { value: new THREE.Vector2() } },
      defines: ctx.terrain.mesh.defines,
    }),
  );

  let disposed = false;
  const ready = ctx.terrain.ready.then(() => {
    if (disposed) return;
    const { heightmap, island } = ctx.terrain;
    const { reach } = settings;
    const region = { a: [-reach, reach], o: [-reach, reach], radius: reach };
    rocks = placeRocks(heightmap, island, shapes, settings, region, (kind) => ctx.rng(`rocks/${kind}`).int(0, 0x7fffffff));
    const count = shapes.map(() => 0);
    for (const rock of rocks) count[rock.shape]++;
    instances(count);

    const side = Math.max(1, Math.ceil(Math.sqrt(rocks.length)));
    const data = new Float32Array(4 * side * side);
    rocks.forEach((rock, i) => data.set([...island.toCove(rock.position[0], rock.position[2]), rock.spread], 4 * i));
    places = new THREE.DataTexture(data, side, side, THREE.RGBAFormat, THREE.FloatType);
    places.needsUpdate = true;
    offsets = new THREE.WebGLRenderTarget(3 * side, 3 * side, { depthBuffer: false, type: THREE.HalfFloatType, minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter, generateMipmaps: false });
    offsetsPass.uniforms.uRockPlaces.value = places;
    material.uniforms.uRockOffsets.value = offsets.texture;
    for (const mesh of meshes) mesh.visible = true;
  });

  // Each frame, once the camera is where it will be: the rocks to draw.
  const frustum = new THREE.Frustum();
  const viewProjection = new THREE.Matrix4();
  const sphere = new THREE.Sphere();
  const groundRadius = config.sky.atmosphere.groundRadius * 1000;
  const stopSelecting = frame.beforeScene(() => {
    if (!rocks.length) return;
    offsetsPass.uniforms.uCamera.value.fromArray(ctx.terrain.island.toCove(camera.position.x, camera.position.z));
    offsetsPass.render(renderer, offsets);
    viewProjection.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
    frustum.setFromProjectionMatrix(viewProjection, THREE.WebGLCoordinateSystem, camera.reversedDepth);
    // A sphere of radius r at distance d covers about r / d x pixelsPerRadian pixels.
    const pixelsPerRadian = frame.size.height / ((camera.fov * Math.PI) / 180);
    const minRatio = settings.minPixels / 2 / pixelsPerRadian;
    for (const mesh of meshes) mesh.geometry.instanceCount = 0;
    rocks.forEach((rock, id) => {
      sphere.center.fromArray(rock.centre);
      const d = sphere.center.distanceTo(camera.position);
      if (rock.radius < minRatio * d) return;
      // Where it is drawn: bent down with the planet, and moved by its offset,
      // which strays further from the finest height the further away it is.
      sphere.center.y -= (d * d) / (2 * groundRadius);
      sphere.radius = rock.radius + settings.stray * d;
      if (!frustum.intersectsSphere(sphere)) return;
      const { geometry } = meshes[rock.shape];
      const i = geometry.instanceCount++;
      const place = geometry.attributes.aPlace.array;
      place.set(rock.position, 4 * i);
      place[4 * i + 3] = id; // its texel of the offsets
      geometry.attributes.aTurn.array.set(rock.rotation, 4 * i);
      const scale = geometry.attributes.aScale.array;
      scale.set(rock.scale, 4 * i);
      scale[4 * i + 3] = rock.height;
    });
    for (const { geometry } of meshes) {
      for (const name of ['aPlace', 'aTurn', 'aScale']) {
        const attribute = geometry.attributes[name];
        attribute.clearUpdateRanges();
        attribute.addUpdateRange(0, attribute.itemSize * geometry.instanceCount);
        attribute.needsUpdate = geometry.instanceCount > 0;
      }
    }
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
      places?.dispose();
      offsets?.dispose();
    },
  };
}
