// The island's ground and seabed, drawn from world/heightmap.js's grids: a
// level-of-detail mesh (lod.js) whose vertices read the heights on the GPU
// (chunks/terrain.glsl), fine around the camera and coarse far away.
//
// The grids take about a million samples of island.js, built by a pool of
// workers (heightmap-worker.js; in this thread if they can't run) behind
// `ready`, and kept per seed, so a quality change rebuilds the terrain from
// them at once. Until they are in, nothing is drawn and the water sees deep
// sea everywhere.
//
// It shares the grids with every scene material through ctx.frame.uniforms
// (chunks/terrain.glsl: the water reads its depth from them), and puts
// ctx.terrain on the context: { island, heightAt(x, z), heightmap, ready }.
// heightAt is the ground's height at its finest: the mesh matches it within
// about 100 m of the camera, where you walk; farther out the mesh's coarser
// levels stray from it, by centimetres at a few hundred metres and metres far
// out, and it depends on where the camera is. heightmap is world/heightmap.js's,
// once `ready` resolved.
import * as THREE from 'three';
import vertexShader from './terrain.vert';
import fragmentShader from './terrain.frag';
import HeightmapWorker from './heightmap-worker.js?worker&inline';
import { createIsland } from './island.js';
import { createHeightmap, fillRows, layoutLevels } from './heightmap.js';
import { createLod, lodRanges } from './lod.js';

const built = new Map(); // seed -> Promise of the heightmap's grids
const TERRAIN_LEVELS = 4; // chunks/terrain.glsl's (tests/heightmap.test.js keeps config.world.terrain at it)

