// Boot sequence: params -> renderer, scene, camera, frame -> systems -> loop.
// With ?capture=1, core/capture.js takes over the loop for tools/screenshot.js.
import * as THREE from 'three';
import { config } from './config.js';
import { findView } from './views.js';
import { parseParams } from './core/params.js';
import { createClock } from './core/clock.js';
import { createRandom } from './core/random.js';
import { createRenderer } from './core/renderer.js';
import { applyView } from './core/camera.js';
import { runCapture } from './core/capture.js';
import { createFrame } from './post/frame.js';
import * as input from './core/input.js';
import * as readout from './core/readout.js';
import * as benchmark from './core/benchmark.js';
import { defineTimeOfDay } from './sky/sun.js';
import * as timeControl from './sky/time-control.js';
import * as sky from './sky/sky.js';
import * as terrain from './world/terrain.js';
import * as placeholder from './world/placeholder.js';
import * as shimmerFixture from './fixtures/shimmer.js';
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

// Updated in this order every frame. Each module exports create(ctx) -> { update(dt, t), dispose(), ready? }
// where the optional `ready` promise is awaited before a capture starts.
const WORLD_SYSTEMS = [sky, terrain, placeholder];

// Test scenes that replace the world with ?fixture=<name>: tools/screenshot.js
// uses them to prove its measurements and the frame's guarantees, the tonecard
// shows the tonemapping, and light the lighting.
const FIXTURES = {
  shimmer: [shimmerFixture],
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
};

let captureMode = false;

window.addEventListener('error', (e) => captureFail(e.error ?? e.message));
window.addEventListener('unhandledrejection', (e) => captureFail(e.reason));

try {
  boot();
} catch (err) {
  fail(err);
}

function boot() {
  const params = parseParams(window.location.search);
  captureMode = params.capture;

  const quality = preset(params.quality ?? config.quality.default);
  const view = findView(params.view ?? config.defaults.view);

  const canvas = document.getElementById('view');
  const display = createRenderer({ canvas, quality, capture: params.capture, fallbackDepth: params.depth === 'fallback' });
  const { renderer } = display;
  // Restoring a lost context comes later (PLAN.md Stage 18). Until then, stop
  // and say so: a capture must not pass on the blank frames that follow.
  canvas.addEventListener('webglcontextlost', () => {
    renderer.setAnimationLoop(null);
    fail(new Error('The WebGL context was lost (the GPU was reset or ran out of memory).'), 'Stopped.');
  });

  const scene = new THREE.Scene();
  const near = renderer.capabilities.reversedDepthBuffer ? config.camera.near : config.camera.nearFallback;
  const camera = new THREE.PerspectiveCamera(view.fov ?? config.camera.fov, 1, near, config.camera.far);
  applyView(camera, view);
  display.onResize(({ width, height }) => {
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
  });

  const ctx = {
    renderer,
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
  function build() {
    ctx.frame = createFrame(ctx, display);
    world = worldSystems(params.fixture).map((system) => system.create(ctx));
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
    if (params.bench) tools.push(benchmark.create(ctx, Promise.all(world.map((system) => system.ready))));
    else tools.push(input.create(ctx));
    tools.push(readout.create(ctx));
    if (import.meta.env.DEV) tools.push(timeControl.create(ctx));
  }

  function frame() {
    ctx.stats.beginFrame();
    ctx.clock.tick();
    for (const system of tools) system.update(ctx.clock.dt, ctx.clock.elapsed);
    for (const system of world) system.update(ctx.clock.dt, ctx.clock.elapsed);
    ctx.frame.render();
    ctx.stats.endFrame();
  }

  if (import.meta.env.DEV) installShaderHotSwap(() => [scene, ctx.frame.outputScene]);

  if (params.capture) {
    runCapture(ctx, display, app, frame).catch(fail);
  } else {
    // three.js schedules the next frame before running this one, so an error
    // would otherwise repeat every frame behind a frozen image.
    renderer.setAnimationLoop(() => {
      try {
        frame();
      } catch (err) {
        renderer.setAnimationLoop(null);
        fail(err, 'Stopped.');
      }
    });
  }
}

function preset(name) {
  const quality = config.quality.presets[name];
  if (!quality) throw new Error(`Unknown quality "${name}". Presets: ${Object.keys(config.quality.presets).join(', ')}`);
  return quality;
}

function worldSystems(fixture) {
  if (!fixture) return WORLD_SYSTEMS;
  if (!FIXTURES[fixture]) throw new Error(`Unknown fixture "${fixture}". Fixtures: ${Object.keys(FIXTURES).join(', ')}`);
  return FIXTURES[fixture];
}

function captureFail(err) {
  if (!captureMode || window.__CAPTURE_ERROR__) return;
  window.__CAPTURE_ERROR__ = String(err?.message ?? err);
}

function fail(err, title = 'Could not start.') {
  console.error(err);
  captureMode = captureMode || new URLSearchParams(window.location.search).get('capture') === '1';
  if (captureMode) {
    captureFail(err);
    return;
  }
  if (document.pointerLockElement) document.exitPointerLock(); // free the cursor to read the error
  const box = document.getElementById('error');
  box.textContent = `${title}\n\n${err?.message ?? err}`;
  box.hidden = false;
}

// Dev only: when a .glsl/.vert/.frag module hot-updates (see vite.config.js),
// swap the source into every material that uses it. Falls back to a reload
// when the shader isn't found on a material in the scenes.
function installShaderHotSwap(scenes) {
  window.addEventListener('shader-hot-swap', ({ detail: { prev, next } }) => {
    let swapped = 0;
    for (const scene of scenes()) {
      scene.traverse((obj) => {
        for (const material of [].concat(obj.material ?? [])) {
          for (const key of ['vertexShader', 'fragmentShader']) {
            if (material[key] === prev) {
              material[key] = next;
              material.needsUpdate = true;
              swapped++;
            }
          }
        }
      });
    }
    if (swapped) console.info(`[hmr] shader updated in ${swapped} material(s)`);
    else window.location.reload();
  });
}
