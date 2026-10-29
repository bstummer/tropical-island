// The sun's shadows (PLAN.md Stage 5), which every lit material takes through
// sunVisibility() (chunks/lighting.wgsl, chunks/shadows.wgsl). Two kinds:
//
// The island's own shade (world/shade.js): where its relief hides the sun, at
// any distance, the same wherever the camera stands. It depends on the time of
// day alone, so it is worked out once per time, in bands by a pool of workers
// (world/shade-worker.js; in this thread if workers can't run), and lands with
// the sky's light (ctx.sky.follow): no frame mixes two times. It goes to the
// GPU as a texture over the coarsest grid, mipmapped, with the share of the
// ground in the sun around each point, which the light from below reads:
// under a wide shade the ground around sends up less. Without the terrain
// (a test scene), there is none.
//
// The shadow maps round the camera (sky/cascades.js), of what stands on the
// ground: a layer per cascade of one depth texture, drawn each frame from the
// sun before the scene, from meshes in pass 'shadow'. A caster adds those: a
// mesh with the same shader as its own (so its vertices land where they
// do in the view: same vertex code, same eye for the planet's bend), a
// material with `fragment: null` (or a fragment that only discards, for a
// cut-out) and instances of its own: what casts into the maps, also from out
// of view. ctx.shadows.cast(fn) has fn(shadows) called each frame before they
// draw, to pick them: shadows.holds(centre, radius) says whether a sphere can
// cast into any cascade.
//
// Puts ctx.shadows on the context: { ready, cast, covers, texelsAt, penumbra,
// from, reaches }: ready once the first island shade is in; covers(point) says
// whether a point lies in the maps as last drawn, texelsAt(point) the texels of
// the finest and the coarsest map that hold it, and penumbra a penumbra's
// half-width per metre to its caster (the shadows fixture); what casts tells
// from(spheres) where it stands, and reaches(box) says whether its shadows can
// fall there (world/terrain.js). Needs the sky (ctx.sky), and the
// terrain's grids (ctx.terrain) if it is there, so comes after both in
// WORLD_SYSTEMS, and before what casts.
import ShadeWorker from '../world/shade-worker.js?worker&inline';
import { Matrix4, Vector3 } from '../maths/index.js';
import { Texture, createTarget } from '../gpu/texture.js';
import { ABOVE_GROUND, islandShade, packShade, shadeLayout } from '../world/shade.js';
import { cascadeView, fitCascades } from './cascades.js';
import { cellsMeet, shadowCells } from './shadow-reach.js';
import { sunPath } from './sun.js';

const DEG = Math.PI / 180;
const MAX_CASCADES = 4; // chunks/frame-struct.wgsl's uShadowCascades
// m round a caster's shadow that the ground still reads the maps in: its
// penumbra, the maps' filter and their reads off a surface (sky/shadow-reach.js).
const REACH_MARGIN = 2;

export function create(ctx) {
  const shade = ctx.terrain ? islandShadeOf(ctx) : { ready: Promise.resolve(), update() {}, dispose() {} };
  const maps = shadowMaps(ctx);
  ctx.shadows.ready = shade.ready;
  return {
    ready: shade.ready,
    update() {
      shade.update();
    },
    dispose() {
      maps.dispose();
      shade.dispose();
    },
  };
}

// ---------------------------------------------------------------- the island's shade

