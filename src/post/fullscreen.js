// A pass that runs a material over a whole render target, or the canvas: one
// triangle that covers it, in a scene of its own. The material's vertex shader
// gets `position` in clip space; post/output.vert turns it into vUv. Post
// passes and lookup tables use it.
import * as THREE from 'three';

const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1); // three.js wants one; the shaders ignore it

export function createFullscreen(material) {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute([-1, -1, 0, 3, -1, 0, -1, 3, 0], 3));
  Object.assign(material, { depthTest: false, depthWrite: false });
  const mesh = new THREE.Mesh(geometry, material);
  mesh.frustumCulled = false;
  const scene = new THREE.Scene();
  scene.add(mesh);
  return {
    scene,
    material,
    uniforms: material.uniforms,
    // Draws into target (null: the canvas), into one layer of a 3D target.
    render(renderer, target, layer = 0) {
      renderer.setRenderTarget(target, layer);
      renderer.render(scene, camera);
    },
    // Builds the shader for drawing into target: three.js builds different
    // programs for render targets and the canvas.
    compile(renderer, target) {
      renderer.setRenderTarget(target);
      renderer.compile(scene, camera);
    },
    dispose() {
      geometry.dispose();
      material.dispose();
    },
  };
}
