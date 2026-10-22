// TEMPORARY placeholder water, until Stage 6's ocean replaces it (then delete
// it along with placeholder-water.vert/.frag). It uses the shared lighting
// (chunks/lighting.glsl), so the light can be judged on it meanwhile, and
// takes its colour from the depth of the terrain below (chunks/terrain.glsl),
// so the lagoon, the reef and the drop-off read from above.
import * as THREE from 'three';
import waterVert from './placeholder-water.vert';
import waterFrag from './placeholder-water.frag';

export function create(ctx) {
  const { scene, camera, frame } = ctx;
  const group = new THREE.Group();
  group.name = 'placeholder';
  scene.add(group);

  // Flat water plane that follows the camera; the shader works in world space.
  // Tessellated because a few huge triangles clipped at the near plane get
  // rasterised differently by different GPUs (the shoreline moved by metres).
  // It reaches 60 km, past the horizon from any view, so the sky never shows
  // below it; its vertex shader bends it down with the planet.
  const waterUniforms = {
    ...frame.uniforms,
    uTime: { value: 0 },
    uDeep: { value: new THREE.Color('#0a3f6e') }, // sRGB hex, made linear
    uShallow: { value: new THREE.Color('#2bb3bd') },
    uClear: { value: new THREE.Color('#8fe3d6') },
  };
  const water = new THREE.Mesh(
    waterGeometry(60000, 200, 8),
    new THREE.ShaderMaterial({
      name: 'placeholder-water',
      vertexShader: waterVert,
      fragmentShader: waterFrag,
      uniforms: waterUniforms,
    }),
  );
  water.frustumCulled = false;
  group.add(water);

  return {
    update(dt, t) {
      waterUniforms.uTime.value = t;
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

// A square of side 2 x extent, with cells that grow away from the centre: the
// first about extent x growth / (e^growth - 1) / segments x 2 wide.
function waterGeometry(extent, segments, growth) {
  const geometry = new THREE.PlaneGeometry(2, 2, segments, segments).rotateX(-Math.PI / 2);
  const pos = geometry.attributes.position;
  const stretch = (s) => (Math.sign(s) * extent * (Math.exp(growth * Math.abs(s)) - 1)) / (Math.exp(growth) - 1);
  for (let i = 0; i < pos.count; i++) pos.setXYZ(i, stretch(pos.getX(i)), 0, stretch(pos.getZ(i)));
  return geometry;
}
