// The sea (PLAN.md Stage 6). One surface over the whole world, drawn in the
// after-opaque pass: it draws the seabed under it as far as water lets it see it
// (water-seabed.wgsl), and reads from the opaque scene what stands on that, which
// leaves the haze to it (world/terrain.wgsl, world/rocks.wgsl). Lit by the shared
// lighting. It moves with the waves (waves.js, spectrum.js), as far as each
// reaches a point (sea-map.js), and JS knows where it stands (surface.js).
//
// Puts ctx.water on the context: { ready, heightAt(x, z, t), map (sea-map.js's,
// once ready), surface (surface.js's, once ready) }. heightAt is 0 until ready,
// and t defaults to the clock's. Needs the terrain's grids, so comes after it in
// WORLD_SYSTEMS.
import { Box3, Frustum, Matrix4, Vector2, Vector3, Vector4, toHalfFloat } from '../maths/index.js';
import shader from './water.wgsl';
import { Material } from '../gpu/material.js';
import { Attribute } from '../gpu/geometry.js';
import { Mesh } from '../gpu/scene.js';
import { Texture } from '../gpu/texture.js';
import { gridGeometry } from '../world/terrain-nodes.js';
import { lodRanges } from '../world/lod.js';
import { buildSeaMap, seaMapLayers } from './sea-map.js';
import { buildSpectrum, unresolvedSlopes } from './spectrum.js';
import { createSurface } from './surface.js';
import { createWaves } from './waves.js';
import { selectSea } from './water-nodes.js';

const MAX_NODES = 2048;
const LOD_MAX = 16; // water.wgsl's arrays hold this many levels

// The uniforms of water-optics.wgsl, from config.water.
export function opticsUniforms({ dimming, body, through, ior, seabedFade }) {
  return {
    uDimming: { value: new Vector3(...dimming) },
    uBody: { value: new Vector3(...body) },
    uThrough: { value: through },
    uIor: { value: ior },
    uSeabedFade: { value: new Vector2(...seabedFade) },
  };
}

// water.wgsl's uUnresolved: what each cascade's mip levels 0 to 7 have lost.
function unresolvedTable({ cascades }) {
  const table = [];
  for (const cascade of cascades) {
    const lost = unresolvedSlopes(cascade, 8);
    table.push(new Vector4(lost[0], lost[1], lost[2], lost[3]), new Vector4(lost[4], lost[5], lost[6], lost[7]));
  }
  return table;
}

// What depends on the seed alone, kept across quality changes as the terrain's
// grids are: the sea map, worked out as soon as the grids are in.
const kept = new Map(); // seed -> Promise of the sea map

function seaMapFor(ctx, seed) {
  if (!kept.has(seed)) {
    const { config } = ctx;
    kept.set(seed, ctx.terrain.grids.then((heightmap) => buildSeaMap(heightmap, config.water.map, config.world.island.cove.headlandSide, config.world.terrain.blend)));
  }
  return kept.get(seed);
}

