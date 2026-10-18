// Boot sequence: params -> renderer, scene, camera -> systems -> loop.
// With ?capture=1 it instead renders a fixed number of frames at a frozen time
// and signals tools/screenshot.js through window.__CAPTURE_READY__ / __CAPTURE_ERROR__.
import * as THREE from 'three';
import { config } from './config.js';
import { findView } from './views.js';
import { parseParams } from './core/params.js';
import { createClock } from './core/clock.js';
import { createRandom } from './core/random.js';
import { createRenderer } from './core/renderer.js';
import * as input from './core/input.js';
import * as placeholder from './world/placeholder.js';

// Updated in this order every frame. Each module exports create(ctx) -> { update(dt, t), dispose(), ready? }
// where the optional `ready` promise is awaited before a capture starts.
const WORLD_SYSTEMS = [placeholder];

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

  const quality = config.quality.presets[params.quality ?? config.quality.default];
  if (!quality) {
    const names = Object.keys(config.quality.presets).join(', ');
    throw new Error(`Unknown quality "${params.quality}". Presets: ${names}`);
  }
  const view = findView(params.view ?? config.defaults.view);

  const canvas = document.getElementById('view');
  const display = createRenderer({ canvas, quality, capture: params.capture });
  const { renderer } = display;

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(view.fov ?? config.camera.fov, 1, config.camera.near, config.camera.far);
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
    timeOfDay: params.time ?? view.timeOfDay ?? config.defaults.timeOfDay,
    clock: createClock({ frozen: params.capture, start: params.t ?? config.defaults.t }),
    rng: createRandom(params.seed ?? config.defaults.seed),
  };

  const systems = [];
  if (!params.capture) systems.push(input.create(ctx));
  for (const system of WORLD_SYSTEMS) systems.push(system.create(ctx));

  function frame() {
    ctx.clock.tick();
    for (const system of systems) system.update(ctx.clock.dt, ctx.clock.elapsed);
    renderer.render(scene, camera);
  }

  if (import.meta.env.DEV) installShaderHotSwap(scene);

  if (params.capture) {
    runCapture(ctx, display, systems, frame).catch(fail);
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

async function runCapture(ctx, display, systems, frame) {
  const { renderer, scene, camera, config } = ctx;
  await Promise.all(systems.map((s) => s.ready)); // optional async setup per system
  renderer.compile(scene, camera);
  for (let i = 0; i < config.capture.warmupFrames; i++) {
    await nextFrame();
    frame();
  }
  const broken = (renderer.info.programs ?? []).filter((p) => p.diagnostics && !p.diagnostics.runnable);
  if (broken.length) {
    throw new Error(`Shader compile failed: ${broken.map((p) => p.name).join(', ')}`);
  }
  await nextFrame(); // let the final frame reach the screen
  window.__CAPTURE_INFO__ = {
    backend: display.backend(),
    view: ctx.view.name,
    timeOfDay: ctx.timeOfDay,
    t: ctx.clock.elapsed,
    seed: ctx.params.seed ?? config.defaults.seed,
    size: [display.size.width, display.size.height],
    pixelRatio: display.size.pixelRatio,
  };
  window.__CAPTURE_READY__ = true;
}

function applyView(camera, view) {
  camera.position.fromArray(view.position);
  camera.rotation.set(THREE.MathUtils.degToRad(view.pitch), THREE.MathUtils.degToRad(view.yaw), 0, 'YXZ');
  camera.updateMatrixWorld();
}

function nextFrame() {
  return new Promise((resolve) => requestAnimationFrame(resolve));
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
// when the shader isn't found on a material in the scene.
function installShaderHotSwap(scene) {
  window.addEventListener('shader-hot-swap', ({ detail: { prev, next } }) => {
    let swapped = 0;
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
    if (swapped) console.info(`[hmr] shader updated in ${swapped} material(s)`);
    else window.location.reload();
  });
}
