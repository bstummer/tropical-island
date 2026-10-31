// The sea (PLAN.md Stage 6). One surface over the whole world, drawn in the
// after-opaque pass: it draws the seabed under it as far as water lets it see it
// (water-seabed.wgsl), and reads from the opaque scene what stands on that, which
// leaves the haze to it (world/terrain.wgsl, world/rocks.wgsl). Lit by the shared
// lighting. It moves with the waves (waves.js, spectrum.js), as far as each
// reaches a point (sea-map.js), and JS knows where it stands (surface.js).
//
// Puts ctx.water on the context: { ready, heightAt(x, z, t), over(x, y, z, t),
// surfAt(x, z, t), map (sea-map.js's, once ready), surface (surface.js's, once ready) }.
// heightAt is 0 and surfAt none until ready, and t defaults to the clock's. Needs the
// terrain's grids, so comes after it in WORLD_SYSTEMS; the terrain reads over() each frame.
import { Box3, Frustum, Matrix4, Vector2, Vector3, Vector4, toHalfFloatNearest } from '../maths/index.js';
import shader from './water.wgsl';
import { Material } from '../gpu/material.js';
import { Attribute } from '../gpu/geometry.js';
import { Mesh } from '../gpu/scene.js';
import { Texture } from '../gpu/texture.js';
import { gridGeometry } from '../world/terrain-nodes.js';
import { lodRanges } from '../world/lod.js';
import { buildSeaMap, seaMapLevels, waveSpeed } from './sea-map.js';
import { buildSpectrum, unresolvedSlopes } from './spectrum.js';
import { createSurface } from './surface.js';
import { createWaves } from './waves.js';
import { createMirror } from './mirror.js';
import { createSurf } from './surf.js';
import { selectSea } from './water-nodes.js';
import { twoDrifting } from './drift.js';

const MAX_NODES = 2048;
const LOD_MAX = 16; // water.wgsl's arrays hold this many levels
const SURF_WANDERS = 5; // water-surf.wgsl's uSurfWander

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

// The uniforms of sea-map.wgsl but the map and its layout, from config.water.
export function seaUniforms({ waves, map }) {
  return {
    uRipplesDepth: { value: waves.ripplesDepth },
    uChopWander: { value: new Vector2(waves.chopWander.reach, (2 * Math.PI) / waves.chopWander.across) },
    uSeaOpen: { value: new Vector2(map.open.over, map.open.reef) },
  };
}

