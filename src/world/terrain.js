// The island's ground and seabed, drawn from world/heightmap.js's grids: a
// level-of-detail mesh (lod.js) whose vertices read the heights on the GPU
// (chunks/terrain.wgsl), fine around the camera and coarse far away.
//
// The grids take about a million samples of island.js, built by a pool of
// workers (heightmap-worker.js; in this thread if they can't run) behind
// `ready`, and kept per seed, so a quality change rebuilds the terrain from
// them at once. Until they are in, nothing is drawn and the water sees deep
// sea everywhere.
//
// It shares the grids with every scene material through ctx.frame.uniforms
// (chunks/terrain.wgsl: the water reads its depth from them), and puts
// ctx.terrain on the context: { island, heightAt(x, z), heightmap, ready, mesh,
// meshHeightAtCove, surfaces, greenAt(x, z) }.
// heightAt is the ground's height at its finest: the mesh matches it within
// about 100 m of the camera, where you walk; farther out the mesh's coarser
// levels stray from it, by centimetres at a few hundred metres and metres far
// out, and it depends on where the camera is. heightmap is world/heightmap.js's,
// once `ready` resolved: its groundAt and zoneAt are the ground as drawn,
// which placement reads. mesh: the overrides and uniforms of the mesh as drawn
// (chunks/terrain-mesh.wgsl), for what stands on it far away, and
// meshHeightAtCove its JS twin; surfaces: the uniforms of the ground's
// surfaces (albedos, chunks/sand.wgsl, rock.wgsl, green.wgsl), for whatever else is
// made of them or lies on them, their tiles' averages filled once `ready`
// resolved; greenAt: whether the green inland is living green or bare ground
// at world x, z, as drawn (world/green.js), once `ready` resolved: 1 green, 0 bare.
import { Box3, Frustum, Matrix4, Vector3, Vector4, toHalfFloat } from '../maths/index.js';
import shader from './terrain.wgsl';
import HeightmapWorker from './heightmap-worker.js?worker&inline';
import { Material } from '../gpu/material.js';
import { Geometry } from '../gpu/geometry.js';
import { Mesh } from '../gpu/scene.js';
import { Texture } from '../gpu/texture.js';
import { createIsland } from './island.js';
import { createHeightmap, fillLush, fillRows, GROUND, layoutLevels } from './heightmap.js';
import { albedoMap } from './albedo.js';
import { greenCover, greenPatches } from './green.js';
import { createSurfaceTiles, tilesUniforms } from '../textures/surfaces.js';
import { sandUniforms } from '../textures/sand.js';
import { rockUniforms } from '../textures/rock.js';
import { greenUniforms } from '../textures/green.js';
import { createLod, createMeshHeight, lodRanges } from './lod.js';

const built = new Map(); // seed -> Promise of the heightmap's grids
const TERRAIN_LEVELS = 4; // chunks/terrain.wgsl's (tests/heightmap.test.js keeps config.world.terrain at it)
const LOD_MAX = 16; // chunks/terrain-mesh.wgsl's arrays hold this many levels
// Surfaces a node of the quadtree may hold (lod.js), each drawn by a shader
// that has its code: the others leave it out. A GPU skips a surface's code
// where a pixel has none of it, but SwiftShader runs every line of a shader at
// every pixel, branches or not. Sand, rock and green show their detail near
// the camera only: SAND is sand with it, ROCK rock without, DETAIL adds
// rock's, GREEN the green's (any shader has the green without it); WET is
// sand without its detail, but with the sheen of wet sand, where a node far
// away reaches down to sand the sea wets.
const SAND = 1;
const ROCK = 2;
const DETAIL = 4;
const GREEN = 8;
const WET = 16;

