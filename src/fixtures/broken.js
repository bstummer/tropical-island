// Tool fixture (?fixture=broken): mistakes that only a check of every material
// catches, on meshes behind the camera, so nothing ever draws them: a shader
// that doesn't compile, a built-in material that skips sceneOutput(), and one
// that blends outside the translucent pass (post/frame.js).
// tools/screenshot.js requires that the capture fails on both, then breaks the
// page's WebGL further (a bad call, a lost context) and requires that each
// shows. Not part of the island.
import * as THREE from 'three';
import vertexShader from './gradient.vert';
import fragmentShader from './broken.frag';
import { withSceneOutput } from '../post/scene-output.js';

export function create(ctx) {
  const { scene, camera, frame } = ctx;
  const meshes = [
    new THREE.ShaderMaterial({ name: 'fixture-broken', vertexShader, fragmentShader, uniforms: { ...frame.uniforms } }),
    new THREE.MeshBasicMaterial({ name: 'fixture-unwrapped' }),
    withSceneOutput(new THREE.MeshBasicMaterial({ name: 'fixture-blended', transparent: true, opacity: 0.5 }), frame),
  ].map((material, i) => {
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), material);
    mesh.position.copy(camera.position);
    mesh.quaternion.copy(camera.quaternion);
    mesh.translateX(2 * i).translateZ(10); // behind the camera
    scene.add(mesh);
    return mesh;
  });

  return {
    update() {},
    dispose() {
      for (const mesh of meshes) {
        scene.remove(mesh);
        mesh.geometry.dispose();
        mesh.material.dispose();
      }
    },
  };
}
