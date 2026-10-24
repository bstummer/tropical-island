// Tool fixture (?fixture=broken): mistakes that only a check of every material
// catches, on meshes behind the camera, so nothing ever draws them: a shader
// that doesn't compile, a material that skips sceneOutput(), and one that
// blends outside the translucent pass (post/frame.js).
// tools/screenshot.js requires that the capture fails on all three, then breaks
// the page's GPU further (a validation error, a lost device) and requires that
// each shows. Not part of the island.
import shader from './broken.wgsl';
import { basicMaterial } from './basic.js';
import { Material, TRANSLUCENT_BLEND } from '../gpu/material.js';
import { plane } from '../gpu/geometry.js';
import { Mesh } from '../gpu/scene.js';

export function create(ctx) {
  const { scene, camera } = ctx;
  const meshes = [
    new Material({ name: 'fixture-broken', shader }),
    basicMaterial({ name: 'fixture-unwrapped', raw: true }),
    basicMaterial({ name: 'fixture-blended', transparent: true, opacity: 0.5, blend: TRANSLUCENT_BLEND }),
  ].map((material, i) => {
    const mesh = new Mesh(plane(1, 1), material);
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