export function create(ctx) {
  const { scene, camera, frame, config, quality, params, gpu } = ctx;
  const settings = config.world.terrain;
  const seed = String(params.seed ?? config.defaults.seed);
  const island = createIsland(ctx.rng);
  const levels = layoutLevels(settings);
  if (levels.length !== TERRAIN_LEVELS) throw new Error(`config.world.terrain has ${levels.length} levels; chunks/terrain.wgsl expects ${TERRAIN_LEVELS}`);

  // The quadtree spans the coarsest grid, rounded up to whole leaves x 2^n.
  const coarsest = levels.at(-1);
  const extent = (settings.samples - 1) * coarsest.texel;
  const lodLevels = Math.ceil(Math.log2(extent / settings.leaf)) + 1;
  const { morphs, ranges } = lodRanges(quality.terrainDetail, lodLevels, settings.morph, settings.leaf, quality.terrainRatio);
  if (lodLevels > LOD_MAX) throw new Error(`terrain: ${lodLevels} levels of detail; chunks/terrain-mesh.wgsl holds ${LOD_MAX}`);
  const padded = (list, fill) => [...list, ...Array.from({ length: LOD_MAX - list.length }, fill)];
  // The mesh as drawn, for chunks/terrain-mesh.wgsl: here, and for what stands on it.
  const drawn = {
    overrides: { LOD_LEVELS: lodLevels },
    uniforms: {
      uMorph: { value: padded(morphs.map(([start, end]) => new Vector4(start, end, 0, 0)), () => new Vector4()) },
      uLodRange: { value: padded(ranges.map((range) => new Vector4(range, 0, 0, 0)), () => new Vector4()) },
      uLodTree: { value: new Vector4(coarsest.origin[0], coarsest.origin[1], settings.leaf, settings.grid) },
    },
  };

  const uniforms = frame.uniforms;
  const side = island.side;
  uniforms.uTerrainFrame.value.set(side * island.right[0], side * island.right[1], island.forward[0], island.forward[1]);
  levels.forEach((level, k) => uniforms.uTerrainLevels.value[k].set(level.origin[0], level.origin[1], level.texel, 0));
  uniforms.uTerrainSamples.value = settings.samples;
  uniforms.uTerrainBlend.value = settings.blend;

  // The surfaces show their detail as far as the preset has them (groundDetail).
  const ranged = (surface) => ({ ...surface, range: surface.range * quality.groundDetail });
  const sandSettings = ranged(settings.sand);
  const rockSettings = ranged(settings.rock);
  const greenSettings = ranged(settings.green);
  const { albedo } = settings;
  const looks = { albedo, green: settings.green, wetness: settings.sand.wetness, wetHeight: config.world.island.zones.wetSand, sea: config.sky.atmosphere.groundAlbedo };
  const linear = (rgb) => new Vector3(...rgb);
  const tiles = createSurfaceTiles(ctx.renderer, ctx.rng, 'terrain', settings, quality.surfaceTexture);
  const patchRng = ctx.rng('terrain/green/patches');
  const patchSeeds = [patchRng.int(0, 0xffffff), patchRng.int(0, 0xffffff)];
  const patches = greenPatches(settings.green, patchSeeds);
  // The ground's surfaces, shared with what is made of them or lies on them.
  // The tiles' averages are read back from the GPU: zeros until `ready`.
  const surfaceUniforms = ({ sand, rock, green }) => ({
    ...sandUniforms(sand, sandSettings, looks.wetHeight, config.sky.sun.sunsetYaw),
    ...rockUniforms(rock, rockSettings),
    ...greenUniforms(green, albedo, greenSettings, patchSeeds),
  });
  const surfaces = {
    uDrySand: { value: linear(albedo.drySand) },
    uWetSand: { value: linear(albedo.wetSand) },
    uRock: { value: linear(albedo.rock) },
    ...tilesUniforms(tiles),
    ...surfaceUniforms({ sand: { grainMean: new Vector3() }, rock: { mean: new Vector3() }, green: { grassMean: new Vector3(), grassCover: 0, litterCover: 0 } }),
  };
  const materialUniforms = { ...uniforms, ...drawn.uniforms, ...surfaces };

  // A material per set of surfaces, each drawing whole nodes and quarters of
  // nodes (at their parent's spacing with half the quads) with a mesh apiece.
  // Rock shows its relief at any distance: a far cliff is all relief. The
  // green's detail reaches less far than sand's, and sand's less far than
  // rock's, so near sand comes with near rock's.
  // The cove's frame turns the grid's quads into world space; with the
  // headland on the right it also mirrors them, and they would face down.
  const maxNodes = 4096;
  const mirrored = side * (island.right[0] * island.forward[1] - island.right[1] * island.forward[0]) < 0;
  if (settings.sand.range > settings.rock.range) throw new Error('config.world.terrain: sand shows its detail further out than rock');
  if (settings.green.range > settings.sand.range) throw new Error('config.world.terrain: the green shows its detail further out than sand');
  const variants = new Map();
  const near = [0, SAND, ROCK | DETAIL, SAND | ROCK | DETAIL];
  // Beyond sand's detail: rock with or without its detail, either with wet sand.
  const far = [ROCK, WET, ROCK | WET, ROCK | DETAIL | WET];
  for (const surfaces of [...near, ...far, ...near.map((s) => s | GREEN)]) {
    const material = new Material({
      name: ['terrain', surfaces & SAND && 'sand', surfaces & ROCK && 'rock', surfaces & DETAIL && 'detail', surfaces & GREEN && 'green', surfaces & WET && 'wet'].filter(Boolean).join('-'),
      shader,
      uniforms: materialUniforms,
      overrides: {
        ...drawn.overrides,
        TERRAIN_SAND: Boolean(surfaces & SAND),
        TERRAIN_ROCK: Boolean(surfaces & ROCK),
        ROCK_DETAIL: Boolean(surfaces & DETAIL),
        GREEN_DETAIL: Boolean(surfaces & GREEN),
        TERRAIN_WET: Boolean(surfaces & WET),
      },
    });
    const meshes = [settings.grid, settings.grid / 2].map((quads) => {
      const mesh = new Mesh(gridGeometry(quads, maxNodes, mirrored), material);
      mesh.name = material.name;
      mesh.frustumCulled = false; // lod.js culls node by node
      mesh.visible = false; // until the grids are in
      scene.add(mesh);
      return mesh;
    });
    variants.set(surfaces, { material, meshes });
  }
  const allMeshes = [...variants.values()].flatMap((v) => v.meshes);

  let heightmap = null;
  let lod = null;
  let meshHeight = null;
  let failed = null;
  let disposed = false;
  const textures = [];
  const groundScratch = {};

  const ready = Promise.all([heightmapFor(island, seed, settings), tiles.ready]).then(
    ([grids, averages]) => {
      if (disposed) return;
      for (const [name, { value }] of Object.entries(surfaceUniforms(averages))) surfaces[name].value = value;
      heightmap = grids;
      upload(grids);
      const tree = { origin: coarsest.origin, levels: lodLevels, leaf: settings.leaf, grid: settings.grid };
      lod = createLod(tree, nodeBounds(grids, settings.sand.wetness.dry));
      meshHeight = createMeshHeight(tree, { ranges, morphs }, grids.heightAtCove, levels.length);
      for (const mesh of allMeshes) mesh.visible = true;
    },
    (err) => {
      failed = err;
      throw err;
    },
  );

  ctx.terrain = {
    island,
    ready,
    get heightmap() {
      return heightmap;
    },
    // The height as drawn at world x, z; the island's own until the grids are in.
    heightAt: (x, z) => (heightmap ? heightmap.heightAt(x, z) : island.height(x, z)),
    mesh: drawn,
    // The mesh's own height at a, o in the cove's frame for a camera at
    // cam = [a, y, o] (lod.js createMeshHeight), once `ready` resolved.
    meshHeightAtCove: (a, o, cam) => meshHeight(a, o, cam),
    surfaces,
    greenAt(x, z) {
      const ground = heightmap.groundAt(x, z, groundScratch);
      return patches.rank(x, z) < greenCover(ground.band, ground.lush, settings.green) ? 1 : 0;
    },
  };

  // Trilinear, as three.js's LinearMipmapLinearFilter.
  const filtered = { mag: 'linear', min: 'linear', mipmap: 'linear' };
  function upload(grids) {
    const n = settings.samples;
    const array = (name, format, data, mips) =>
      new Texture(gpu, { name, width: n, height: n, depth: levels.length, array: true, format, mips, data: true, sampler: filtered }).upload(data);
    // Read texel by texel: core WebGPU can't filter 32-bit floats.
    const height = array('terrain height', 'r32float', grids.heightData, false);
    // Kept with the grids, so a quality change doesn't convert them again.
    grids.infoHalf ??= halves(grids.infoData);
    // The ground's albedo from above, over the coarsest grid: the light from
    // below averages it over tens of metres (chunks/lighting.wgsl groundAlbedo).
    const coarsest = grids.levels.at(-1);
    grids.albedoHalf ??= halves(albedoMap(coarsest, looks));
    // Filtered and mipmapped: from afar a pixel shows its footprint's average,
    // so a far ridge keeps its share of rock.
    const info = array('terrain info', 'rgba16float', grids.infoHalf, true).generateMipmaps();
    const ground = array('terrain ground', 'rgba8unorm', grids.groundData, true).generateMipmaps();
    const bounce = new Texture(gpu, { name: 'terrain bounce', width: n, height: n, format: 'rgba16float', mips: true, data: true, sampler: filtered });
    bounce.upload(grids.albedoHalf).generateMipmaps();
    textures.push(height, info, ground, bounce);
    uniforms.uTerrainHeight.value = height;
    uniforms.uTerrainInfo.value = info;
    uniforms.uTerrainGround.value = ground;
    uniforms.uTerrainReady.value = 1;
    uniforms.uBounceMap.value = bounce;
    const { origin, texel } = coarsest;
    uniforms.uBounceLayout.value.set(origin[0] - texel / 2, origin[1] - texel / 2, 1 / (n * texel), Math.log2(settings.bounceReach / texel));
  }

  // Each frame, once the camera is where it will be: the nodes for it.
  const frustum = new Frustum();
  const viewProjection = new Matrix4();
  const box = new Box3();
  const corner = new Vector3();
  const selected = [];
  const groundRadius = config.sky.atmosphere.groundRadius * 1000;
  const stopSelecting = frame.beforeScene(() => {
    if (!lod) return;
    viewProjection.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
    frustum.setFromProjectionMatrix(viewProjection);
    const [ca, co] = island.toCove(camera.position.x, camera.position.z);
    const cam = [ca, camera.position.y, co];
    lod.select(cam, ranges, (a0, o0, size, min, max) => {
      box.makeEmpty();
      let far = 0;
      for (const [a, o] of [[a0, o0], [a0 + size, o0], [a0, o0 + size], [a0 + size, o0 + size]]) {
        const [x, z] = island.fromCove(a, o);
        box.expandByPoint(corner.set(x, min, z));
        far = Math.max(far, (x - camera.position.x) ** 2 + (z - camera.position.z) ** 2);
      }
      box.min.y = min - far / (2 * groundRadius) - 1; // the ground bends down with the planet
      box.max.y = max + 1;
      return frustum.intersectsBox(box);
    }, selected);
    for (const mesh of allMeshes) mesh.geometry.instanceCount = 0;
    const sandRange2 = sandSettings.range ** 2;
    const rockRange2 = rockSettings.range ** 2;
    const greenRange2 = greenSettings.range ** 2;
    for (const node of selected) {
      const size = node.spacing * (node.quarter ? settings.grid / 2 : settings.grid);
      const da = Math.max(node.a - ca, 0, ca - node.a - size);
      const dO = Math.max(node.o - co, 0, co - node.o - size);
      const near2 = da * da + dO * dO;
      const sandy = node.surfaces & SAND ? (near2 < sandRange2 ? SAND : node.surfaces & WET) : 0;
      const rocky = node.surfaces & ROCK ? (near2 < rockRange2 ? ROCK | DETAIL : ROCK) : 0;
      const greeny = node.surfaces & GREEN && near2 < greenRange2 ? GREEN : 0;
      const variant = variants.get(sandy | rocky | greeny);
      const { geometry } = variant.meshes[node.quarter ? 1 : 0];
      const i = geometry.instanceCount++;
      if (i >= maxNodes) throw new Error(`terrain: more than ${maxNodes} nodes`);
      geometry.attributes.aNode.array.set([node.a, node.o, node.spacing, node.level], 4 * i);
    }
    for (const { geometry } of allMeshes) geometry.update('aNode', 0, geometry.instanceCount);
  });

  return {
    ready,
    update() {
      if (failed) throw failed;
    },
    dispose() {
      disposed = true;
      stopSelecting();
      for (const mesh of allMeshes) {
        scene.remove(mesh);
        mesh.geometry.dispose();
      }
      for (const { material } of variants.values()) material.dispose();
      tiles.dispose();
      for (const texture of textures) texture.destroy();
      uniforms.uTerrainHeight.value = null;
      uniforms.uTerrainInfo.value = null;
      uniforms.uTerrainGround.value = null;
      uniforms.uTerrainReady.value = 0;
      uniforms.uBounceMap.value = null;
      uniforms.uBounceLayout.value.set(0, 0, 0, 0);
      delete ctx.terrain;
    },
  };
}