function islandShadeOf(ctx) {
  const { frame, config, quality, gpu } = ctx;
  const { island } = ctx.terrain;
  const uniforms = frame.uniforms;
  const radius = config.sky.atmosphere.sunRadius * DEG * config.shadows.softness;
  const texel = quality.shadeTexel;
  const { mips, bounceReach } = config.world.terrain; // the light from below reads the shade over bounceReach
  const { maxWorkers, stripsPerTask } = config.shadows.island;

  let layout = null; // the shade's grid (world/shade.js shadeLayout), once the terrain's grids are in
  let nextJob = 0;
  let applied = -1; // the job whose shade is in the texture
  let texture = null;
  let disposed = false;

  // The workers start now, which takes a while, and get the grids when they come.
  let pool = null; // none if they won't start
  const count = Math.max(1, Math.min(maxWorkers, (navigator.hardwareConcurrency || 2) - 1));
  try {
    pool = shadePool({ count, stripsPerTask, radius, around: bounceReach });
  } catch (err) {
    // A browser that won't start workers from file://, say: here instead, slower.
    console.warn(`shadows: the shade's workers won't start (${err.message}); working the shade out here`);
  }
  const grids = ctx.terrain.grids.then((heightmap) => {
    layout = shadeLayout(heightmap.levels, texel);
    pool?.start(heightmap.levels, texel);
    return heightmap;
  });

  // The shade for the sun in world `direction`: a promise of { id, texels }.
  function shade(direction) {
    return grids.then((heightmap) => {
      const [a, o] = island.toCove(direction[0], direction[2]);
      const cove = [a, direction[1], o];
      const id = nextJob++;
      if (!pool) return { id, texels: packShade(islandShade(heightmap.levels, cove, { texel, radius, around: bounceReach })) };
      return pool.run(cove).then((texels) => ({ id, texels }));
    });
  }

  // Into the texture, unless a later one is in already.
  function apply({ id, texels }) {
    if (disposed || id < applied) return;
    applied = id;
    const { origin, samples: n } = layout;
    texture ??= new Texture(gpu, {
      name: 'island shade',
      width: n,
      height: n,
      format: 'rgba16float',
      mips,
      data: true,
      sampler: { mag: 'linear', min: 'linear', mipmap: 'linear' },
    });
    texture.upload(texels).generateMipmaps();
    uniforms.uShade.value = texture;
    // Texel centres on the samples, as the terrain's grids (world/terrain.js).
    uniforms.uShadeLayout.value.set(origin[0] - texel / 2, origin[1] - texel / 2, 1 / (n * texel), 1 / texel);
    uniforms.uShadeParams.value.set(1 / radius, 1 / ABOVE_GROUND, 0, 0);
  }

  const ready = shade(sunPath.position(ctx.timeOfDay).direction).then(apply);
  const stopFollowing = ctx.sky.follow((time, sun) => shade(sun.direction).then((done) => () => apply(done)));

  return {
    ready,
    update() {
      if (pool?.failed) throw pool.failed;
    },
    dispose() {
      disposed = true;
      stopFollowing();
      pool?.dispose(); // what it had on its way never lands
      texture?.destroy();
      uniforms.uShade.value = null;
      uniforms.uShadeLayout.value.set(0, 0, 0, 0);
      uniforms.uShadeParams.value.set(0, 0, 0, 0);
    },
  };
}

// The workers that work the shade out (world/shade-worker.js): a lead that
// hands out its bands and puts them together, and `count` others that work
// them out, over channels of their own to the lead. start(levels, texel)
// hands the lead the heightmap's levels, for a grid `texel` metres apart;
// then run(direction) is a promise of the shade's texels. `failed`: the error
// once a worker failed.
function shadePool({ count, stripsPerTask, radius, around }) {
  const all = [];
  try {
    for (let i = 0; i <= count; i++) all.push(new ShadeWorker());
  } catch (err) {
    for (const worker of all) worker.terminate();
    throw err;
  }
  const [lead, ...others] = all;
  const ports = others.map((worker) => {
    const { port1, port2 } = new MessageChannel();
    worker.postMessage({ port: port1 }, [port1]);
    return port2;
  });
  const jobs = new Map(); // id -> { resolve, reject }
  let nextId = 0;
  lead.onmessage = ({ data }) => {
    jobs.get(data.id)?.resolve(data.texels);
    jobs.delete(data.id);
  };
  const pool = {
    failed: null,
    start(levels, texel) {
      const sent = levels.map(({ origin, texel: t, samples, heights }) => ({ origin, texel: t, samples, heights }));
      lead.postMessage({ levels: sent, texel, ports }, ports);
    },
    run(direction) {
      if (pool.failed) return Promise.reject(pool.failed);
      const id = nextId++;
      lead.postMessage({ id, direction, radius, around, size: stripsPerTask });
      return new Promise((resolve, reject) => jobs.set(id, { resolve, reject }));
    },
    dispose() {
      for (const worker of all) worker.terminate();
      jobs.clear();
    },
  };
  for (const worker of all) {
    worker.onerror = worker.onmessageerror = (e) => {
      pool.failed = new Error(`the island's shade workers failed (${e.message || e.type})`);
      for (const job of jobs.values()) job.reject(pool.failed);
      jobs.clear();
    };
  }
  return pool;
}

