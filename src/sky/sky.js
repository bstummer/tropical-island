// The sky: the atmosphere and the sun's disk, drawn behind everything, and the
// light state every lit material reads (ctx.frame.uniforms, see
// chunks/lighting.glsl). When the time changes it renders the light probe and
// sets the sun, the sky's light and the exposure from it (light.js), and
// renders the sunlight by height; when the time or the camera's height changes
// it renders the sky-view and aerial-perspective tables again (atmosphere.js).
// They depend on nothing else, so a time set at runtime renders as it would set
// at boot, and a quality change brings back the same light.
import * as THREE from 'three';
import vertexShader from './sky.vert';
import fragmentShader from './sky.frag';
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

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute([-1, -1, 0, 3, -1, 0, -1, 3, 0], 3));
  const material = new THREE.ShaderMaterial({
    name: 'sky',
    vertexShader,
    fragmentShader,
    uniforms: {
      ...atmosphere.uniforms,
      ...frame.uniforms,
      uSunCeiling: { value: settings.sunCeiling },
      uLimbDarkening: { value: settings.limbDarkening },
      uAureoleG: { value: settings.aureole.g },
      uAureole: { value: settings.aureole.strength },
    },
    depthWrite: false,
  });
  const mesh = new THREE.Mesh(geometry, material);
  mesh.name = 'sky';
  mesh.frustumCulled = false;
  mesh.renderOrder = frame.skyOrder;
  scene.add(mesh);

  const baseExposure = params.exposure ?? config.post.exposure;
  let time = null;
  let height = null;
  // Once now, so the first frame costs what every other does.
  follow();

  function follow() {
    const timeChanged = ctx.timeOfDay !== time;
    const h = (Math.max(0, Math.round(camera.position.y / settings.heightStep)) * settings.heightStep) / 1000;
    if (timeChanged) {
      time = ctx.timeOfDay;
      const sun = sunPath.position(time);
      atmosphere.renderTables(hazeAmount(sun.elevation, settings.haze));
      light.uSunDirection.value.fromArray(sun.direction);
      atmosphere.renderSunlight(sun.direction[1]);
      const state = lightFromProbe(atmosphere.probe(light.uSunDirection.value), sun, settings);
      light.uSunRadiance.value.fromArray(state.sunRadiance);
      state.sky.forEach((c, k) => light.uSkySH.value[k].fromArray(c));
      light.uLevelLight.value.fromArray(state.levelLight);
      light.uExposure.value = baseExposure * state.exposure;
    }
    if (timeChanged || h !== height) {
      height = h;
      atmosphere.renderView(h, light.uSunDirection.value.y);
      light.uSkyViewHeight.value = h;
    }
  }

  return {
    update: follow,
    dispose() {
      scene.remove(mesh);
      geometry.dispose();
      material.dispose();
      atmosphere.dispose();
    },
  };
}