// Floats as half floats. A plain loop: Uint16Array.from with a map function
// takes 20 times as long.
function halves(floats) {
  const half = new Uint16Array(floats.length);
  for (let i = 0; i < half.length; i++) half[i] = toHalfFloat(floats[i]);
  return half;
}

// A grid of `quads` x `quads` quads, its vertices at whole numbers (x, 0, z),
// drawn once per node, with room for `nodes` of them; `mirrored` winds its
// triangles the other way.
function gridGeometry(quads, nodes, mirrored) {
  const geometry = new Geometry();
  const positions = [];
  for (let j = 0; j <= quads; j++) for (let i = 0; i <= quads; i++) positions.push(i, 0, j);
  const index = [];
  const at = (i, j) => j * (quads + 1) + i;
  for (let j = 0; j < quads; j++) {
    for (let i = 0; i < quads; i++) index.push(at(i, j), at(i, j + 1), at(i + 1, j), at(i + 1, j), at(i, j + 1), at(i + 1, j + 1));
  }
  if (mirrored) index.reverse();
  geometry.setAttribute('position', positions, 3);
  geometry.setIndex(index);
  geometry.setAttribute('aNode', new Float32Array(4 * nodes), 4, { instance: true });
  geometry.instanceCount = 0;
  return geometry;
}