// ---------------------------------------------------------------- the shadow maps

function shadowMaps(ctx) {
  const { frame, config, quality, camera, renderer, scene } = ctx;
  const uniforms = frame.uniforms;
  const { size, splits } = quality.shadowMaps;
  const { reach, fade, softness } = config.shadows;
  const penumbra = Math.tan(config.sky.atmosphere.sunRadius * DEG * softness); // a penumbra's half-width per metre to its caster
  const count = splits.length;
  if (count > MAX_CASCADES) throw new Error(`shadows: ${count} cascades; chunks/frame-struct.wgsl holds ${MAX_CASCADES}`);
  const target = createTarget(renderer.gpu, {
    name: 'shadow maps',
    width: size,
    height: size,
    format: null,
    depth: true,
    layers: count,
    array: true,
    // Bilinear, for comparisons between texels (chunks/shadows.wgsl).
    depthSampler: { mag: 'linear', min: 'linear' },
  });
  const casters = new Set();
  // What the renderer reads of a camera: one per cascade, from the sun.
  const lights = Array.from({ length: count }, () => ({ projectionMatrix: new Matrix4(), matrixWorldInverse: new Matrix4(), matrixWorld: new Matrix4() }));
  const eye = new Vector3();
  const forward = new Vector3();
  let fitted = null;

  // Whether a sphere (centre [x, y, z], radius) can cast into a cascade:
  // inside its box across, and between its far end and its eye along the sun.
  function holds(centre, radius) {
    if (!fitted) return false;
    const { right, up, toward } = fitted.frame;
    const q = [0, 1, 2].map((i) => centre[0] * [right, up, toward][i][0] + centre[1] * [right, up, toward][i][1] + centre[2] * [right, up, toward][i][2]);
    return fitted.cascades.some(({ centre: c, radius: r }) => Math.abs(q[0] - c[0]) <= r + radius && Math.abs(q[1] - c[1]) <= r + radius && q[2] >= c[2] - r - radius && q[2] <= c[2] + r + reach + radius);
  }
  // Whether a point lies in a cascade's map, as chunks/shadows.wgsl picks one
  // (its box across, with room for the filter), short of where the last fades
  // out: where the maps shade in full.
  function covers(point) {
    if (!fitted) return false;
    const { right, up } = fitted.frame;
    const x = point[0] * right[0] + point[1] * right[1] + point[2] * right[2];
    const y = point[0] * up[0] + point[1] * up[1] + point[2] * up[2];
    return fitted.cascades.some(({ centre: c, radius: r }, k) => Math.max(Math.abs(x - c[0]), Math.abs(y - c[1])) < r * (k === count - 1 ? 1 - fade : 1 - 8 / size));
  }
  // The texels (m) of the finest and the coarsest cascade that hold a point,
  // as chunks/shadows.wgsl picks them: how sharp and how soft the maps can
  // shade it. null if none does.
  function texelsAt(point) {
    if (!fitted) return null;
    const { right, up } = fitted.frame;
    const x = point[0] * right[0] + point[1] * right[1] + point[2] * right[2];
    const y = point[0] * up[0] + point[1] * up[1] + point[2] * up[2];
    const holding = fitted.cascades.filter(({ centre: c, radius: r }) => Math.max(Math.abs(x - c[0]), Math.abs(y - c[1])) < r * (1 - 8 / size));
    return holding.length ? { finest: holding[0].texel, coarsest: holding.at(-1).texel } : null;
  }
  const shadows = { holds, covers };

  // What casts into the maps, as spheres round it (from(spheres): [x, y, z, r,
  // ...] in the world, until the function it returns is called), and the
  // cells of the ground their shadows can reach under the sun they were worked
  // out for (sky/shadow-reach.js): reaches(a0, o0, a1, o1), a box of the cove's
  // frame, says whether the ground there needs the maps. Without the terrain,
  // everything does.
  const sources = new Set();
  let reachCells = null;
  let reachSun = '';
  function from(spheres) {
    sources.add(spheres);
    reachCells = null;
    return () => {
      sources.delete(spheres);
      reachCells = null;
    };
  }
  function reaches(a0, o0, a1, o1) {
    if (!ctx.terrain) return true;
    const sun = uniforms.uSunDirection.value.toArray();
    if (!reachCells || String(sun) !== reachSun) {
      reachSun = String(sun);
      reachCells = new Set();
      const options = { island: ctx.terrain.island, heightAt: ctx.terrain.heightAt, margin: REACH_MARGIN, longest: 2.5 * splits.at(-1) };
      for (const spheres of sources) for (const cell of shadowCells(spheres, sun, options)) reachCells.add(cell);
    }
    return cellsMeet(reachCells, a0, o0, a1, o1);
  }

  function draw() {
    camera.updateMatrixWorld();
    eye.setFromMatrixPosition(camera.matrixWorld);
    const m = camera.matrixWorld.elements; // -z, the way it looks
    forward.set(-m[8], -m[9], -m[10]).normalize();
    const tanY = Math.tan((camera.fov * DEG) / 2) / camera.zoom;
    const sun = uniforms.uSunDirection.value;
    fitted = fitCascades({
      position: eye.toArray(),
      forward: forward.toArray(),
      spread: tanY * Math.hypot(1, camera.aspect),
      splits: [camera.near, ...splits],
      size,
      sun: sun.toArray(),
      reach,
    });
    for (const fn of casters) fn(shadows);
    const { right, up, toward } = fitted.frame;
    uniforms.uShadowFrame.value[0].set(...right, 0);
    uniforms.uShadowFrame.value[1].set(...up, 0);
    uniforms.uShadowFrame.value[2].set(...toward, 0);
    // A pass can't read what it draws into: the maps are a placeholder meanwhile.
    uniforms.uShadowMap.value = null;
    fitted.cascades.forEach((cascade, k) => {
      const light = lights[k];
      light.matrixWorldInverse.elements = cascadeView(fitted.frame, cascade);
      light.matrixWorld.copy(light.matrixWorldInverse).invert();
      light.projectionMatrix.makeOrthographic(-cascade.radius, cascade.radius, cascade.radius, -cascade.radius, 0, cascade.depth);
      renderer.render(scene, light, target, { pass: 'shadow', layer: k, clearDepth: 0, eye });
      uniforms.uShadowCascades.value[k].set(...cascade.centre, cascade.radius);
    });
    uniforms.uShadowMap.value = target.depth;
    uniforms.uShadowParams.value.set(count, reach, 1 / size, fade);
    uniforms.uShadowSoftness.value.set(penumbra, 0, 0, 0);
  }

  const stop = frame.beforeScene(draw, () => renderer.compile(scene, null, target, { pass: 'shadow' }));
  ctx.shadows = {
    cast(fn) {
      casters.add(fn);
      return () => casters.delete(fn);
    },
    covers,
    texelsAt,
    penumbra,
    from,
    reaches,
  };

  return {
    dispose() {
      stop();
      casters.clear();
      sources.clear();
      delete ctx.shadows;
      target.dispose();
      uniforms.uShadowMap.value = null;
      uniforms.uShadowParams.value.set(0, 0, 0, 0);
      uniforms.uShadowSoftness.value.set(0, 0, 0, 0);
    },
  };
}
