// Tool fixture (?fixture=rocks): the rocks' GPU side must put them where JS
// knows they are (CLAUDE.md §5). Once they are placed, for cameras where the
// views stand and seeded ones out to the island's far side, it has the GPU
// work out every rock's offsets (world/rock-offsets.frag) and compares them
// with their JS twin: the terrain's mesh as drawn (ctx.terrain.meshHeightAtCove)
// less its finest height, at each rock's place and round it. Then it draws
// seeded rocks with their own vertex shader (world/rocks.vert) and those
// offsets, each alone and close up, writing where each pixel lies, and checks
// that every pixel lies on the rock's twin: its triangles turned, scaled,
// placed, moved by the least of its offsets and bent down with the planet.
// Deliberate mistakes the comparisons must catch: a rock's offsets read from
// the next rock's block, and rocks turned the wrong way. It leaves the worst
// differences in window.__ROCKS__ for tools/screenshot.js. The island draws as
// usual meanwhile. Not part of the island.
import * as THREE from 'three';
import vertexShader from '../world/rocks.vert';
import fragmentShader from './rocks.frag';
import { views } from '../views.js';
import { createOffsetsPass, offsetsTarget, rockGeometry, rockPlaces, setInstance } from '../world/rocks.js';

const CAMERAS = 6; // seeded, as well as the views'
const DRAWN = { rocks: 24, tile: 32, fov: 40 }; // rocks drawn per camera, each in a tile of its own, pixels across

export function create(ctx) {
  const { renderer, config, frame } = ctx;
  const groundRadius = config.sky.atmosphere.groundRadius * 1000;

  const ready = ctx.rocks.ready.then(() => {
    const { heightmap, island } = ctx.terrain;
    const { placed, shapes } = ctx.rocks;
    const r = ctx.rng('fixtures/rocks');
    const cameras = views.map((v) => island.toCove(v.position[0], v.position[2]));
    for (let i = 0; i < CAMERAS; i++) cameras.push([r.range(-300, 600), r.range(-900, 300)]);

    const places = rockPlaces(placed, island);
    const pass = createOffsetsPass(ctx);
    pass.uniforms.uRockPlaces.value = places;
    const target = offsetsTarget(placed.length, THREE.FloatType);
    const side = target.width / 3;
    const texels = new Float32Array(4 * target.width * target.height);
    // Rock id's k-th offset, as the GPU left it in `texels`.
    const gpuOffset = (id, k) => texels[4 * ((3 * Math.floor(id / side) + Math.floor(k / 3)) * target.width + 3 * (id % side) + (k % 3))];
    // And as JS works it out: NaN off the terrain.
    const jsOffset = (id, k, [ca, co]) => {
      const [a, o] = island.toCove(placed[id].position[0], placed[id].position[2]);
      const angle = (k * Math.PI) / 4;
      const out = k === 0 ? 0 : placed[id].spread;
      const [pa, po] = [a + out * Math.cos(angle), o + out * Math.sin(angle)];
      return ctx.terrain.meshHeightAtCove(pa, po, [ca, 0, co]) - heightmap.heightAtCove(pa, po, 0);
    };

    // The rocks drawn alone, a mesh per prototype, each into a tile of one target.
    const material = new THREE.ShaderMaterial({ name: 'fixture-rocks', vertexShader, fragmentShader, uniforms: { ...frame.uniforms, uRockOffsets: { value: target.texture } } });
    const scene = new THREE.Scene();
    const meshes = shapes.map((shape) => {
      const mesh = new THREE.Mesh(rockGeometry(shape, 1), material);
      mesh.frustumCulled = false;
      scene.add(mesh);
      return mesh;
    });
    const columns = Math.ceil(Math.sqrt(DRAWN.rocks));
    const rows = Math.ceil(DRAWN.rocks / columns);
    const tiles = new THREE.WebGLRenderTarget(columns * DRAWN.tile, rows * DRAWN.tile, { type: THREE.FloatType, depthBuffer: false });
    const pixels = new Float32Array(4 * tiles.width * tiles.height);
    const view = new THREE.PerspectiveCamera(DRAWN.fov, 1, 0.05, 1000);

    const offsets = { points: 0, gpu: 0, mistaken: 0 };
    const vertices = { rocks: 0, pixels: 0, gpu: 0, mistaken: 0 };
    for (const camera of cameras) {
      pass.uniforms.uCamera.value.fromArray(camera);
      pass.render(renderer, target);
      renderer.readRenderTargetPixels(target, 0, 0, target.width, target.height, texels);
      placed.forEach((rock, id) => {
        for (let k = 0; k < 9; k++) {
          const js = jsOffset(id, k, camera);
          if (Number.isNaN(js)) continue;
          offsets.points++;
          offsets.gpu = Math.max(offsets.gpu, Math.abs(gpuOffset(id, k) - js));
          const next = jsOffset((id + 1) % placed.length, k, camera);
          if (!Number.isNaN(next)) offsets.mistaken = Math.max(offsets.mistaken, Math.abs(gpuOffset(id, k) - next));
        }
      });

      // Seeded rocks that stand out of the sea (rocks.vert leaves out what the
      // placeholder water hides), each moved by the least of its offsets.
      const least = (id) => Math.min(...Array.from({ length: 9 }, (_, k) => gpuOffset(id, k)));
      const dry = placed.flatMap((rock, id) => (rock.position[1] + rock.top + least(id) > 0.1 ? [id] : []));
      const drawn = Array.from({ length: DRAWN.rocks }, () => r.pick(dry));
      tiles.viewport.set(0, 0, tiles.width, tiles.height);
      tiles.scissorTest = false;
      renderer.setRenderTarget(tiles);
      renderer.clear(); // what the last camera's rocks left
      const eyes = drawn.map((id, i) => {
        const rock = placed[id];
        for (const mesh of meshes) mesh.visible = false;
        const { geometry } = meshes[rock.shape];
        meshes[rock.shape].visible = true;
        setInstance(geometry, 0, rock, id, 0);
        geometry.instanceCount = 1;
        for (const name of ['aPlace', 'aTurn', 'aScale', 'aTop']) geometry.attributes[name].needsUpdate = true;
        // From any side, a little below to well above, framing its sphere.
        const [x, y, z] = rock.centre;
        const centre = new THREE.Vector3(x, y + least(id), z);
        const along = r.range(0, 2 * Math.PI);
        const up = r.range(-0.5, 1);
        const away = rock.radius / Math.sin(((DRAWN.fov / 2) * Math.PI) / 180);
        view.position.set(x + away * Math.cos(up) * Math.cos(along), centre.y + away * Math.sin(up), z + away * Math.cos(up) * Math.sin(along));
        view.lookAt(centre);
        view.updateMatrixWorld();
        tiles.viewport.set((i % columns) * DRAWN.tile, Math.floor(i / columns) * DRAWN.tile, DRAWN.tile, DRAWN.tile);
        tiles.scissor.copy(tiles.viewport);
        tiles.scissorTest = true;
        renderer.setRenderTarget(tiles);
        renderer.render(scene, view);
        return view.position.clone();
      });
      renderer.readRenderTargetPixels(tiles, 0, 0, tiles.width, tiles.height, pixels);
      drawn.forEach((id, i) => {
        const twin = twinPlanes(placed[id], shapes[placed[id].shape], least(id), eyes[i], groundRadius);
        const turned = twinPlanes(placed[id], shapes[placed[id].shape], least(id), eyes[i], groundRadius, true);
        let covered = 0;
        for (let ty = 0; ty < DRAWN.tile; ty++) {
          for (let tx = 0; tx < DRAWN.tile; tx++) {
            const n = 4 * ((Math.floor(i / columns) * DRAWN.tile + ty) * tiles.width + (i % columns) * DRAWN.tile + tx);
            if (pixels[n + 3] !== 2) continue;
            covered++;
            const p = [pixels[n], pixels[n + 1], pixels[n + 2]];
            vertices.gpu = Math.max(vertices.gpu, Math.abs(outside(twin, p)));
            vertices.mistaken = Math.max(vertices.mistaken, Math.abs(outside(turned, p)));
          }
        }
        vertices.pixels += covered;
        if (covered) vertices.rocks++;
      });
    }
    renderer.setRenderTarget(null);
    for (const mesh of meshes) mesh.geometry.dispose();
    material.dispose();
    tiles.dispose();
    target.dispose();
    pass.dispose();
    places.dispose();
    window.__ROCKS__ = { rocks: placed.length, cameras: cameras.length, offsets, vertices };
  });

  return {
    ready,
    update() {},
    dispose() {
      delete window.__ROCKS__;
    },
  };
}

