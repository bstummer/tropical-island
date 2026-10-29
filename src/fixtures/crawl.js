// Tool fixture (?fixture=crawl): stripes that crawl only as the camera moves,
// so tools/screenshot.js can prove that its shimmer score with the camera
// moved catches what turning it can't. A wall leaning away fills the view,
// and a card stands before its right half. Their stripes are filtered, so
// they don't shimmer as the camera turns. On the left half they keep to where
// the camera stands, as the shadows of a shadow map that follows the camera
// without keeping to its texels would; on the right they keep to the world,
// depth edges and all, which must not count. Not part of the island.
import shader from './crawl.wgsl';
import { Vector3 } from '../maths/index.js';
import { Material } from '../gpu/material.js';
import { plane } from '../gpu/geometry.js';
import { Mesh } from '../gpu/scene.js';

const WALL = 14; // m in front of the start view; the wall leans away by LEAN radians and overfills the frame
const LEAN = 0.8;
const CARD = [2, 5]; // m: the card's centre to the right, and in front

export function create(ctx) {
  const { scene, camera } = ctx;
  const material = new Material({
    name: 'fixture-crawl',
    shader,
    uniforms: { uOrigin: { value: camera.position.clone() }, uRight: { value: new Vector3(1, 0, 0).applyQuaternion(camera.quaternion) } },
    side: 'double',
  });
  const place = (mesh, ahead, right = 0) => {
    mesh.position.copy(camera.position);
    mesh.quaternion.copy(camera.quaternion);
    mesh.translateZ(-ahead).translateX(right);
    scene.add(mesh);
    return mesh;
  };
  const wall = place(new Mesh(plane(160, 100, 16, 16), material), WALL);
  wall.rotateX(-LEAN);
  const card = place(new Mesh(plane(3, 4), material), CARD[1], CARD[0]);

  return {
    update() {},
    dispose() {
      for (const mesh of [wall, card]) {
        scene.remove(mesh);
        mesh.geometry.dispose();
      }
      material.dispose();
    },
  };
}
