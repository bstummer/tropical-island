// The island's ground and seabed, drawn from world/heightmap.js's grids: a
// level-of-detail mesh (lod.js; its nodes' grid and ground: terrain-nodes.js)
// whose vertices read the heights on the GPU (chunks/terrain.wgsl), fine
// around the camera and coarse far away.
//
// The grids take about two million samples of island.js, built by a pool of
// workers (heightmap-worker.js; in this thread if they can't run) behind
// `ready`, the coarse one first, as the fine one is fitted to it, and kept
// per seed, so a quality change rebuilds the terrain from them at once. Until
// they are in, nothing is drawn and the water sees deep sea everywhere.
//
// It shares the grids with every scene material through ctx.frame.uniforms
// (chunks/terrain.wgsl: the water reads its depth from them), and puts
// ctx.terrain on the context: { island, heightAt(x, z), heightmap, grids,
// ready, mesh, meshHeightAtCove, surfaces, greenAt(x, z) }. grids: a promise
// of the heightmap as soon as its grids are in, before `ready`, which waits
// for the surfaces' tiles too: work that needs only the grids (placing the
// rocks) runs while the GPU makes the tiles.
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
import { Attribute } from '../gpu/geometry.js';
import { Mesh } from '../gpu/scene.js';
import { Texture } from '../gpu/texture.js';
import { createIsland } from './island.js';
import { createGrids, fillRows, gridAlign, GROUND, layoutLevel } from './heightmap.js';
import { albedoMap } from './albedo.js';
import { greenCover, greenPatches } from './green.js';
import { createSurfaceTiles, tilesUniforms } from '../textures/surfaces.js';
import { sandUniforms } from '../textures/sand.js';
import { rockUniforms } from '../textures/rock.js';
import { greenUniforms } from '../textures/green.js';
import { createLod, createMeshHeight, lodRanges } from './lod.js';
import { DETAIL, GREEN, gridGeometry, INLAND, leftToWater, nodeBounds, ROCK, SAND, WET } from './terrain-nodes.js';

const built = new Map(); // seed -> Promise of the heightmap's grids
const TERRAIN_LEVELS = 2; // chunks/terrain.wgsl's (tests/heightmap.test.js keeps config.world.terrain at it)
// The uniforms of each level's textures (chunks/frame.wgsl), finest first:
// its heights, and its info and ground as the two layers of one array, which
// takes one of the textures a shader can bind for both.
const LEVEL_TEXTURES = [
  { height: 'uTerrainHeight', surface: 'uTerrainSurface' },
  { height: 'uTerrainHeightCoarse', surface: 'uTerrainSurfaceCoarse' },
];
const LOD_MAX = 16; // chunks/terrain-mesh.wgsl's arrays hold this many levels
// A variant's surfaces with this bit read no shadow maps: no shadow falls on its
// pieces (ctx.shadows.reaches), though they lie within the maps' reach.
const UNSHADED = 64;

