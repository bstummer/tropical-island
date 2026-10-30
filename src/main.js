// Boot sequence: params -> renderer, scene, camera, frame -> systems -> loop.
// With ?capture=1, core/capture.js takes over the loop for tools/screenshot.js.
import { config } from './config.js';
import { findView } from './views.js';
import { lookup, parseParams } from './core/params.js';
import { createClock } from './core/clock.js';
import { createRandom } from './core/random.js';
import { createRenderer } from './core/renderer.js';
import { applyView, Camera } from './core/camera.js';
import { runCapture } from './core/capture.js';
import { createFrame } from './post/frame.js';
import { Scene } from './gpu/scene.js';
import { NeedsWebGPU } from './gpu/device.js';
import * as input from './core/input.js';
import * as readout from './core/readout.js';
import * as benchmark from './core/benchmark.js';
import { defineTimeOfDay } from './sky/sun.js';
import * as timeControl from './sky/time-control.js';
import * as sky from './sky/sky.js';
import * as shadows from './sky/shadows.js';
import * as terrain from './world/terrain.js';
import * as rocks from './world/rocks.js';
import * as water from './water/water.js';
import * as shimmerFixture from './fixtures/shimmer.js';
import * as crawlFixture from './fixtures/crawl.js';
import * as heavyFixture from './fixtures/heavy.js';
import * as silhouetteFixture from './fixtures/silhouette.js';
import * as depthFixture from './fixtures/depth.js';
import * as tonecardFixture from './fixtures/tonecard.js';
import * as leakyFixture from './fixtures/leaky.js';
import * as gradientFixture from './fixtures/gradient.js';
import * as brokenFixture from './fixtures/broken.js';
import * as staleTimeFixture from './fixtures/stale-time.js';
import * as blendFixture from './fixtures/blend.js';
import * as lightFixture from './fixtures/light.js';
import * as mathsFixture from './fixtures/maths.js';
import * as hazeFixture from './fixtures/haze.js';
import * as terrainFixture from './fixtures/terrain.js';
import * as surfacesFixture from './fixtures/surfaces.js';
import * as patchesFixture from './fixtures/patches.js';
import * as rocksFixture from './fixtures/rocks.js';
import * as greenTilesFixture from './fixtures/green-tiles.js';
import * as shadowsFixture from './fixtures/shadows.js';
import * as shadeFixture from './fixtures/shade.js';
import * as waterFixture from './fixtures/water.js';
import * as wavesFixture from './fixtures/waves.js';

// Updated in this order every frame. Each module exports create(ctx) -> { update(dt, t), dispose(), ready? }
// where the optional `ready` promise is awaited before a capture starts.
const WORLD_SYSTEMS = [sky, terrain, shadows, rocks, water];

// Test scenes that replace the world with ?fixture=<name>: tools/screenshot.js
// uses them to prove its measurements and the frame's guarantees, the tonecard
// shows the tonemapping, light the lighting and surfaces the ground's surfaces.
const FIXTURES = {
  shimmer: [shimmerFixture],
  crawl: [crawlFixture],
  heavy: [heavyFixture],
  silhouette: [silhouetteFixture],
  depth: [depthFixture],
  tonecard: [tonecardFixture],
  leaky: [leakyFixture],
  gradient: [gradientFixture],
  broken: [brokenFixture],
  'stale-time': [staleTimeFixture],
  blend: [blendFixture],
  light: [sky, lightFixture],
  maths: [mathsFixture],
  haze: [sky, hazeFixture],
  terrain: [sky, terrain, terrainFixture],
  surfaces: [sky, surfacesFixture],
  patches: [patchesFixture],
  rocks: [sky, terrain, rocks, rocksFixture],
  'green-tiles': [greenTilesFixture],
  shadows: [sky, shadows, shadowsFixture],
  shade: [sky, terrain, shadows, shadeFixture],
  water: [waterFixture],
  waves: [sky, terrain, water, wavesFixture],
};

let captureMode = false;

window.addEventListener('error', (e) => captureFail(e.error ?? e.message));
window.addEventListener('unhandledrejection', (e) => captureFail(e.reason));

boot().catch((err) => fail(err));

