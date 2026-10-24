// The atmosphere's lookup tables, rendered on the GPU (atmosphere.wgsl has the
// maths, after Hillaire 2020):
//   transmittance  how much light gets through from any height and angle; with the haze
//   multiscatter   light scattered twice and more; with the haze
//   skyView        the sky in every direction from one height, for one sun; on demand
//   aerial         the light the air adds between the camera and any point; on demand
//   aerialTransmittance  and the share of the point's light it lets through; on demand
//   sunlight       the sun's light by the height above the sea, for one sun; on demand
//   probe          the light at sea level for one sun, read back for light.js; on demand
// They are small and nothing here runs every frame: the sky changes only when
// the time (and with it the haze) or the camera's height does.
//
// The transmittance and multiple-scattering tables come in two sets: the
// light for a new time is read back from the GPU, which takes some frames, and
// meanwhile the frame goes on drawing with the current set (sky.js). Every
// call takes the set to use and the haze (0 to 1) to render with.
import { Vector2, Vector3 } from 'three';
import transmittanceShader from './transmittance.wgsl';
import multiscatterShader from './multiscatter.wgsl';
import skyViewShader from './sky-view.wgsl';
import aerialShader from './aerial.wgsl';
import aerialTransmittanceShader from './aerial-transmittance.wgsl';
import sunlightShader from './sunlight.wgsl';
import probeShader from './probe.wgsl';
import { Material } from '../gpu/material.js';
import { createTarget } from '../gpu/texture.js';

const PROBE_TEXELS = 10;