export function create(ctx) {
  const { scene, camera, frame, config, quality, params, gpu } = ctx;
  const settings = config.world.terrain;
  const seed = String(params.seed ?? config.defaults.seed);
  const island = createIsland(ctx.rng);
  if (settings.levels.length !== TERRAIN_LEVELS) throw new Error(`config.world.terrain has ${settings.levels.length} levels; chunks/terrain.wgsl expects ${TERRAIN_LEVELS}`);

  // The quadtree spans the coarsest grid, which the island alone lays out,
  // rounded up to whole leaves x 2^n.
  const coarsest = layoutLevel(island, settings, TERRAIN_LEVELS - 1);
  const extent = (coarsest.samples - 1) * coarsest.texel;
  const lodLevels = Math.ceil(Math.log2(extent / settings.leaf)) + 1;
  const { morphs, ranges } = lodRanges(quality.terrainDetail, lodLevels, settings.morph, settings.leaf, quality.terrainRatio);
  if (lodLevels > LOD_MAX) throw new Error(`terrain: ${lodLevels} levels of detail; chunks/terrain-mesh.wgsl holds ${LOD_MAX}`);
  // The grid each level of the mesh takes its heights from: the coarsest
  // whose samples lie no further apart than its quads, or the finest. The
  // grids share their samples' lines with the quadtree's, so its vertices
  // land on that grid's samples.
  const quad = settings.leaf / settings.grid; // m: a finest node's quads
  const heightLevels = ranges.map((_, level) => Math.max(0, settings.levels.findLastIndex(({ texel }) => texel <= quad * 2 ** level)));
  const padded = (list, fill) => [...list, ...Array.from({ length: LOD_MAX - list.length }, fill)];
  // The mesh as drawn, for chunks/terrain-mesh.wgsl: here, and for what stands on it.
  const drawn = {
    overrides: { LOD_LEVELS: lodLevels },
    uniforms: {
      uMorph: { value: padded(morphs.map(([start, end]) => new Vector4(start, end, 0, 0)), () => new Vector4()) },
      uLodRange: { value: padded(ranges.map((range, level) => new Vector4(range, heightLevels[level], 0, 0)), () => new Vector4()) },
      uLodTree: { value: new Vector4(coarsest.origin[0], coarsest.origin[1], settings.leaf, settings.grid) },
    },
  };

  const uniforms = frame.uniforms;
  const side = island.side;
  uniforms.uTerrainFrame.value.set(side * island.right[0], side * island.right[1], island.forward[0], island.forward[1]);
  uniforms.uTerrainBlend.value = settings.blend;

  // The surfaces show their detail as far as the preset has them (groundDetail).
  const ranged = (surface) => ({ ...surface, range: surface.range * quality.groundDetail });
  const sandSettings = ranged(settings.sand);
  const rockSettings = ranged(settings.rock);
  const greenSettings = ranged(settings.green);
  const { albedo } = settings;
  const looks = { albedo, green: settings.green, wetness: settings.sand.wetness, wetHeight: config.world.island.zones.wetSand, sea: config.sky.atmosphere.groundAlbedo, water: config.water };
  const linear = (rgb) => new Vector3(...rgb);
  const tiles = createSurfaceTiles(ctx.renderer, ctx.rng, 'terrain', settings, quality.surfaceTexture);
  const patchRng = ctx.rng('terrain/green/patches');
  const patchSeeds = [patchRng.int(0, 0xffffff), patchRng.int(0, 0xffffff)];
  const patches = greenPatches(settings.green, patchSeeds);
  // The ground's surfaces, shared with what is made of them or lies on them.
  // The tiles' averages are read back from the GPU: zeros until `ready`.
  const surfaceUniforms = ({ sand, rock, green, glints }) => ({
    uGlintMean: { value: glints },
    ...sandUniforms(sand, sandSettings, looks.wetHeight, config.sky.sun.sunsetYaw),
    ...rockUniforms(rock, rockSettings),
    ...greenUniforms(green, albedo, greenSettings, patchSeeds),
  });
  const surfaces = {
    uDrySand: { value: linear(albedo.drySand) },
    uWetSand: { value: linear(albedo.wetSand) },
    uRock: { value: linear(albedo.rock) },
    uSeabedSand: { value: linear(config.water.seabedSand) },
    uSeabedRock: { value: linear(config.water.seabedRock) },
    uSeabedDeepest: { value: config.water.seabedFade[1] },
    uUnderSea: { value: new Vector3(...config.water.groundFade, config.water.troughs) },
    ...tilesUniforms(tiles),
    ...surfaceUniforms({ sand: { grainMean: new Vector3() }, rock: { mean: new Vector4() }, green: { grassMean: new Vector3(), grassCover: 0, litterCover: 0 }, glints: 1 }),
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
  // Every mesh's nodes in one attribute, each mesh drawing its range of them.
  const nodes = new Attribute(new Float32Array(4 * maxNodes), 4, { instance: true });
  const mirrored = side * (island.right[0] * island.forward[1] - island.right[1] * island.forward[0]) < 0;
  if (settings.sand.range > settings.rock.range) throw new Error('config.world.terrain: sand shows its detail further out than rock');
  if (settings.green.range > settings.sand.range) throw new Error('config.world.terrain: the green shows its detail further out than sand');
  const variants = new Map();
  const near = [0, SAND, ROCK | DETAIL, SAND | ROCK | DETAIL];
  // Beyond sand's detail: rock with or without its detail, either with wet sand.
  const far = [ROCK, WET, ROCK | WET, ROCK | DETAIL | WET];
  // Each with the green or without it, near with its detail or without.
  const nearAll = [...near, ...near.map((s) => s | INLAND), ...near.map((s) => s | INLAND | GREEN)];
  const farAll = [...far, ...far.map((s) => s | INLAND)];
  for (const surfaces of [...nearAll, ...farAll, ...nearAll.map((s) => s | UNSHADED)]) {
    const material = new Material({
      name: ['terrain', surfaces & SAND && 'sand', surfaces & ROCK && 'rock', surfaces & DETAIL && 'detail', surfaces & GREEN && 'green', surfaces & WET && 'wet', surfaces & UNSHADED && 'unshaded'].filter(Boolean).join('-'),
      shader,
      uniforms: materialUniforms,
      overrides: {
        ...drawn.overrides,
        TERRAIN_SAND: Boolean(surfaces & SAND),
        TERRAIN_ROCK: Boolean(surfaces & ROCK),
        ROCK_DETAIL: Boolean(surfaces & DETAIL),
        TERRAIN_GREEN: Boolean(surfaces & INLAND),
        GREEN_DETAIL: Boolean(surfaces & GREEN),
        TERRAIN_WET: Boolean(surfaces & WET),
        SHADE_ONCE: true, // its shadows read once a pixel, the island's shade as the ground's own (chunks/shadows.wgsl)
        SHADE_GROUND: true,
        // Far pieces lie past the shadow maps (config.shadows): what casts into them stands near.
        SHADOW_MAP: !farAll.includes(surfaces) && !(surfaces & UNSHADED),
      },
    });
    const meshes = [settings.grid, settings.grid / 2].map((quads) => {
      const mesh = new Mesh(gridGeometry(quads, nodes, mirrored), material);
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

  const gridsIn = heightmapFor(island, seed, settings, looks);
  // The quadtree's bounds and surfaces depend on the grids alone: worked out
  // as soon as they are in, while the GPU makes the tiles, and kept with them.
  const tree = { origin: coarsest.origin, levels: lodLevels, leaf: settings.leaf, grid: settings.grid };
  const lodIn = gridsIn.then((grids) => (grids.lod ??= createLod(tree, nodeBounds(grids, settings.sand.wetness.dry, settings.blend))));
  const ready = Promise.all([gridsIn, lodIn, tiles.ready]).then(
    ([grids, lodOfGrids, averages]) => {
      if (disposed) return;
      for (const [name, { value }] of Object.entries(surfaceUniforms(averages))) surfaces[name].value = value;
      heightmap = grids;
      upload(grids);
      lod = lodOfGrids;
      meshHeight = createMeshHeight(tree, { ranges, morphs }, grids.heightAtCove, heightLevels);
      for (const mesh of allMeshes) mesh.visible = true;
    },
    (err) => {
      failed = err;
      throw err;
    },
  );

  ctx.terrain = {
    island,
    grids: gridsIn,
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
  // Each level's textures of its own: they differ in size.
  function upload(grids) {
    grids.levels.forEach((level, k) => {
      const n = level.samples;
      if (n % gridAlign(settings)) throw new Error(`terrain: the ${level.texel} m grid is ${n} samples across, which doesn't halve ${settings.mips - 1} times`);
      const texture = (name, format, data, mips) =>
        new Texture(gpu, { name: `${name} ${level.texel} m`, width: n, height: n, format, mips, data: true, sampler: filtered }).upload(data);
      // Read texel by texel: core WebGPU can't filter 32-bit floats.
      const height = texture('terrain height', 'r32float', level.heights, false);
      // Filtered and mipmapped: from afar a pixel shows its footprint's average,
      // so a far ridge keeps its share of rock. As many levels as halve the
      // grid exactly (config.world.terrain.mips): further on, a pixel reads the last.
      // Its info (layer 0) and ground (layer 1, its bytes as half floats).
      const surface = new Texture(gpu, { name: 'terrain surface ' + level.texel + ' m', width: n, height: n, depth: 2, array: true, format: 'rgba16float', mips: settings.mips, data: true, sampler: filtered });
      surface.upload(level.infoHalf, { layer: 0, layers: 1 }).upload(byteHalves(level.ground), { layer: 1, layers: 1 }).generateMipmaps();
      textures.push(height, surface);
      const names = LEVEL_TEXTURES[k];
      uniforms[names.height].value = height;
      uniforms[names.surface].value = surface;
      uniforms.uTerrainLevels.value[k].set(level.origin[0], level.origin[1], level.texel, n);
    });
    const { origin, texel, samples: n, albedoHalf } = grids.levels.at(-1);
    const bounce = new Texture(gpu, { name: 'terrain bounce', width: n, height: n, format: 'rgba16float', mips: settings.mips, data: true, sampler: filtered });
    bounce.upload(albedoHalf).generateMipmaps();
    textures.push(bounce);
    uniforms.uTerrainReady.value = 1;
    uniforms.uBounceMap.value = bounce;
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
      // Wholly under the sea, it is the water's to draw (water/water-seabed.wgsl).
      if (leftToWater(max, config.water.groundFade) && camera.position.y > 0) return false;
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
      let surfaces = sandy | rocky | greeny | (node.surfaces & INLAND);
      if (!farAll.includes(surfaces) && ctx.shadows && !ctx.shadows.reaches(node.a, node.o, node.a + size, node.o + size)) surfaces |= UNSHADED;
      node.geometry = variants.get(surfaces).meshes[node.quarter ? 1 : 0].geometry;
      node.geometry.instanceCount++;
    }
    // Each mesh's range of the nodes, in the order selected.
    let count = 0;
    for (const { geometry } of allMeshes) {
      geometry.firstInstance = count;
      count += geometry.instanceCount;
      geometry.instanceCount = 0;
    }
    if (count > maxNodes) throw new Error(`terrain: more than ${maxNodes} nodes`);
    for (const node of selected) {
      const { geometry } = node;
      nodes.array.set([node.a, node.o, node.spacing, node.level], 4 * (geometry.firstInstance + geometry.instanceCount++));
    }
    nodes.update(0, count);
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
      for (const names of LEVEL_TEXTURES) for (const name of Object.values(names)) uniforms[name].value = null;
      uniforms.uTerrainReady.value = 0;
      uniforms.uBounceMap.value = null;
      uniforms.uBounceLayout.value.set(0, 0, 0, 0);
      delete ctx.terrain;
    },
  };
}

// Bytes (0 to 255) as half floats of their share of 255.
const BYTE_HALVES = Uint16Array.from({ length: 256 }, (_, b) => toHalfFloat(b / 255));
function byteHalves(bytes) {
  const half = new Uint16Array(bytes.length);
  for (let i = 0; i < half.length; i++) half[i] = BYTE_HALVES[bytes[i]];
  return half;
}

// Floats as half floats, into `half`. A plain loop: Uint16Array.from with a
// map function takes 20 times as long.
function halves(floats, half = new Uint16Array(floats.length)) {
  for (let i = 0; i < half.length; i++) half[i] = toHalfFloat(floats[i]);
  return half;
}

// The heightmap for a seed: built once by a pool of workers, then kept. A
// failed build isn't kept, so the next try starts afresh.
function heightmapFor(island, seed, settings, looks) {
  if (!built.has(seed)) {
    built.set(
      seed,
      build(island, seed, settings, looks).catch((err) => {
        built.delete(seed);
        throw err;
      }),
    );
  }
  return built.get(seed);
}

// The grids' jobs: rows of a level each, handed out as the level is laid out
// (the fine one once the coarse one is in), filled by the workers (or here, if
// they can't run) and stored as they come (heightmap.js createGrids). Each
// level, once its rows are all in and while the workers build the rest, also
// goes to the GPU's formats: its info as half floats, and over the coarsest
// grid the ground's albedo from above (`looks`: albedo.js's surfaces; the
// light from below averages it over tens of metres, chunks/lighting.wgsl
// groundAlbedo). Kept with the grids, so a quality change uploads them as they are.
function build(island, seed, settings, looks) {
  const { rowsPerTask } = settings;
  // jobs: { tasks, store, finish, added }; added() hears of tasks added (a
  // level laid out), so a pool can hand them out at once.
  const collect = () => {
    const jobs = { tasks: [], added() {} };
    const grids = createGrids(island, settings, {
      onLayout(level, { texel, origin, samples }) {
        const layout = { texel, origin, samples };
        for (let j0 = 0; j0 < samples; j0 += rowsPerTask) jobs.tasks.push({ seed, level, layout, j0, j1: Math.min(j0 + rowsPerTask, samples) });
        jobs.added();
      },
      onLevel(k, level) {
        level.infoHalf = halves(level.info);
        if (k === settings.levels.length - 1) level.albedoHalf = halves(albedoMap(level, looks));
      },
    });
    return Object.assign(jobs, { store: grids.store, finish: grids.finish });
  };
  const grids = collect();
  return inWorkers(grids, settings.maxWorkers).then(grids.finish, (err) => {
    // Storing their rows failed (laying out a level, say): here it would too.
    if (!err.workers) throw err;
    // Workers that won't start or run (a browser that refuses them from
    // file://, say): build here instead, slower but the same grids, afresh
    // as some rows may be in. If the island or a level's work throws, it
    // throws here too.
    console.warn(`terrain: ${err.message}; building the heightmap without workers`);
    const here = collect();
    for (let t = 0; t < here.tasks.length; t++) {
      const task = here.tasks[t];
      const count = task.layout.samples * (task.j1 - task.j0);
      const heights = new Float32Array(count);
      const info = new Float32Array(4 * count);
      const ground = new Uint8Array(GROUND * count);
      fillRows(island, task.layout, task.j0, task.j1, heights, info, ground);
      here.store({ ...task, heights, info, ground });
    }
    return here.finish();
  });
}

// Runs `jobs` (build's: tasks, store, added) in a pool of workers, storing
// each result as it comes. Storing may add tasks (a level laid out once the
// one it is fitted to is in), which idle workers take up at once, before the
// rest of storing that level, which takes a while. Rejects with an error
// marked `workers` if the workers fail, and with storing's own if that does.
function inWorkers(jobs, maxWorkers) {
  const { tasks, store } = jobs;
  const count = Math.max(1, Math.min(maxWorkers, (navigator.hardwareConcurrency || 2) - 1));
  const failed = (message) => Object.assign(new Error(message), { workers: true });
  return new Promise((resolve, reject) => {
    const workers = [];
    const stop = () => workers.forEach((w) => w.terminate());
    let next = 0;
    let done = 0;
    const idle = []; // workers that asked for a job when there was none
    const give = (worker) => {
      if (next < tasks.length) worker.postMessage(tasks[next++]);
      else idle.push(worker);
    };
    jobs.added = () => {
      while (idle.length && next < tasks.length) give(idle.pop());
    };
    try {
      for (let i = 0; i < count; i++) workers.push(new HeightmapWorker());
    } catch (err) {
      stop();
      reject(failed(`heightmap workers won't start (${err.message})`));
      return;
    }
    for (const worker of workers) {
      worker.onmessage = ({ data }) => {
        give(worker); // its next job first: storing may finish a level, which takes a while
        try {
          store(data);
        } catch (err) {
          stop();
          reject(err);
          return;
        }
        if (++done === tasks.length) {
          stop();
          resolve();
        }
      };
      worker.onerror = worker.onmessageerror = (e) => {
        stop();
        reject(failed(`a heightmap worker failed (${e.message || e.type})`));
      };
      // Two jobs each, the second queued behind the first: a worker carries
      // on while this thread is busy with a level whose rows are all in.
      give(worker);
      give(worker);
    }
  });
}
