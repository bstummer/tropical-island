// TEMPORARY placeholder world. It exists only to prove the pipeline (build,
// shader #includes, seeded rng, frozen clock, screenshots). Replace it piece
// by piece with the real water/ and world/ systems, then delete it along
// with placeholder-*.vert/.frag. Its mound and water use the shared lighting
// (chunks/lighting.glsl), so the light can be judged on them meanwhile.
import * as THREE from 'three';
import groundVert from './placeholder-ground.vert';
import groundFrag from './placeholder-ground.frag';
import waterVert from './placeholder-water.vert';
import waterFrag from './placeholder-water.frag';

export function create(ctx) {
  const { scene, camera, rng, frame } = ctx;
  const group = new THREE.Group();
  group.name = 'placeholder';
  scene.add(group);

  const height = moundHeight(rng('placeholder/mound'));

  // Sand-coloured mound; the shoreline sits at a radius of roughly 90 m.
  const moundGeo = new THREE.PlaneGeometry(400, 400, 200, 200);
  moundGeo.rotateX(-Math.PI / 2);
  const pos = moundGeo.attributes.position;
  for (let i = 0; i < pos.count; i++) pos.setY(i, height(pos.getX(i), pos.getZ(i)));
  moundGeo.computeVertexNormals();
  const mound = new THREE.Mesh(
    moundGeo,
    new THREE.ShaderMaterial({
      name: 'placeholder-ground',
      vertexShader: groundVert,
      fragmentShader: groundFrag,
      uniforms: { ...frame.uniforms, uAlbedo: { value: new THREE.Color('#dcc596') } }, // sRGB hex, made linear
    }),
  );
  group.add(mound);

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
