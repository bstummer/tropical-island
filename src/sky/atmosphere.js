// The atmosphere's lookup tables, rendered on the GPU (atmosphere.glsl has the
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
import * as THREE from 'three';
import vertexShader from '../post/output.vert';
import transmittanceShader from './transmittance.frag';
import multiscatterShader from './multiscatter.frag';
import skyViewShader from './sky-view.frag';
import aerialShader from './aerial.frag';
import aerialTransmittanceShader from './aerial-transmittance.frag';
import sunlightShader from './sunlight.frag';
import probeShader from './probe.frag';
import { createFullscreen } from '../post/fullscreen.js';

const PROBE_TEXELS = 10;

// For config.sky.
export function createAtmosphere(renderer, { atmosphere: settings, tables, aerialRange, samples, sunlightTop }) {
  const target = ([width, height], type = THREE.HalfFloatType) => new THREE.WebGLRenderTarget(width, height, { type, depthBuffer: false });
  const targets = {
    transmittance: target(tables.transmittance),
    multiscatter: target(tables.multiscatter),
    skyView: target(tables.skyView),
    aerialTransmittance: target(tables.aerial.slice(1)), // the aerial table's rows and slices
    sunlight: target(tables.sunlight),
    probe: target([PROBE_TEXELS, 1], THREE.FloatType), // read back: full precision
    aerial: new THREE.WebGL3DRenderTarget(...tables.aerial, { type: THREE.HalfFloatType, depthBuffer: false }),
  };
  Object.assign(targets.aerial.texture, { minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter });

  const vec3 = (v) => new THREE.Vector3(...v);
  // Haze scatters short wavelengths a little more (its Angstrom exponent).
  const haze = (perKm) => vec3(settings.wavelengths.map((nm) => perKm * (nm / 550) ** -settings.hazeAngstrom));
  const uniforms = {
    uGroundRadius: { value: settings.groundRadius },
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
    uTransmittance: { value: targets.transmittance.texture },
    uTransmittanceSize: { value: new THREE.Vector2(...tables.transmittance) },
    uMultiscatter: { value: targets.multiscatter.texture },
    uMultiscatterSize: { value: new THREE.Vector2(...tables.multiscatter) },
    uAerialSize: { value: new THREE.Vector3(...tables.aerial) },
    uAerialRange: { value: aerialRange },
    uSunlightSize: { value: tables.sunlight[0] },
    uSunlightTop: { value: sunlightTop },
  };
  const pass = (name, fragmentShader, defines, own = {}) =>
    createFullscreen(new THREE.ShaderMaterial({ name, vertexShader, fragmentShader, defines, uniforms: { ...uniforms, ...own } }));
  const passes = {
    transmittance: pass('sky-transmittance', transmittanceShader, { STEPS: samples.transmittance }),
    multiscatter: pass('sky-multiscatter', multiscatterShader, { SQRT_DIRECTIONS: samples.multiscatter.directions, STEPS: samples.multiscatter.steps }),
    skyView: pass('sky-view', skyViewShader, { STEPS: samples.skyView }, {
      uHeight: { value: 0 },
      uSunMu: { value: 1 },
      uSize: { value: new THREE.Vector2(...tables.skyView) },
    }),
    aerial: pass('sky-aerial', aerialShader, { STEPS: samples.aerial }, { uHeight: { value: 0 }, uSunMu: { value: 1 }, uSlice: { value: 0 } }),
    aerialTransmittance: pass('sky-aerial-transmittance', aerialTransmittanceShader, { STEPS: samples.aerial }, { uHeight: { value: 0 } }),
    sunlight: pass('sky-sunlight', sunlightShader, { STEPS: samples.sunlight }, { uSunMu: { value: 1 } }),
    probe: pass('sky-probe', probeShader, { AZIMUTHS: samples.probe.azimuths, RINGS: samples.probe.rings, STEPS: samples.probe.steps }, {
      uSun: { value: new THREE.Vector3(0, 1, 0) },
    }),
  };

  const readback = new Float32Array(4 * PROBE_TEXELS);

  return {
    uniforms, // for materials that include atmosphere.glsl
    skyView: targets.skyView.texture,
    aerial: targets.aerial.texture,
    aerialTransmittance: targets.aerialTransmittance.texture,
    sunlight: targets.sunlight.texture,
    // The transmittance and multiple-scattering tables for this much haze (0 to 1).
    renderTables(haze) {
      uniforms.uHazeAmount.value = haze;
      passes.transmittance.render(renderer, targets.transmittance);
      passes.multiscatter.render(renderer, targets.multiscatter);
      renderer.setRenderTarget(null);
    },
    // The sky-view and aerial-perspective tables for a camera `height` km up and
    // the sun at zenith cosine sunMu.
    renderView(height, sunMu) {
      for (const p of [passes.skyView, passes.aerial]) {
        p.uniforms.uHeight.value = height;
        p.uniforms.uSunMu.value = sunMu;
      }
      passes.aerialTransmittance.uniforms.uHeight.value = height;
      passes.skyView.render(renderer, targets.skyView);
      passes.aerialTransmittance.render(renderer, targets.aerialTransmittance);
      for (let slice = 0; slice < tables.aerial[2]; slice++) {
        passes.aerial.uniforms.uSlice.value = slice;
        passes.aerial.render(renderer, targets.aerial, slice);
      }
      renderer.setRenderTarget(null);
    },
    // The sunlight table for the sun at zenith cosine sunMu, with the haze of
    // the last renderTables().
    renderSunlight(sunMu) {
      passes.sunlight.uniforms.uSunMu.value = sunMu;
      passes.sunlight.render(renderer, targets.sunlight);
      renderer.setRenderTarget(null);
    },
    // The probe for the sun towards `sun` (a world direction, y up), as RGBA floats per texel.
    probe(sun) {
      passes.probe.uniforms.uSun.value.copy(sun);
      passes.probe.render(renderer, targets.probe);
      renderer.readRenderTargetPixels(targets.probe, 0, 0, PROBE_TEXELS, 1, readback);
      renderer.setRenderTarget(null);
      return readback;
    },
    dispose() {
      for (const p of Object.values(passes)) p.dispose();
      for (const t of Object.values(targets)) t.dispose();
    },
  };
}
