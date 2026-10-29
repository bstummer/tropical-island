// The sky: the atmosphere and the sun's disk, drawn behind everything, and the
// light state every lit material reads (ctx.frame.uniforms, see
// chunks/lighting.wgsl). When the time changes it renders the light probe and
// sets the sun, the sky's light and the exposure from it (light.js), and
// renders the sunlight by height; when the time or the camera's height changes
// it renders the sky-view and aerial-perspective tables again (atmosphere.js).
// They depend on nothing else, so a time set at runtime renders as it would set
// at boot, and a quality change brings back the same light.
//
// The probe is read back from the GPU, which takes a few frames. Meanwhile the
// frame goes on with the light of the time before; then the new time lands
// whole between two frames, tables and light at once, so no frame mixes two
// times. ready resolves once the first light is in; settled() returns a
// promise while a time change is on its way (core/capture.js waits for it).
// Puts ctx.sky on the context, { ready, follow }: ready for what needs the
// first light; follow(fn) for what else follows the time of day and must land
// with its light (the island's shade, sky/shadows.js): from the next time
// change on, fn(time, sun) is called as it starts and returns a promise of a
// function, called as the light lands, in the same frame (follow returns a remover).
import { Mesh } from '../gpu/scene.js';
import { Geometry } from '../gpu/geometry.js';
import { Material } from '../gpu/material.js';
import shader from './sky.wgsl';
import { createAtmosphere } from './atmosphere.js';
import { hazeAmount, lightFromProbe } from './light.js';
import { sunPath } from './sun.js';

export function create(ctx) {
  const { scene, camera, renderer, frame, config, params } = ctx;
  const settings = config.sky;
  const atmosphere = createAtmosphere(renderer, settings);
  const light = frame.uniforms;
  light.uSkyView.value = atmosphere.skyView;
  light.uSkyViewSize.value.fromArray(settings.tables.skyView);
  light.uAerial.value = atmosphere.aerial;
  light.uAerialTransmittance.value = atmosphere.aerialTransmittance;
  light.uAerialSize.value.fromArray(settings.tables.aerial);
  light.uSunlight.value = atmosphere.sunlight;

  const triangle = new Geometry();
  triangle.vertexCount = 3; // made in the vertex shader
  const material = new Material({
    name: 'sky',
    shader,
    uniforms: {
      ...atmosphere.uniforms,
      // The current set of tables (atmosphere.js): its own, as the passes point the shared ones elsewhere.
      uTransmittance: { value: null },
      uMultiscatter: { value: null },
      uSunCeiling: { value: settings.sunCeiling },
      uLimbDarkening: { value: settings.limbDarkening },
      uAureoleG: { value: settings.aureole.g },
      uAureole: { value: settings.aureole.strength },
    },
    depthWrite: false,
  });
  const mesh = new Mesh(triangle, material);
  mesh.name = 'sky';
  mesh.frustumCulled = false;
  mesh.renderOrder = frame.skyOrder;
  scene.add(mesh);

  const baseExposure = params.exposure ?? config.post.exposure;
  const followers = new Set(); // ctx.sky.follow's
  let current = 0; // the set of tables the light in use came from
  let applied = { time: null, height: null, haze: 1 };
  let coming = null; // a time on its way: { time, set, sun, haze, probe: promise }
  let failed = null;
  let disposed = false;

  // Renders the probe for `time` into the spare set, from which it lands later,
  // with what the followers made for it.
  function start(time) {
    const sun = sunPath.position(time);
    const haze = hazeAmount(sun.elevation, settings.haze);
    const set = 1 - current;
    atmosphere.renderTables(set, haze);
    const next = { time, set, sun, haze };
    // A failure, in the readback, a follower or in landing it, is thrown by the next update.
    next.probe = Promise.all([atmosphere.probe(set, haze, sun.direction), ...[...followers].map((follow) => follow(time, sun))])
      .then(([probe, ...lands]) => {
        if (disposed) return;
        land(next, probe);
        for (const followerLands of lands) followerLands?.();
        coming = null;
      })
      .catch((err) => (failed = err));
    coming = next;
  }

  // The light of a time whose probe came back, all of it at once.
  function land({ time, set, sun, haze }, probe) {
    current = set;
    material.uniforms.uTransmittance.value = atmosphere.tables(set).transmittance;
    material.uniforms.uMultiscatter.value = atmosphere.tables(set).multiscatter;
    light.uSunDirection.value.fromArray(sun.direction);
    atmosphere.renderSunlight(set, haze, sun.direction[1]);
    const state = lightFromProbe(probe, sun, settings);
    light.uSunRadiance.value.fromArray(state.sunRadiance);
    state.sky.forEach((c, k) => light.uSkySH.value[k].fromArray(c));
    light.uLevelLight.value.fromArray(state.levelLight);
    light.uExposure.value = baseExposure * state.exposure;
    applied = { time, height: null, haze };
    view();
  }

  // The sky-view and aerial tables for the camera's height, when it changed
  // (by more than config.sky.heightSlack in the game).
  function view() {
    const y = camera.position.y;
    if (!params.capture && applied.height !== null && Math.abs(Math.max(0, y) - 1000 * applied.height) <= settings.heightSlack) return;
    const h = (Math.max(0, Math.round(y / settings.heightStep)) * settings.heightStep) / 1000;
    if (h === applied.height) return;
    applied.height = h;
    atmosphere.renderView(current, applied.haze, h, light.uSunDirection.value.y);
    light.uSkyViewHeight.value = h;
  }

  function follow() {
    if (failed) throw failed;
    if (!coming && ctx.timeOfDay !== applied.time) start(ctx.timeOfDay);
    if (applied.time !== null) view();
  }
  // The first light, so the first frame costs what every other does.
  start(ctx.timeOfDay);
  const ready = coming.probe.then(() => {
    if (failed) throw failed;
  });
  ctx.sky = {
    ready,
    follow(fn) {
      followers.add(fn);
      return () => followers.delete(fn);
    },
  };

  return {
    ready,
    update: follow,
    settled() {
      if (coming) return coming.probe;
      return ctx.timeOfDay !== applied.time ? Promise.resolve() : null;
    },
    dispose() {
      disposed = true;
      delete ctx.sky;
      scene.remove(mesh);
      material.dispose();
      atmosphere.dispose();
    },
  };
}
