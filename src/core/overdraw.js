// Capture only: how many fragments each pixel of the main view shades. Renders
// the scene once more with every mesh's material swapped for one that adds 1
// per fragment, keeping its sides, depth test and depth writes, so the count
// matches the real draw order. ShaderMaterials keep their own vertex shader
// (waves and wind move geometry); other materials use the plain transform.
// Fragments a shader would discard still count: they cost the work anyway.
// Points, lines and sprites are not counted.
import * as THREE from 'three';
import vertexShader from './overdraw.vert';
import fragmentShader from './overdraw.frag';

// Returns { width, height, counts } with counts as one byte per pixel (capped
// at 255), rows from the top.
export function measureOverdraw(renderer, scene, camera) {
  const size = renderer.getDrawingBufferSize(new THREE.Vector2());
  const target = new THREE.WebGLRenderTarget(size.x, size.y); // 8-bit: each fragment adds exactly 1/255
  const counting = new Map();
  const countingFor = (material) => {
    if (!counting.has(material)) {
      const shader = material.isShaderMaterial && !material.isRawShaderMaterial;
      counting.set(
        material,
        new THREE.ShaderMaterial({
          vertexShader: shader ? material.vertexShader : vertexShader,
          fragmentShader,
          uniforms: shader ? material.uniforms : {},
          defines: shader ? material.defines : {},
          side: material.side,
          depthTest: material.depthTest,
          depthWrite: material.depthWrite,
          transparent: material.transparent, // keeps three's sort order
          blending: THREE.CustomBlending,
          blendSrc: THREE.OneFactor,
          blendDst: THREE.OneFactor,
        }),
      );
    }
    return counting.get(material);
  };

  const swapped = [];
  scene.traverse((object) => {
    if (!object.isMesh) return;
    swapped.push([object, object.material]);
    object.material = Array.isArray(object.material) ? object.material.map(countingFor) : countingFor(object.material);
  });
  const clearColor = renderer.getClearColor(new THREE.Color());
  const clearAlpha = renderer.getClearAlpha();
  const previous = renderer.getRenderTarget();

  const pixels = new Uint8Array(size.x * size.y * 4);
  try {
    renderer.setRenderTarget(target);
    renderer.setClearColor(0x000000, 0);
    renderer.clear();
    renderer.render(scene, camera);
    renderer.readRenderTargetPixels(target, 0, 0, size.x, size.y, pixels);
  } finally {
    for (const [object, material] of swapped) object.material = material;
    renderer.setRenderTarget(previous);
    renderer.setClearColor(clearColor, clearAlpha);
    for (const material of counting.values()) material.dispose();
    target.dispose();
  }

  const counts = new Uint8Array(size.x * size.y);
  for (let y = 0; y < size.y; y++) {
    for (let x = 0; x < size.x; x++) counts[(size.y - 1 - y) * size.x + x] = pixels[4 * (y * size.x + x)];
  }
  return { width: size.x, height: size.y, counts };
}
