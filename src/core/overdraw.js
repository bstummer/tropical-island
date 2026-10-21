// Capture only: how many fragments each pixel of the main view shades. Renders
// the scene once more with every mesh's material swapped for one that adds 1
// per fragment. The draw order and the depth test match the real frame: the
// frame's passes draw in order (`layers`, post/frame.js), three.js sorts opaque
// draws by material id, so counting materials are created in the
// originals' id order; they keep each original's sides, depth test, depth
// writes, depth function and polygon offset; and depth is 32-bit float like the
// frame's. ShaderMaterials keep their own vertex shader (waves and wind move
// geometry); other materials use the plain transform. Fragments a shader would
// discard still count: they cost the work anyway. Points, lines and sprites are
// not counted.
import * as THREE from 'three';
import vertexShader from './overdraw.vert';
import fragmentShader from './overdraw.frag';

// Returns { width, height, counts } with counts as one byte per pixel (capped
// at 255), rows from the top.
export function measureOverdraw(renderer, scene, camera, layers) {
  const size = renderer.getDrawingBufferSize(new THREE.Vector2());
  // 8-bit colour: each fragment adds exactly 1/255.
  const target = new THREE.WebGLRenderTarget(size.x, size.y, { depthTexture: new THREE.DepthTexture(size.x, size.y, THREE.FloatType) });

  const meshes = [];
  scene.traverse((object) => object.isMesh && meshes.push(object));
  const originals = [...new Set(meshes.flatMap((mesh) => [].concat(mesh.material)))].sort((a, b) => a.id - b.id);
  const counting = new Map(
    originals.map((material) => {
      const shader = material.isShaderMaterial && !material.isRawShaderMaterial;
      const copy = new THREE.ShaderMaterial({
        vertexShader: shader ? material.vertexShader : vertexShader,
        fragmentShader,
        uniforms: shader ? material.uniforms : {},
        defines: shader ? material.defines : {},
        side: material.side,
        depthTest: material.depthTest,
        depthWrite: material.depthWrite,
        depthFunc: material.depthFunc,
        polygonOffset: material.polygonOffset,
        polygonOffsetFactor: material.polygonOffsetFactor,
        polygonOffsetUnits: material.polygonOffsetUnits,
        transparent: material.transparent, // transparent draws are sorted apart
        blending: THREE.CustomBlending,
        blendSrc: THREE.OneFactor,
        blendDst: THREE.OneFactor,
      });
      return [material, copy];
    }),
  );

  const swapped = meshes.map((mesh) => [mesh, mesh.material]);
  for (const mesh of meshes) {
    mesh.material = Array.isArray(mesh.material) ? mesh.material.map((m) => counting.get(m)) : counting.get(mesh.material);
  }
  const clearColor = renderer.getClearColor(new THREE.Color());
  const clearAlpha = renderer.getClearAlpha();
  const previous = renderer.getRenderTarget();
  const autoClear = renderer.autoClear;
  const mask = camera.layers.mask;

  const pixels = new Uint8Array(size.x * size.y * 4);
  try {
    renderer.setRenderTarget(target);
    renderer.setClearColor(0x000000, 0);
    renderer.clear();
    renderer.autoClear = false;
    for (const layer of layers) {
      camera.layers.set(layer);
      renderer.render(scene, camera);
    }
    renderer.readRenderTargetPixels(target, 0, 0, size.x, size.y, pixels);
  } finally {
    for (const [object, material] of swapped) object.material = material;
    renderer.setRenderTarget(previous);
    renderer.setClearColor(clearColor, clearAlpha);
    renderer.autoClear = autoClear;
    camera.layers.mask = mask;
    for (const material of counting.values()) material.dispose();
    target.depthTexture.dispose();
    target.dispose();
  }

  const counts = new Uint8Array(size.x * size.y);
  for (let y = 0; y < size.y; y++) {
    for (let x = 0; x < size.x; x++) counts[(size.y - 1 - y) * size.x + x] = pixels[4 * (y * size.x + x)];
  }
  return { width: size.x, height: size.y, counts };
}