// The planes of a rock's twin's facets, as [nx, ny, nz, d] with n·p <= d
// inside: moved by `offset` and bent down with the planet for an eye at `eye`,
// as rocks.vert draws it; `turned` the wrong way round, a deliberate mistake.
function twinPlanes(rock, shape, offset, eye, groundRadius, turned = false) {
  const [qx, qy, qz, qw] = rock.rotation;
  const q = turned ? new THREE.Quaternion(-qx, -qy, -qz, qw) : new THREE.Quaternion(qx, qy, qz, qw);
  const [x, y, z] = rock.position;
  const drop = ((x - eye.x) ** 2 + (z - eye.z) ** 2) / (2 * groundRadius);
  const { positions, index } = shape;
  const corner = (i) =>
    new THREE.Vector3(positions[3 * i] * rock.scale[0], positions[3 * i + 1] * rock.scale[1], positions[3 * i + 2] * rock.scale[2]).applyQuaternion(q).add(new THREE.Vector3(x, y + offset - drop, z));
  const planes = [];
  for (let t = 0; t < index.length; t += 3) {
    const [a, b, c] = [corner(index[t]), corner(index[t + 1]), corner(index[t + 2])];
    const n = b.clone().sub(a).cross(c.clone().sub(a)).normalize();
    planes.push([n.x, n.y, n.z, n.dot(a)]);
  }
  return planes;
}

// How far p lies out of a convex solid's planes: 0 on its surface.
function outside(planes, [px, py, pz]) {
  let most = -Infinity;
  for (const [nx, ny, nz, d] of planes) most = Math.max(most, nx * px + ny * py + nz * pz - d);
  return most;
}
