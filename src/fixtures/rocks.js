// Tool fixture (?fixture=rocks): the rocks' GPU side must put them where JS
// knows they are (CLAUDE.md §5). Once they are placed, for cameras where the
// views stand and seeded ones out to the island's far side, it has the GPU
// work out every rock's offsets (world/rock-offsets.wgsl) and compares them
// with their JS twin: the terrain's mesh as drawn (ctx.terrain.meshHeightAtCove)
// less its finest height, at each rock's place and round it. Then it draws
// seeded rocks with their own vertex shader (world/rocks.wgsl) and those
// offsets, each alone and from afar, writing where each pixel lies, and checks
// that every pixel lies on the rock's twin (offTwin): its triangles turned,
// scaled, placed, moved by the least of its offsets and bent down with the planet.
// Deliberate mistakes the comparisons must catch: a rock's offsets read from
// the next rock's block, and rocks turned the wrong way. It leaves the worst
// differences in window.__ROCKS__ for tools/screenshot.js. The island draws as
// usual meanwhile. Not part of the island.
import { Matrix4, Quaternion, Vector3 } from '../maths/index.js';
import rocksShader from '../world/rocks.wgsl';
import fragmentShader from './rocks.wgsl';
import { views } from '../views.js';
import { Camera } from '../core/camera.js';
import { Material } from '../gpu/material.js';
import { Mesh } from '../gpu/scene.js';
import { createTarget } from '../gpu/texture.js';
import { createOffsetsPass, offsetsTarget, rockGeometry, rockPlaces, setInstance } from '../world/rocks.js';

const CAMERAS = 6; // seeded, as well as the views'
// Rocks drawn per camera, each in a tile of its own, pixels across, from this
// far (m): the planet bends a rock down 5 to 18 cm there, nothing close up.
const DRAWN = { rocks: 24, tile: 32, away: 1500 };