// The uniforms of water-surf.wgsl, from config.water.surf and the way the swell runs.
export function surfUniforms({ period, height, shoals, fades, limit, dips, least, back, front, fall, ahead, run, always, wave, trail, toe, sets, beat, along, wander }, way) {
  if (wander.length !== SURF_WANDERS) throw new Error(`config.water.surf: ${wander.length} terms of the front's wander; water-surf.wgsl holds ${SURF_WANDERS}`);
  return {
    uSurfSets: { value: new Vector4(sets[0], sets[1], beat, 0) },
    uSurfAlong: { value: new Vector4(...along[0], ...along[1]) },
    uSurfWander: { value: wander.map(([m, kx, kz]) => new Vector4(m, kx, kz, 0)) },
    uSurfTiming: { value: new Vector4(period, waveSpeed(Infinity, period), height, shoals) },
    uSurfWay: { value: new Vector4(way[0], way[1], fades[0], fades[1]) },
    uSurfWave: { value: new Vector4(limit, least, back, front) },
    uSurfFoam: { value: new Vector4(fall, ahead, run, always) },
    uSurfBreak: { value: new Vector4(wave, trail, toe, dips) },
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
// grids are: the sea map, worked out as soon as the grids are in, and its texels
// at every mip level, as many as a texture its size has. A build that failed is
// forgotten, so the next quality change tries again.
const kept = new Map(); // seed -> Promise of { map, levels }

function seaMapFor(ctx, seed) {
  if (!kept.has(seed)) {
    const { config } = ctx;
    const building = ctx.terrain.grids.then((heightmap) => {
      const map = buildSeaMap(heightmap, config.water.map, config.world.island.cove.headlandSide, config.world.terrain.blend);
      return { map, levels: seaMapLevels(map, toHalfFloatNearest, Math.floor(Math.log2(map.samples)) + 1) };
    });
    kept.set(seed, building);
    building.catch(() => {
      if (kept.get(seed) === building) kept.delete(seed);
    });
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
  // The way the swell runs: in from where it comes from.
  const swellWay = direction(waveSettings.swell.from).map((v) => -v);
  const waves = createWaves(ctx, spectrum);
  const mirror = createMirror(gpu, config.sky.atmosphere.groundRadius, quality.waterMirror);
  const uMirrorCells = new Vector4(1, 1, quality.waterMirror, settings.mirror.edge);
  const uMirror = { value: null };

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
      uGustSizes: { value: new Vector2(...waveSettings.gusts.sizes) },
      uGustDrift: { value: twoDrifting(waveSettings.gusts.speed, waveSettings.gusts.sizes, direction(waveSettings.chop.blows), waveSettings.gusts.loop) },
      uGustStrength: { value: waveSettings.gusts.strength },
      uHighUp: { value: new Vector3(...waveSettings.highUp.heights, waveSettings.highUp.ripples) },
      uAureole: { value: new Vector2(config.sky.aureole.g, config.sky.aureole.strength) },
      ...surfUniforms(settings.surf, swellWay),
      uFoamAlbedo: { value: linear(settings.surf.albedo) },
      uFoamLook: { value: new Vector3(...settings.surf.lace, settings.surf.softOver) },
      uFoamDrift: { value: twoDrifting(settings.surf.drift, settings.surf.lace, swellWay, waveSettings.loop) },
      uFoamStands: { value: new Vector4(...settings.surf.stands) },
      uFoamFacing: { value: settings.surf.facing },
      uFoamBacklit: { value: new Vector2(...settings.surf.backlit) },
      uMirror,
      uMirrorCells: { value: uMirrorCells },
      uMirrorBeyond: { value: settings.mirror.beyond },
      uMirrorSteep: { value: settings.mirror.steep },
      uMirrorTaps: { value: new Vector3(...settings.mirror.taps) },
      uHorizonFade: { value: Math.sin((settings.horizonFade * Math.PI) / 180) },
      uHorizonFrom: { value: new Vector2(...settings.horizonFrom) },
      uSeconds: { value: 0 },
      uGustSeconds: { value: 0 },
      uGlintMean: ctx.terrain.surfaces.uGlintMean,
      uGlintSizes: { value: new Vector3(...settings.glints.sizes) },
      uGlintDrift: { value: settings.glints.drift.map(([x, z]) => new Vector4(x / waveSettings.loop, z / waveSettings.loop, 0, 0)) },
      uOpaque: { value: frame.opaque.color },
      uOpaqueDepth: { value: frame.opaque.depth },
      uPatches: { value: new Vector3(...waveSettings.patches.map((patch) => 1 / patch)) },
      uFineSlopes: { value: settings.fineSlopes },
      uMorph: { value: uMorph },
      uUnresolved: { value: unresolvedTable(spectrum) },
      uWaveTexels: { value: quality.waterSize },
      uSunCeiling: { value: settings.glitterCeiling },
      uFinest: { value: new Vector3(waveSettings.finest.scale, waveSettings.finest.strength, Math.log2(waveSettings.finest.scale)) },
      uCapillaries: { value: waveSettings.finest.capillaries },
      uFootBias: { value: Math.log2(quality.waterSize) },
      uSharper: { value: settings.sharper },
      uLogPatches: { value: new Vector3(...waveSettings.patches.map((patch) => -Math.log2(patch))) },
      uWaves: { value: waves.texture },
      uSeaLayout: { value: new Vector4(0, 0, 0, waveSettings.ripplesLeast) },
      ...seaUniforms(settings),
      uSeaMap: { value: null },
    },
    // The island's shade alone: the water reads no shadow maps, so the rocks' shadows fall on neither it nor the seabed it draws.
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
  let surf = null;
  let disposed = false;
  let failed = null;
  const ready = Promise.all([seaMapFor(ctx, seed), waves.compiled])
    .then(([built, problems]) => {
      if (problems.length) throw new Error(`water: ${problems.join('; ')}`);
      if (disposed) return;
      map = built.map;
      const { samples, texel, origin } = map;
      seaTexture = new Texture(gpu, { name: 'sea map', width: samples, height: samples, depth: 3, array: true, format: 'rgba16float', mips: true, data: true, sampler: { mag: 'linear', min: 'linear', mipmap: 'linear' } });
      if (built.levels.length !== seaTexture.mipLevelCount) throw new Error(`water: ${built.levels.length} levels of the sea map for a texture of ${seaTexture.mipLevelCount}`);
      built.levels.forEach((layers, level) => layers.forEach((texels, layer) => seaTexture.upload(texels, { layer, layers: 1, level })));
      material.uniforms.uSeaMap.value = seaTexture;
      material.uniforms.uSeaLayout.value.set(origin[0] - texel / 2, origin[1] - texel / 2, 1 / (samples * texel), waveSettings.ripplesLeast);
      surf = createSurf(settings.surf, swellWay);
      surface = createSurface(spectrum, map, island.toCove, waveSettings.inJs, waveSettings.ripplesLeast, waveSettings.ripplesDepth, surf, waveSettings.chopWander);
      Object.assign(ctx.water, { map, surface, seaTexture, seaLayout: material.uniforms.uSeaLayout.value });
      for (const mesh of meshes) mesh.visible = true;
    })
    // Whatever failed, the pipelines too: update() throws it, so the game shows the error.
    .catch((err) => {
      failed = err;
      throw err;
    });

  ctx.water = {
    ready,
    map: null,
    surface: null,
    heightAt: (x, z, t = ctx.clock.elapsed) => (surface ? surface.heightAt(x, z, t) : 0),
    // Whether world x, y, z stands surely over the water's surface: JS's sum, with room
    // for what it leaves out (meshSettings.over), or higher than any wave. Before ready, over
    // the still sea.
    over(x, y, z, t = ctx.clock.elapsed) {
      if (y > meshSettings.tallest) return true;
      return y > (surface ? surface.heightAt(x, z, t) + meshSettings.over : 0);
    },
    // The surf at world x, z: { foam, height, slope } (water/surf.js), for sound.
    surfAt(x, z, t = ctx.clock.elapsed) {
      if (!surf) return { foam: 0, height: 0, slope: 0 };
      const here = map.at(...island.toCove(x, z));
      return surf(here, x, z, t - spectrum.loop * Math.floor(t / spectrum.loop));
    },
    // For the fixtures: the waves', which holds the GPU's side to JS's, and sea-light's.
    waves,
    spectrum,
    material,
    swellWay,
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
      const wrapped = (loop) => ctx.clock.elapsed - loop * Math.floor(ctx.clock.elapsed / loop);
      material.uniforms.uSeconds.value = wrapped(spectrum.loop);
      material.uniforms.uGustSeconds.value = wrapped(waveSettings.gusts.loop);
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
          if (node.quarter !== quarter) continue;
          if (count >= MAX_NODES) throw new Error(`water: more than ${MAX_NODES} nodes`);
          nodes.array.set([node.x, node.z, node.spacing, node.level], 4 * count++);
        }
        geometry.instanceCount = count - geometry.firstInstance;
      }
      nodes.update(0, count);
    },
    () => waves.compiled,
  );

  const stopMirror = frame.afterOpaque(
    () => {
      mirror.project(frame.opaque.depth, camera);
      uMirror.value = mirror.cells;
      uMirrorCells.x = mirror.across;
      uMirrorCells.y = mirror.down;
      uMirrorCells.z = mirror.stride;
    },
    () => mirror.compiled,
  );

  return {
    ready,
    update() {
      if (failed) throw failed;
    },
    dispose() {
      disposed = true;
      stop();
      stopMirror();
      mirror.dispose();
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