async function boot() {
  const params = parseParams(window.location.search);
  captureMode = params.capture;

  const quality = preset(params.quality ?? config.quality.default);
  const view = findView(params.view ?? config.defaults.view);

  const canvas = document.getElementById('view');
  // Errors on the GPU that nothing caught, and a lost device: restoring one
  // comes later (PLAN.md Stage 18). Until then, stop and say so: a capture must
  // not pass on the blank frames that follow.
  let stopped = false;
  const display = await createRenderer({
    canvas,
    quality,
    capture: params.capture,
    onError: (err) => {
      stopped = true;
      fail(err, 'Stopped.');
    },
  });
  const { renderer, gpu } = display;

  const scene = new Scene();
  const camera = new Camera(view.fov ?? config.camera.fov, 1, config.camera.near, config.camera.far);
  applyView(camera, view);
  display.onResize(({ width, height }) => {
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
  });

  const ctx = {
    gpu,
    renderer,
    canvas,
    scene,
    camera,
    config,
    quality,
    params,
    view,
    clock: createClock({ frozen: params.capture, start: params.t ?? config.defaults.t }),
    rng: createRandom(params.seed ?? config.defaults.seed),
    stats: display.stats,
  };
  // Hours of daylight; setting it to anything else throws (sky/sun.js).
  defineTimeOfDay(ctx, params.time ?? view.timeOfDay ?? config.defaults.timeOfDay);

  // Everything that depends on the quality preset: the frame and the world.
  // Changing the preset tears it all down and builds it again.
  let world = [];
  let ready = null;
  let drawing = false; // the world is in and its pipelines made: frames before would be black, or stall on compiles
  function build() {
    ctx.frame = createFrame(ctx, display);
    const built = (world = worldSystems(params.fixture).map((system) => system.create(ctx)));
    // Every pipeline is made in the background as soon as the meshes exist
    // (hidden ones too), while the world gets ready, rather than the first
    // time something draws with it, mid-walk; then whatever the systems added
    // getting ready. Capture mode checks them itself (core/capture.js).
    const { frame } = ctx;
    const compiled = frame.compile();
    ready = Promise.all(world.map((system) => system.ready)).then(async () => {
      if (params.capture || world !== built) return; // or torn down already
      const problems = [...(await compiled), ...(await frame.compile())];
      if (!problems.length) return;
      stopped = true;
      fail(new Error(`shader compile failed: ${problems.join('; ')}`), 'Stopped.');
    });
    // Frames wait for that: the sky's light arrives a few frames late (sky.js
    // reads it back from the GPU), and a pipeline not made yet would be made
    // while drawing. A system that fails throws in its update, so that opens
    // the gate too.
    drawing = false;
    const draw = () => (drawing = drawing || world === built);
    ready.then(draw, draw);
  }
  function teardown() {
    for (const system of world.reverse()) system.dispose();
    world = [];
    ctx.frame.dispose();
  }
  const app = {
    get systems() {
      return [...tools, ...world];
    },
    update,
    setQuality(name) {
      teardown();
      ctx.quality = preset(name);
      display.setQuality(ctx.quality);
      build();
    },
    teardown,
  };
  build();

  // Tools around the world: they stay through a quality change.
  const tools = [];
  if (!params.capture) {
    if (params.bench) tools.push(benchmark.create(ctx, ready));
    else tools.push(input.create(ctx));
    tools.push(readout.create(ctx));
    if (import.meta.env.DEV) tools.push(timeControl.create(ctx));
  }

  function update() {
    for (const system of tools) system.update(ctx.clock.dt, ctx.clock.elapsed);
    for (const system of world) system.update(ctx.clock.dt, ctx.clock.elapsed);
  }

  function frame() {
    ctx.stats.beginFrame();
    ctx.clock.tick();
    update();
    ctx.frame.render();
    ctx.stats.endFrame();
  }

  let resume = () => {};
  if (params.capture) {
    runCapture(ctx, display, app, frame).catch(fail);
  } else {
    // The next frame is asked for only after this one ran, so an error stops the loop.
    let next = 0;
    const loop = () => {
      next = 0;
      if (stopped) return;
      try {
        if (drawing) frame();
        next = requestAnimationFrame(loop);
      } catch (err) {
        fail(err, 'Stopped.');
      }
    };
    next = requestAnimationFrame(loop);
    // Dev: a shader fixed and swapped in after an error gets another go.
    resume = () => {
      if (next) return;
      stopped = false;
      document.getElementById('error').hidden = true;
      next = requestAnimationFrame(loop);
    };
  }

  if (import.meta.env.DEV) installShaderHotSwap(() => [...scene.meshes(undefined, [], true).map((m) => m.material), ...ctx.frame.outputMaterials], () => resume());
}

function preset(name) {
  return lookup(config.quality.presets, name, 'quality', 'Presets');
}

function worldSystems(fixture) {
  if (!fixture) return WORLD_SYSTEMS;
  return lookup(FIXTURES, fixture, 'fixture', 'Fixtures');
}

function captureFail(err) {
  if (!captureMode || window.__CAPTURE_ERROR__) return;
  window.__CAPTURE_ERROR__ = String(err?.message ?? err);
}

function fail(err, title = 'Could not start.') {
  console.error(err);
  if (err instanceof NeedsWebGPU) title = 'This browser has no WebGPU.';
  captureMode = captureMode || new URLSearchParams(window.location.search).get('capture') === '1';
  if (captureMode) {
    captureFail(err);
    return;
  }
  const box = document.getElementById('error');
  if (!box.hidden) return; // the first error is the cause, the ones after it follow ("invalid due to a previous error")
  if (document.pointerLockElement) document.exitPointerLock(); // free the cursor to read the error
  box.textContent = `${title}\n\n${err?.message ?? err}`;
  box.hidden = false;
}

// Dev only: when a .wgsl module hot-updates (see vite.config.js), swap the
// source into every material that uses it, and restart a game an error
// stopped (a typo saved a moment ago, say). Falls back to a reload when the
// shader isn't found on a material in the scene or the frame's passes.
function installShaderHotSwap(materials, resume) {
  window.addEventListener('shader-hot-swap', ({ detail: { prev, next } }) => {
    let swapped = 0;
    for (const material of new Set(materials())) {
      if (material.shader !== prev) continue;
      material.shader = next;
      material.needsUpdate = true;
      swapped++;
    }
    if (!swapped) {
      window.location.reload();
      return;
    }
    console.info(`[hmr] shader updated in ${swapped} material(s)`);
    resume();
  });
}