export function create(ctx) {
  const { renderer, config } = ctx;
  const groundRadius = config.sky.atmosphere.groundRadius * 1000;

  const ready = ctx.rocks.ready.then(async () => {
    const { heightmap, island } = ctx.terrain;
    const { placed, shapes } = ctx.rocks;
    const r = ctx.rng('fixtures/rocks');
    const cameras = views.map((v) => island.toCove(v.position[0], v.position[2]));
    for (let i = 0; i < CAMERAS; i++) cameras.push([r.range(-300, 600), r.range(-900, 300)]);

    const places = rockPlaces(ctx, placed, island);
    const pass = createOffsetsPass(ctx);
    pass.uniforms.uRockPlaces.value = places;
    const target = offsetsTarget(ctx, placed.length, 'rgba32float');
    const side = target.width / 3;
    let texels = null;
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

    // The rocks drawn alone, a mesh per prototype, each into a tile of one
    // target: the rocks' own vertex stage, and a fragment stage of the fixture's.
    const material = new Material({
      name: 'fixture-rocks',
      shader: rocksShader + fragmentShader,
      fragment: 'positionFragment',
      uniforms: { ...ctx.terrain.surfaces, uRockOffsets: { value: target.color } },
    });
    const meshes = shapes.map((shape) => {
      const mesh = new Mesh(rockGeometry(shape), material);
      mesh.frustumCulled = false;
      return mesh;
    });
    const columns = Math.ceil(Math.sqrt(DRAWN.rocks));
    const rows = Math.ceil(DRAWN.rocks / columns);
    const tiles = createTarget(renderer.gpu, { name: 'fixture-rocks tiles', width: columns * DRAWN.tile, height: rows * DRAWN.tile, format: 'rgba32float' });
    const view = new Camera(1, 1, 1, 2 * DRAWN.away);

    const offsets = { points: 0, gpu: 0, mistaken: 0 };
    const vertices = { rocks: 0, pixels: 0, gpu: 0, mistaken: 0 };
    for (const camera of cameras) {
      pass.uniforms.uCamera.value.fromArray(camera);
      pass.render(target);
      texels = await target.color.read();
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

      // Seeded rocks that stand out of the sea, each moved by the least of its offsets.
      const least = (id) => Math.min(...Array.from({ length: 9 }, (_, k) => gpuOffset(id, k)));
      const dry = placed.flatMap((rock, id) => (rock.position[1] + rock.top + least(id) > 0.1 ? [id] : []));
      const drawn = Array.from({ length: DRAWN.rocks }, () => r.pick(dry));
      renderer.render([], null, tiles, { clearColor: [0, 0, 0, 0] }); // what the last camera's rocks left
      const eyes = drawn.map((id, i) => {
        const rock = placed[id];
        const mesh = meshes[rock.shape];
        const { geometry } = mesh;
        setInstance(geometry, 0, rock, id, 0);
        geometry.instanceCount = 1;
        for (const name of ['aPlace', 'aTurn', 'aScale', 'aTop']) geometry.update(name, 0, 1);
        // From any side, a little below to well above, framing its sphere.
        const [x, y, z] = rock.centre;
        const centre = new Vector3(x, y + least(id), z);
        const along = r.range(0, 2 * Math.PI);
        const up = r.range(-0.5, 1);
        const away = DRAWN.away;
        view.fov = (2 * Math.asin(rock.radius / away) * 180) / Math.PI;
        view.updateProjectionMatrix();
        view.position.set(x + away * Math.cos(up) * Math.cos(along), centre.y + away * Math.sin(up), z + away * Math.cos(up) * Math.sin(along));
        view.lookAt(centre);
        view.updateMatrixWorld();
        // Tiles from the top left (rows as the readback has them).
        renderer.render([mesh], view, tiles, { viewport: [(i % columns) * DRAWN.tile, Math.floor(i / columns) * DRAWN.tile, DRAWN.tile, DRAWN.tile] });
        return { position: view.position.clone(), clip: new Matrix4().multiplyMatrices(view.projectionMatrix, view.matrixWorldInverse), spread: Math.tan(((view.fov / 2) * Math.PI) / 180) };
      });
      const pixels = await tiles.color.read();
      drawn.forEach((id, i) => {
        const twin = twinPlanes(placed[id], shapes[placed[id].shape], least(id), eyes[i].position, groundRadius);
        const turned = twinPlanes(placed[id], shapes[placed[id].shape], least(id), eyes[i].position, groundRadius, true);
        let covered = 0;
        for (let ty = 0; ty < DRAWN.tile; ty++) {
          for (let tx = 0; tx < DRAWN.tile; tx++) {
            const n = 4 * ((Math.floor(i / columns) * DRAWN.tile + ty) * tiles.width + (i % columns) * DRAWN.tile + tx);
            if (pixels[n + 3] !== 2) continue;
            covered++;
            const p = [pixels[n], pixels[n + 1], pixels[n + 2]];
            vertices.gpu = Math.max(vertices.gpu, offTwin(twin, p, eyes[i]));
            vertices.mistaken = Math.max(vertices.mistaken, offTwin(turned, p, eyes[i]));
          }
        }
        vertices.pixels += covered;
        if (covered) vertices.rocks++;
      });
    }
    for (const mesh of meshes) mesh.geometry.dispose();
    material.dispose();
    tiles.dispose();
    target.dispose();
    pass.dispose();
    places.destroy();
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

// The planes of a rock's twin's triangles, as [nx, ny, nz, d, a, b, c] with
// n·p <= d inside and a, b, c its corners: moved by `offset` and bent down with
// the planet for an eye at `eye`, as rocks.wgsl draws it; `turned` the wrong way
// round, a deliberate mistake.
function twinPlanes(rock, shape, offset, eye, groundRadius, turned = false) {
  const [qx, qy, qz, qw] = rock.rotation;
  const q = turned ? new Quaternion(-qx, -qy, -qz, qw) : new Quaternion(qx, qy, qz, qw);
  const [x, y, z] = rock.position;
  const drop = ((x - eye.x) ** 2 + (z - eye.z) ** 2) / (2 * groundRadius);
  const { positions, index } = shape;
  const corner = (i) =>
    new Vector3(positions[3 * i] * rock.scale[0], positions[3 * i + 1] * rock.scale[1], positions[3 * i + 2] * rock.scale[2]).applyQuaternion(q).add(new Vector3(x, y + offset - drop, z));
  const planes = [];
  for (let t = 0; t < index.length; t += 3) {
    const [a, b, c] = [corner(index[t]), corner(index[t + 1]), corner(index[t + 2])];
    const n = b.clone().sub(a).cross(c.clone().sub(a)).normalize();
    planes.push([n.x, n.y, n.z, n.dot(a), a, b, c]);
  }
  return planes;
}

// How far p lies out of a convex solid's planes: 0 on its surface.
function outside(planes, [px, py, pz]) {
  let most = -Infinity;
  for (const [nx, ny, nz, d] of planes) most = Math.max(most, nx * px + ny * py + nz * pz - d);
  return most;
}

// How far a pixel's point p lies off its twin, as the picture shows it, for an
// eye { position, clip (its view-projection matrix), spread (tan of half its
// field) }: how far out of or into the solid (outside()), but for a point on
// one of its triangles' planes, how far across the picture it lies outside that
// triangle, if less. Such a point is that facet drawn, and where along it the
// pixel's centre falls is the rasterizer's to decide: on a facet seen near
// edge-on, a hundredth of a pixel across the picture is centimetres along the
// facet, out past its edge, and SwiftShader's sub-pixel grid is coarser than a
// hardware GPU's.
function offTwin(planes, p, eye) {
  let off = Math.abs(outside(planes, p));
  const q = clipXY(eye.clip, p);
  // Metres across the picture per unit of clip space, at p's distance.
  const metres = Math.hypot(p[0] - eye.position.x, p[1] - eye.position.y, p[2] - eye.position.z) * eye.spread;
  for (const [nx, ny, nz, d, a, b, c] of planes) {
    const along = Math.abs(nx * p[0] + ny * p[1] + nz * p[2] - d);
    if (along > ON_FACET) continue;
    off = Math.min(off, along + metres * outsideTriangle(q, clipXY(eye.clip, a), clipXY(eye.clip, b), clipXY(eye.clip, c)));
  }
  return off;
}

const ON_FACET = 1e-3; // m: a point this near a triangle's plane lies on it
const point = new Vector3();

// A point's x and y in clip space, after the divide.
function clipXY(clip, p) {
  (Array.isArray(p) ? point.fromArray(p) : point.copy(p)).applyMatrix4(clip);
  return [point.x, point.y];
}

// How far the 2D point q lies outside the triangle a, b, c: 0 inside.
function outsideTriangle(q, a, b, c) {
  const area = (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
  const edges = [[a, b], [b, c], [c, a]];
  const inside = (u, v) => area * ((v[0] - u[0]) * (q[1] - u[1]) - (v[1] - u[1]) * (q[0] - u[0])) >= 0;
  if (area !== 0 && edges.every(([u, v]) => inside(u, v))) return 0;
  return Math.min(...edges.map(([u, v]) => segmentDistance(q, u, v)));
}

function segmentDistance(q, u, v) {
  const [dx, dy] = [v[0] - u[0], v[1] - u[1]];
  const t = Math.min(Math.max(((q[0] - u[0]) * dx + (q[1] - u[1]) * dy) / (dx * dx + dy * dy || 1), 0), 1);
  return Math.hypot(q[0] - u[0] - t * dx, q[1] - u[1] - t * dy);
}
