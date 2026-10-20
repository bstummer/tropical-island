// Tool fixture (?fixture=depth): two ground planes 5 cm apart, 100 m below the
// camera and out to 30 km, like sand under shallow water seen from a hilltop.
// Without enough depth precision the lower (red) one shows through the upper
// (blue) one, and the speckles change with every sub-pixel turn, so
// tools/screenshot.js requires that this scene does not shimmer. (Seen from
// eye height the planes meet the horizon too fast for precision to matter.)
// Black fog hides where the planes end, a sliver at the horizon that would
// shimmer whatever the depth does. Not part of the island.
import * as THREE from 'three';
import { withSceneOutput } from '../post/scene-output.js';

const SIZE = 60000; // m
const SEGMENTS = 128; // keeps triangles small enough to clip the same way on every GPU
const BELOW_CAMERA = 100; // m
const GAP = 0.05; // m
const FOG = [5000, 20000]; // m, where it starts and where it is complete

export function create(ctx) {
  const { scene, camera, frame } = ctx;
  scene.fog = new THREE.Fog(0x000000, ...FOG);
  const geometry = new THREE.PlaneGeometry(SIZE, SIZE, SEGMENTS, SEGMENTS).rotateX(-Math.PI / 2);
  // The lower plane draws last: the depth test passes on equal depth, so it wins
  // wherever precision runs out instead of hiding the problem.
  const planes = [
    [-BELOW_CAMERA, new THREE.Color(0.02, 0.06, 0.3), 0],
    [-BELOW_CAMERA - GAP, new THREE.Color(0.6, 0.02, 0.02), 1],
  ].map(([y, color, order]) => {
    const plane = new THREE.Mesh(geometry, withSceneOutput(new THREE.MeshBasicMaterial({ color }), frame));
    plane.position.set(camera.position.x, camera.position.y + y, camera.position.z);
    plane.renderOrder = order;
    plane.frustumCulled = false;
    scene.add(plane);
    return plane;
  });

  return {
    update() {},
    dispose() {
      scene.fog = null;
      for (const plane of planes) {
        scene.remove(plane);
        plane.material.dispose();
      }
      geometry.dispose();
    },
  };
}