// The lowest and highest ground over a square of the quadtree, from every
// grid that covers it, with a little room for the blends between them; and
// the surfaces on it: wet sand where sand lies below `dry` m above the sea, the
// wet sand's reach (chunks/wet.wgsl), with room for how far the waves reach
// further and for the samples' spacing.
function nodeBounds(heightmap, dry) {
  const { levels, samples } = heightmap;
  return (a0, o0, size) => {
    let min = Infinity;
    let max = -Infinity;
    let surfaces = 0;
    for (const { origin, texel, heights, ground } of levels) {
      const i0 = Math.floor((a0 - origin[0]) / texel) - 1;
      const j0 = Math.floor((o0 - origin[1]) / texel) - 1;
      const i1 = Math.ceil((a0 + size - origin[0]) / texel) + 1;
      const j1 = Math.ceil((o0 + size - origin[1]) / texel) + 1;
      if (i1 < 0 || j1 < 0 || i0 >= samples || j0 >= samples) continue;
      for (let j = Math.max(j0, 0); j <= Math.min(j1, samples - 1); j++) {
        for (let i = Math.max(i0, 0); i <= Math.min(i1, samples - 1); i++) {
          const h = heights[j * samples + i];
          if (h < min) min = h;
          if (h > max) max = h;
          const n = GROUND * (j * samples + i);
          if (ground[n] > 0) surfaces |= h < dry + 0.5 && h > -1 ? SAND | WET : SAND;
          if (ground[n + 1] > 0) surfaces |= ROCK;
          if (ground[n] + ground[n + 1] < 0.85 * 255) surfaces |= GREEN; // a share worth its detail
        }
      }
    }
    return [min - 1, max + 1, surfaces];
  };
}