export function create(ctx) {
  const { scene, camera, frame, config, quality, gpu, params } = ctx;
  const settings = config.water;
  const { mesh: meshSettings, waves: waveSettings } = settings;
  const { island } = ctx.terrain;
  const seed = String(params.seed ?? config.defaults.seed);

  // Directions as someone facing the sea has them, in the world.
  const direction = (degrees) => {
    const t = (degrees * Math.PI) / 180;
    return island.fromCove(config.world.island.cove.headlandSide * Math.sin(t), Math.cos(t));
  };
  const spectrum = buildSpectrum(waveSettings, quality.waterSize, ctx.rng('water/spectrum'), direction);
  const waves = createWaves(ctx, spectrum);

  const levels = Math.ceil(Math.log2(meshSettings.reach / meshSettings.leaf)) + 1;
  if (levels > LOD_MAX) throw new Error(`water: ${levels} levels of detail; water.wgsl holds ${LOD_MAX}`);
  const { ranges, morphs } = lodRanges(quality.waterDetail, levels, meshSettings.morph, meshSettings.leaf);
  const rootSize = meshSettings.leaf * 2 ** (levels - 1);
  const tree = { origin: [-rootSize / 2, -rootSize / 2], levels, leaf: meshSettings.leaf, grid: quality.waterGrid };

  const uMorph = Array.from({ length: LOD_MAX }, (_, i) => new Vector4(morphs[Math.min(i, levels - 1)][0], morphs[Math.min(i, levels - 1)][1], 0, 0));
  const { albedo: groundAlbedo, rock: rockSettings } = config.world.terrain;
  const linear = (rgb) => new Vector3(...rgb);
  const material = new Material({
    name: 'water',
    shader,
    uniforms: {
      ...opticsUniforms(settings),
      uSeabedSand: { value: linear(settings.seabedSand) },
      uWetSand: { value: linear(groundAlbedo.wetSand) },
      uWetRock: { value: linear(groundAlbedo.rock.map((c) => c * rockSettings.wet.dark)) },
      uCoralDark: { value: linear(settings.seabedCoral[0]) },
      uCoralLight: { value: linear(settings.seabedCoral[1]) },
      uWeed: { value: linear(settings.seabedWeed) },
      uSeabedTile: { value: new Vector3(settings.seabedTile.size, settings.seabedTile.larger, quality.surfaceTexture) },
      uSurfaceTiles: ctx.terrain.surfaces.uSurfaceTiles,
      uRisesLevel: { value: Math.log2(settings.seabedRises / settings.map.texel) },
      uRippleWander: { value: new Vector2(waveSettings.wander.reach, (2 * Math.PI) / waveSettings.wander.across) },
      uHighUp: { value: new Vector4(...waveSettings.highUp.heights, waveSettings.highUp.chop, waveSettings.highUp.ripples) },
      uOpaque: { value: frame.opaque.color },
      uOpaqueDepth: { value: frame.opaque.depth },
      uPatches: { value: new Vector3(...waveSettings.patches.map((patch) => 1 / patch)) },
      uFineSlopes: { value: settings.fineSlopes },
      uMorph: { value: uMorph },
      uUnresolved: { value: unresolvedTable(spectrum) },
      uWaveTexels: { value: quality.waterSize },
      uSunCeiling: { value: settings.glitterCeiling },
      uFinest: { value: new Vector3(waveSettings.finest.scale, waveSettings.finest.strength, Math.log2(waveSettings.finest.scale)) },
      uFootBias: { value: Math.log2(quality.waterSize) },
      uSharper: { value: settings.sharper },
      uLogPatches: { value: new Vector3(...waveSettings.patches.map((patch) => -Math.log2(patch))) },
      uWaves: { value: waves.texture },
      uSeaLayout: { value: new Vector4(0, 0, 0, waveSettings.ripplesLeast) },
      uSeaMap: { value: null },
    },
    // The island's shade alone: the rocks' shadows fall on the seabed they stand on.
    overrides: { SHADE_ONCE: true, SHADOW_MAP: false },
  });
  const nodes = new Attribute(new Float32Array(4 * MAX_NODES), 4, { instance: true });
  const meshes = [quality.waterGrid, quality.waterGrid / 2].map((quads) => {
    const mesh = new Mesh(gridGeometry(quads, nodes, false), material);
    mesh.name = 'water';
    mesh.pass = 'afterOpaque';
    mesh.frustumCulled = false; // culled node by node
    mesh.visible = false; // until the sea map is in
    scene.add(mesh);
    return mesh;
  });

  let seaTexture = null;
  let map = null;
  let surface = null;
  let disposed = false;
  let failed = null;
  const ready = Promise.all([seaMapFor(ctx, seed), waves.compiled]).then(
    ([built, problems]) => {
      if (problems.length) throw new Error(`water: ${problems.join('; ')}`);
      if (disposed) return;
      map = built;
      const { samples, texel, origin } = map;
      seaTexture = new Texture(gpu, { name: 'sea map', width: samples, height: samples, depth: 2, array: true, format: 'rgba16float', mips: true, data: true, sampler: { mag: 'linear', min: 'linear', mipmap: 'linear' } });
      const [first, second] = seaMapLayers(map, toHalfFloat);
      seaTexture.upload(first, { layer: 0, layers: 1 }).upload(second, { layer: 1, layers: 1 }).generateMipmaps();
      material.uniforms.uSeaMap.value = seaTexture;
      material.uniforms.uSeaLayout.value.set(origin[0] - texel / 2, origin[1] - texel / 2, 1 / (samples * texel), waveSettings.ripplesLeast);
      surface = createSurface(spectrum, map, island.toCove, waveSettings.inJs, waveSettings.ripplesLeast);
      Object.assign(ctx.water, { map, surface, seaTexture, seaLayout: material.uniforms.uSeaLayout.value });
      for (const mesh of meshes) mesh.visible = true;
    },
    (err) => {
      failed = err;
      throw err;
    },
  );

  ctx.water = {
    ready,
    map: null,
    surface: null,
    heightAt: (x, z, t = ctx.clock.elapsed) => (surface ? surface.heightAt(x, z, t) : 0),
    // For the waves fixture, which holds the GPU's side to JS's.
    waves,
    spectrum,
    patches: material.uniforms.uPatches.value,
  };

  // Each frame, once the camera is where it will be: the waves, and the nodes for it.
  const frustum = new Frustum();
  const viewProjection = new Matrix4();
  const box = new Box3();
  const groundRadius = config.sky.atmosphere.groundRadius * 1000;
  const selected = [];
  const here = {};
  const stop = frame.beforeScene(
    () => {
      if (!map) return;
      waves.compute(ctx.clock.elapsed);
      viewProjection.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
      frustum.setFromProjectionMatrix(viewProjection);
      const cam = [camera.position.x, camera.position.y, camera.position.z];
      const { tallest } = meshSettings;
      selectSea(
        tree,
        cam,
        ranges,
        (x, z, size) => {
          // Wholly over land, well inland of the water, it would only be hidden.
          const [a, o] = island.toCove(x + size / 2, z + size / 2);
          if (map.at(a, o, here).shore < -(size * Math.SQRT1_2 + map.texel)) return false;
          const far = Math.max((x - cam[0]) ** 2, (x + size - cam[0]) ** 2) + Math.max((z - cam[2]) ** 2, (z + size - cam[2]) ** 2);
          box.min.set(x - tallest, -tallest - far / (2 * groundRadius) - 1, z - tallest);
          box.max.set(x + size + tallest, tallest, z + size + tallest);
          return frustum.intersectsBox(box);
        },
        selected,
      );
      const [whole, quarters] = meshes.map((mesh) => mesh.geometry);
      let count = 0;
      for (const quarter of [false, true]) {
        const geometry = quarter ? quarters : whole;
        geometry.firstInstance = count;
        for (const node of selected) {
          if (node.quarter !== quarter || count >= MAX_NODES) continue;
          nodes.array.set([node.x, node.z, node.spacing, node.level], 4 * count++);
        }
        geometry.instanceCount = count - geometry.firstInstance;
      }
      nodes.update(0, count);
    },
    () => waves.compiled,
  );

  return {
    ready,
    update() {
      if (failed) throw failed;
    },
    dispose() {
      disposed = true;
      stop();
      for (const mesh of meshes) {
        scene.remove(mesh);
        mesh.geometry.dispose();
      }
      material.dispose();
      waves.dispose();
      seaTexture?.destroy();
      delete ctx.water;
    },
  };
}
