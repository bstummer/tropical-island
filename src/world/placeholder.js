// TEMPORARY placeholder world. It exists only to prove the pipeline (build,
// shader #includes, seeded rng, frozen clock, screenshots). Replace it piece
// by piece with the real sky/, water/ and world/ systems, then delete it along
// with placeholder-*.vert/.frag.
import * as THREE from 'three';
import skyVert from './placeholder-sky.vert';
import skyFrag from './placeholder-sky.frag';
import waterVert from './placeholder-water.vert';
import waterFrag from './placeholder-water.frag';

const SKY = {
  day: { zenith: '#2a6fd0', horizon: '#b8dcf0', sun: '#fff1dc' },
  sunset: { zenith: '#3a5590', horizon: '#f2a066', sun: '#ffb070' },
  night: { zenith: '#02050d', horizon: '#0a1528', sun: '#000000' },
};

export function create(ctx) {
  const { scene, camera, rng } = ctx;
  const group = new THREE.Group();
  group.name = 'placeholder';
  scene.add(group);

  const height = moundHeight(rng('placeholder/mound'));

  // Sky dome, kept centred on the camera.
  const skyUniforms = {
    uZenith: { value: new THREE.Color() },
    uHorizon: { value: new THREE.Color() },
    uSunDir: { value: new THREE.Vector3() },
    uSunColor: { value: new THREE.Color() },
  };
  const sky = new THREE.Mesh(
    new THREE.SphereGeometry(4000, 48, 24),
    new THREE.ShaderMaterial({
      name: 'placeholder-sky',
      vertexShader: skyVert,
      fragmentShader: skyFrag,
      uniforms: skyUniforms,
      side: THREE.BackSide,
      depthWrite: false,
      dithering: true,
    }),
  );
  sky.renderOrder = -1;
  sky.frustumCulled = false;
  group.add(sky);

  // Sand-coloured mound; the shoreline sits at a radius of roughly 90 m.
  const moundGeo = new THREE.PlaneGeometry(400, 400, 200, 200);
  moundGeo.rotateX(-Math.PI / 2);
  const pos = moundGeo.attributes.position;
  for (let i = 0; i < pos.count; i++) pos.setY(i, height(pos.getX(i), pos.getZ(i)));
  moundGeo.computeVertexNormals();
  const mound = new THREE.Mesh(moundGeo, new THREE.MeshLambertMaterial({ color: '#dcc596' }));
  group.add(mound);

  // Flat water plane that follows the camera; the shader works in world space.
  // Tessellated because a few huge triangles clipped at the near plane get
  // rasterised differently by different GPUs (the shoreline moved by metres).
  const waterUniforms = {
    uTime: { value: 0 },
    uDeep: { value: new THREE.Color() },
    uShallow: { value: new THREE.Color() },
    uHorizon: skyUniforms.uHorizon,
  };
  const water = new THREE.Mesh(
    new THREE.PlaneGeometry(12000, 12000, 200, 200).rotateX(-Math.PI / 2),
    new THREE.ShaderMaterial({
      name: 'placeholder-water',
      vertexShader: waterVert,
      fragmentShader: waterFrag,
      uniforms: waterUniforms,
    }),
  );
  water.frustumCulled = false;
  group.add(water);

  const sun = new THREE.DirectionalLight();
  const ambient = new THREE.HemisphereLight();
  group.add(sun, sun.target, ambient);

  const tmp = new THREE.Color();
  const deep = new THREE.Color('#0a3f6e');
  const shallow = new THREE.Color('#2bb3bd');
  const skyColors = {
    zenith: skyUniforms.uZenith.value,
    horizon: skyUniforms.uHorizon.value,
    sun: skyUniforms.uSunColor.value,
  };

  // Sun rises in +X at 06:00, peaks at noon, sets in -X at 18:00.
  function applyTimeOfDay(hours) {
    const theta = ((hours - 6) / 12) * Math.PI;
    const sunDir = skyUniforms.uSunDir.value.set(Math.cos(theta), Math.sin(theta), 0.35 * Math.sin(theta)).normalize();
    const day = THREE.MathUtils.smoothstep(sunDir.y, -0.02, 0.35);
    const night = 1 - THREE.MathUtils.smoothstep(sunDir.y, -0.3, -0.02);

    for (const [key, color] of Object.entries(skyColors)) {
      color.set(SKY.sunset[key]).lerp(tmp.set(SKY.day[key]), day).lerp(tmp.set(SKY.night[key]), night);
    }

    const light = 0.06 + 0.94 * THREE.MathUtils.smoothstep(sunDir.y, -0.1, 0.25);
    waterUniforms.uDeep.value.copy(deep).multiplyScalar(light);
    waterUniforms.uShallow.value.copy(shallow).multiplyScalar(light);

    sun.position.copy(sunDir).multiplyScalar(100);
    sun.color.copy(skyUniforms.uSunColor.value);
    sun.intensity = 3.2 * Math.max(sunDir.y, 0) ** 0.5;
    ambient.color.copy(skyUniforms.uZenith.value);
    ambient.groundColor.set('#8a7550');
    ambient.intensity = 0.3 + 1.4 * light;
  }

  return {
    update(dt, t) {
      applyTimeOfDay(ctx.timeOfDay);
      waterUniforms.uTime.value = t;
      sky.position.copy(camera.position);
      water.position.set(camera.position.x, 0, camera.position.z);
    },
    dispose() {
      scene.remove(group);
      group.traverse((obj) => {
        obj.geometry?.dispose();
        obj.material?.dispose();
      });
    },
  };
}

// Smooth dome plus a few seeded bumps, so ?seed visibly changes the shape.
function moundHeight(r) {
  const bumps = Array.from({ length: 6 }, () => ({
    x: r.range(-45, 45),
    z: r.range(-45, 45),
    radius: r.range(12, 28),
    height: r.range(-1.5, 3),
  }));
  return (x, z) => {
    let h = 22 * Math.exp(-(x * x + z * z) / 3600) - 2;
    for (const b of bumps) {
      const dx = x - b.x;
      const dz = z - b.z;
      h += b.height * Math.exp(-(dx * dx + dz * dz) / (b.radius * b.radius));
    }
    return h;
  };
}