export function create(ctx) {
  const { scene, camera, frame, config, quality, params } = ctx;
  const settings = config.world.terrain;
  const seed = String(params.seed ?? config.defaults.seed);
  const island = createIsland(ctx.rng);
  const levels = layoutLevels(settings);
  if (levels.length !== TERRAIN_LEVELS) throw new Error(`config.world.terrain has ${levels.length} levels; chunks/terrain.glsl expects ${TERRAIN_LEVELS}`);

  // The quadtree spans the coarsest grid, rounded up to whole leaves x 2^n.
  const coarsest = levels.at(-1);
  const extent = (settings.samples - 1) * coarsest.texel;
  const lodLevels = Math.ceil(Math.log2(extent / settings.leaf)) + 1;
  const { morphs, ranges } = lodRanges(quality.terrainDetail, lodLevels, settings.morph, settings.leaf, quality.terrainRatio);

  const uniforms = frame.uniforms;
  const side = island.side;
  uniforms.uTerrainFrame.value.set(side * island.right[0], side * island.right[1], island.forward[0], island.forward[1]);
  levels.forEach((level, k) => uniforms.uTerrainLevels.value[k].set(level.origin[0], level.origin[1], level.texel, 0));
  uniforms.uTerrainSamples.value = settings.samples;
  uniforms.uTerrainBlend.value = settings.blend;

  const colour = (hex) => new THREE.Color(hex); // sRGB hex, made linear
  const { colours } = settings;
  const { zones } = config.world.island;
  const material = new THREE.ShaderMaterial({
    name: 'terrain',
    vertexShader,
    fragmentShader,
    uniforms: {
      ...uniforms,
      uMorph: { value: morphs.map(([start, end]) => new THREE.Vector2(start, end)) },
      uDrySand: { value: colour(colours.drySand) },
      uWetSand: { value: colour(colours.wetSand) },
      uSeabed: { value: colour(colours.seabed) },
      uScrub: { value: colour(colours.scrub) },
      uGreen: { value: colour(colours.green) },
      uJungle: { value: colour(colours.jungle) },
      uRock: { value: colour(colours.rock) },
      uBands: {
        value: new THREE.Vector4(
          zones.wetSand,
          zones.wetSand + zones.drySand,
          zones.wetSand + zones.drySand + zones.scrub,
          zones.wetSand + zones.drySand + zones.scrub + zones.palmBelt,
        ),
      },
      uRockSlope: { value: new THREE.Vector2(Math.tan(((zones.rockSlope - 5) * Math.PI) / 180), Math.tan(((zones.rockSlope + 5) * Math.PI) / 180)) },
    },
    defines: { LOD_LEVELS: lodLevels },
  });

  // Two meshes share the material: whole nodes, and quarters of nodes, drawn
  // at their parent's spacing with half the quads.
  const maxNodes = 4096;
  const nodes = new THREE.InstancedBufferAttribute(new Float32Array(4 * maxNodes), 4);
  const quarters = new THREE.InstancedBufferAttribute(new Float32Array(4 * maxNodes), 4);
  nodes.setUsage(THREE.DynamicDrawUsage);
  quarters.setUsage(THREE.DynamicDrawUsage);
  // The cove's frame turns the grid's quads into world space; with the
  // headland on the right it also mirrors them, and they would face down.
  const mirrored = side * (island.right[0] * island.forward[1] - island.right[1] * island.forward[0]) < 0;
  const meshes = [gridGeometry(settings.grid, nodes, mirrored), gridGeometry(settings.grid / 2, quarters, mirrored)].map((geometry) => {
    const mesh = new THREE.Mesh(geometry, material);
    mesh.name = 'terrain';
    mesh.frustumCulled = false; // lod.js culls node by node
    mesh.visible = false; // until the grids are in
    scene.add(mesh);
    return mesh;
  });

  let heightmap = null;
  let lod = null;
  let failed = null;
  let disposed = false;
  const textures = [];

  const ready = heightmapFor(island, seed, settings).then(
    (grids) => {
      if (disposed) return;
      heightmap = grids;
      upload(grids);
      lod = createLod({ origin: coarsest.origin, levels: lodLevels, leaf: settings.leaf, grid: settings.grid }, nodeBounds(grids));
      for (const mesh of meshes) mesh.visible = true;
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
  };

  function upload(grids) {
    const n = settings.samples;
    const height = new THREE.DataArrayTexture(grids.heightData, n, n, levels.length);
    Object.assign(height, { format: THREE.RedFormat, type: THREE.FloatType, minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter, generateMipmaps: false, needsUpdate: true });
    // Kept with the grids, so a quality change doesn't convert them again. A
    // plain loop: Uint16Array.from with a map function takes 20 times as long.
    if (!grids.infoHalf) {
      grids.infoHalf = new Uint16Array(grids.infoData.length);
      for (let i = 0; i < grids.infoHalf.length; i++) grids.infoHalf[i] = THREE.DataUtils.toHalfFloat(grids.infoData[i]);
    }
    const info = new THREE.DataArrayTexture(grids.infoHalf, n, n, levels.length);
    Object.assign(info, {
      format: THREE.RGBAFormat,
      type: THREE.HalfFloatType,
      minFilter: THREE.LinearMipmapLinearFilter,
      magFilter: THREE.LinearFilter,
      generateMipmaps: true,
      needsUpdate: true,
    });
    textures.push(height, info);
    uniforms.uTerrainHeight.value = height;
    uniforms.uTerrainInfo.value = info;
    uniforms.uTerrainReady.value = 1;
  }

  // Each frame, once the camera is where it will be: the nodes for it.
  const frustum = new THREE.Frustum();
  const viewProjection = new THREE.Matrix4();
  const box = new THREE.Box3();
  const corner = new THREE.Vector3();
  const selected = [];
  const groundRadius = config.sky.atmosphere.groundRadius * 1000;
  const stopSelecting = frame.beforeScene(() => {
    if (!lod) return;
    viewProjection.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
    frustum.setFromProjectionMatrix(viewProjection, THREE.WebGLCoordinateSystem, camera.reversedDepth);
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
    let whole = 0;
    let quarter = 0;
    for (const node of selected) {
      const target = node.quarter ? quarters : nodes;
      const i = node.quarter ? quarter++ : whole++;
      if (i >= maxNodes) throw new Error(`terrain: more than ${maxNodes} nodes`);
      target.setXYZW(i, node.a, node.o, node.spacing, node.level);
    }
    for (const [attribute, count] of [[nodes, whole], [quarters, quarter]]) {
      attribute.clearUpdateRanges();
      attribute.addUpdateRange(0, 4 * count);
      attribute.needsUpdate = count > 0;
    }
    meshes[0].geometry.instanceCount = whole;
    meshes[1].geometry.instanceCount = quarter;
  });

  return {
    ready,
    update() {
      if (failed) throw failed;
    },
    dispose() {
      disposed = true;
      stopSelecting();
      for (const mesh of meshes) {
        scene.remove(mesh);
        mesh.geometry.dispose();
      }
      material.dispose();
      for (const texture of textures) texture.dispose();
      uniforms.uTerrainHeight.value = null;
      uniforms.uTerrainInfo.value = null;
      uniforms.uTerrainReady.value = 0;
      delete ctx.terrain;
    },
  };
}

// A grid of `quads` x `quads` quads, its vertices at whole numbers (x, 0, z),
// drawn once per node; `mirrored` winds its triangles the other way.
function gridGeometry(quads, nodes, mirrored) {
  const geometry = new THREE.InstancedBufferGeometry();
  const positions = [];
  for (let j = 0; j <= quads; j++) for (let i = 0; i <= quads; i++) positions.push(i, 0, j);
  const index = [];
  const at = (i, j) => j * (quads + 1) + i;
  for (let j = 0; j < quads; j++) {
    for (let i = 0; i < quads; i++) index.push(at(i, j), at(i, j + 1), at(i + 1, j), at(i + 1, j), at(i, j + 1), at(i + 1, j + 1));
  }
  if (mirrored) index.reverse();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setIndex(index);
  geometry.setAttribute('aNode', nodes);
  geometry.instanceCount = 0;
  return geometry;
}

// The lowest and highest ground over a square of the quadtree, from every
// grid that covers it, with a little room for the blends between them.
function nodeBounds(heightmap) {
  const { levels, samples } = heightmap;
  return (a0, o0, size) => {
    let min = Infinity;
    let max = -Infinity;
    for (const { origin, texel, heights } of levels) {
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
        }
      }
    }
    return [min - 1, max + 1];
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
// they can't run) into one array per kind, levels one after another.
function build(island, seed, settings) {
  const { samples, rowsPerTask } = settings;
  const levels = layoutLevels(settings);
  const perLevel = samples * samples;
  const heightData = new Float32Array(levels.length * perLevel);
  const infoData = new Float32Array(4 * levels.length * perLevel);
  const tasks = [];
  levels.forEach((_, level) => {
    for (let j0 = 0; j0 < samples; j0 += rowsPerTask) tasks.push({ seed, level, j0, j1: Math.min(j0 + rowsPerTask, samples) });
  });
  const store = ({ level, j0, heights, info }) => {
    heightData.set(heights, level * perLevel + j0 * samples);
    infoData.set(info, 4 * (level * perLevel + j0 * samples));
  };
  const finish = () => {
    const data = levels.map((_, k) => ({
      heights: heightData.subarray(k * perLevel, (k + 1) * perLevel),
      info: infoData.subarray(4 * k * perLevel, 4 * (k + 1) * perLevel),
    }));
    return Object.assign(createHeightmap(island, settings, data), { heightData, infoData });
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
      fillRows(island, levels[task.level], samples, task.j0, task.j1, heights, info);
      store({ ...task, heights, info });
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