// The heightmap for a seed: built once by a pool of workers, then kept. A
// failed build isn't kept, so the next try starts afresh.
function heightmapFor(island, seed, settings) {
  if (!built.has(seed)) {
    built.set(
      seed,
      build(island, seed, settings).catch((err) => {
        built.delete(seed);
        throw err;
      }),
    );
  }
  return built.get(seed);
}

// The grids' jobs: rows of a level each, filled by the workers (or here, if
// they can't run) into one array per kind, levels one after another; then
// how lush, from the whole grids.
function build(island, seed, settings) {
  const { samples, rowsPerTask } = settings;
  const levels = layoutLevels(settings);
  const perLevel = samples * samples;
  const heightData = new Float32Array(levels.length * perLevel);
  const infoData = new Float32Array(4 * levels.length * perLevel);
  const groundData = new Uint8Array(GROUND * levels.length * perLevel);
  const tasks = [];
  levels.forEach((_, level) => {
    for (let j0 = 0; j0 < samples; j0 += rowsPerTask) tasks.push({ seed, level, j0, j1: Math.min(j0 + rowsPerTask, samples) });
  });
  const store = ({ level, j0, heights, info, ground }) => {
    heightData.set(heights, level * perLevel + j0 * samples);
    infoData.set(info, 4 * (level * perLevel + j0 * samples));
    groundData.set(ground, GROUND * (level * perLevel + j0 * samples));
  };
  const finish = () => {
    const data = levels.map((_, k) => ({
      heights: heightData.subarray(k * perLevel, (k + 1) * perLevel),
      info: infoData.subarray(4 * k * perLevel, 4 * (k + 1) * perLevel),
      ground: groundData.subarray(GROUND * k * perLevel, GROUND * (k + 1) * perLevel),
    }));
    fillLush(island, settings, data);
    return Object.assign(createHeightmap(island, settings, data), { heightData, infoData, groundData });
  };
  return inWorkers(tasks, store, settings.maxWorkers).then(finish, (err) => {
    // Workers that won't start or run (a browser that refuses them from
    // file://, say): build here instead, slower but the same grids. If the
    // island itself throws, it throws here too.
    console.warn(`terrain: ${err.message}; building the heightmap without workers`);
    for (const task of tasks) {
      const rows = task.j1 - task.j0;
      const heights = new Float32Array(rows * samples);
      const info = new Float32Array(4 * rows * samples);
      const ground = new Uint8Array(GROUND * rows * samples);
      fillRows(island, levels[task.level], samples, task.j0, task.j1, heights, info, ground);
      store({ ...task, heights, info, ground });
    }
    return finish();
  });
}

function inWorkers(tasks, store, maxWorkers) {
  const count = Math.max(1, Math.min(maxWorkers, (navigator.hardwareConcurrency || 2) - 1, tasks.length));
  return new Promise((resolve, reject) => {
    const workers = [];
    const stop = () => workers.forEach((w) => w.terminate());
    let next = 0;
    let done = 0;
    const give = (worker) => {
      if (next < tasks.length) worker.postMessage(tasks[next++]);
    };
    try {
      for (let i = 0; i < count; i++) workers.push(new HeightmapWorker());
    } catch (err) {
      stop();
      reject(new Error(`heightmap workers won't start (${err.message})`));
      return;
    }
    for (const worker of workers) {
      worker.onmessage = ({ data }) => {
        store(data);
        if (++done === tasks.length) {
          stop();
          resolve();
        } else {
          give(worker);
        }
      };
      worker.onerror = worker.onmessageerror = (e) => {
        stop();
        reject(new Error(`a heightmap worker failed (${e.message || e.type})`));
      };
      give(worker);
    }
  });
}