// For config.sky.
export function createAtmosphere(renderer, { atmosphere: settings, tables, samples }) {
  const { gpu } = renderer;
  const target = (name, [width, height], format = 'rgba16float') => createTarget(gpu, { name: `sky ${name}`, width, height, format });
  const sets = [0, 1].map(() => ({ transmittance: target('transmittance', tables.transmittance), multiscatter: target('multiscatter', tables.multiscatter) }));
  const targets = {
    skyView: target('view', tables.skyView),
    aerialTransmittance: target('aerial transmittance', tables.aerial.slice(1)), // the aerial table's rows and slices
    sunlight: target('sunlight', tables.sunlight),
    probe: target('probe', [PROBE_TEXELS, 1], 'rgba32float'), // read back: full precision
    aerial: createTarget(gpu, { name: 'sky aerial', width: tables.aerial[0], height: tables.aerial[1], layers: tables.aerial[2], dimension: '3d', format: 'rgba16float' }),
  };

  const vec3 = (v) => new Vector3(...v);
  // Haze scatters short wavelengths a little more (its Angstrom exponent).
  const haze = (perKm) => vec3(settings.wavelengths.map((nm) => perKm * (nm / 550) ** -settings.hazeAngstrom));
  const uniforms = {
    uTopRadius: { value: settings.topRadius },
    uRayleighScattering: { value: vec3(settings.rayleighScattering) },
    uRayleighHeight: { value: settings.rayleighHeight },
    uMieScattering: { value: settings.mieScattering },
    uMieExtinction: { value: settings.mieScattering + settings.mieAbsorption },
    uMieHeight: { value: settings.mieHeight },
    uHazeScattering: { value: haze(settings.hazeScattering) },
    uHazeExtinction: { value: haze(settings.hazeScattering + settings.hazeAbsorption) },
    uHazeHeight: { value: settings.hazeHeight },
    uHazeAmount: { value: 1 },
    uMieG: { value: settings.mieG },
    uHazeG: { value: settings.hazeG },
    uOzoneAbsorption: { value: vec3(settings.ozoneAbsorption) },
    uGroundAlbedo: { value: vec3(settings.groundAlbedo) },
    uSunIlluminance: { value: vec3(settings.sunIlluminance) },
    uSunRadius: { value: (settings.sunRadius * Math.PI) / 180 },
    uTransmittance: { value: null },
    uTransmittanceSize: { value: new Vector2(...tables.transmittance) },
    uMultiscatter: { value: null },
    uMultiscatterSize: { value: new Vector2(...tables.multiscatter) },
  };
  // Each pass reads the frame's numbers (chunks/frame-values.wgsl) but none of
  // its textures, and never the table it draws into.
  const pass = (name, shader, overrides, own = {}) =>
    renderer.fullscreen(new Material({ name, shader, overrides, uniforms: { ...renderer.globals, ...uniforms, ...own } }));
  const passes = {
    transmittance: pass('sky-transmittance', transmittanceShader, { STEPS: samples.transmittance }, { uTransmittance: { value: null } }),
    multiscatter: pass('sky-multiscatter', multiscatterShader, { SQRT_DIRECTIONS: samples.multiscatter.directions, STEPS: samples.multiscatter.steps }, {
      uMultiscatter: { value: null },
    }),
    skyView: pass('sky-view', skyViewShader, { STEPS: samples.skyView }, {
      uHeight: { value: 0 },
      uSunMu: { value: 1 },
      uSize: { value: new Vector2(...tables.skyView) },
    }),
    aerial: pass('sky-aerial', aerialShader, { STEPS: samples.aerial }, { uHeight: { value: 0 }, uSunMu: { value: 1 }, uSlice: { value: 0 } }),
    aerialTransmittance: pass('sky-aerial-transmittance', aerialTransmittanceShader, { STEPS: samples.aerial }, { uHeight: { value: 0 } }),
    sunlight: pass('sky-sunlight', sunlightShader, { STEPS: samples.sunlight }, { uSunMu: { value: 1 } }),
    probe: pass('sky-probe', probeShader, { AZIMUTHS: samples.probe.azimuths, RINGS: samples.probe.rings, STEPS: samples.probe.steps }, {
      uSun: { value: new Vector3(0, 1, 0) },
    }),
  };

  // Points the shared uniforms at set `k`'s tables and the haze, for the passes that follow.
  function use(k, hazeAmount) {
    uniforms.uHazeAmount.value = hazeAmount;
    uniforms.uTransmittance.value = sets[k].transmittance.color;
    uniforms.uMultiscatter.value = sets[k].multiscatter.color;
  }

  return {
    uniforms, // for materials that include atmosphere.wgsl: point uTransmittance and uMultiscatter at a set's tables()
    skyView: targets.skyView.color,
    aerial: targets.aerial.color,
    aerialTransmittance: targets.aerialTransmittance.color,
    sunlight: targets.sunlight.color,
    // Set k's transmittance and multiple-scattering tables.
    tables: (k) => ({ transmittance: sets[k].transmittance.color, multiscatter: sets[k].multiscatter.color }),
    // Set k's transmittance and multiple-scattering tables for this much haze (0 to 1).
    renderTables(k, hazeAmount) {
      use(k, hazeAmount);
      passes.transmittance.render(sets[k].transmittance);
      passes.multiscatter.render(sets[k].multiscatter);
    },
    // The sky-view and aerial-perspective tables for a camera `height` km up and
    // the sun at zenith cosine sunMu, from set k.
    renderView(k, hazeAmount, height, sunMu) {
      use(k, hazeAmount);
      for (const p of [passes.skyView, passes.aerial]) {
        p.uniforms.uHeight.value = height;
        p.uniforms.uSunMu.value = sunMu;
      }
      passes.aerialTransmittance.uniforms.uHeight.value = height;
      passes.skyView.render(targets.skyView);
      passes.aerialTransmittance.render(targets.aerialTransmittance);
      for (let slice = 0; slice < tables.aerial[2]; slice++) {
        passes.aerial.uniforms.uSlice.value = slice;
        passes.aerial.render(targets.aerial, { layer: slice });
      }
    },
    // The sunlight table for the sun at zenith cosine sunMu.
    renderSunlight(k, hazeAmount, sunMu) {
      use(k, hazeAmount);
      passes.sunlight.uniforms.uSunMu.value = sunMu;
      passes.sunlight.render(targets.sunlight);
    },
    // The probe for the sun towards `sun` ([x, y, z], a world direction, y up), from set
    // k: a promise of RGBA floats per texel.
    probe(k, hazeAmount, sun) {
      use(k, hazeAmount);
      passes.probe.uniforms.uSun.value.fromArray(sun);
      passes.probe.render(targets.probe);
      return targets.probe.color.read();
    },
    dispose() {
      for (const p of Object.values(passes)) p.dispose();
      for (const t of [...Object.values(targets), ...sets.flatMap((s) => [s.transmittance, s.multiscatter])]) t.dispose();
    },
  };
}
