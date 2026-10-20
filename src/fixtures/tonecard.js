// Fixture (?fixture=tonecard): an HDR test card that fills the view, for
// judging the tonemapping and grade (?tonemap=<name>) rather than the island:
// a sunset sky with a sun 300 times brighter than paper white, tropical
// colours at five exposures, a grey ramp and saturated colour ramps over 14
// stops. Not part of the island.
import * as THREE from 'three';
import vertexShader from './tonecard.vert';
import fragmentShader from './tonecard.frag';

const DISTANCE = 10; // m

export function create(ctx) {
  const { scene, camera, frame } = ctx;
  const height = 2 * DISTANCE * Math.tan(THREE.MathUtils.degToRad(camera.fov / 2));
  const card = new THREE.Mesh(
    new THREE.PlaneGeometry(height * (frame.size.width / frame.size.height), height),
    new THREE.ShaderMaterial({ name: 'fixture-tonecard', vertexShader, fragmentShader, uniforms: { ...frame.uniforms } }),
  );
  card.position.copy(camera.position);
  card.quaternion.copy(camera.quaternion);
  card.translateZ(-DISTANCE);
  scene.add(card);

  return {
    update() {},
    dispose() {
      scene.remove(card);
      card.geometry.dispose();
      card.material.dispose();
    },
  };
}
