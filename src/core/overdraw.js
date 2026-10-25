// Capture only: how many fragments each pixel of the main view shades. Renders
// the scene once more with every mesh's material swapped for a copy of it whose
// fragment stage adds 1 per fragment. The draw order and the depth test match
// the real frame: the frame's passes draw in order, the renderer sorts opaque
// draws by material id, so counting materials are made in the originals' id
// order; they keep each original's vertex stage (waves and wind move
// geometry), overrides, sides, depth test and depth writes; and depth is
// 32-bit float like the frame's. Fragments a shader would discard still count:
// they cost the work anyway.
import { Material } from '../gpu/material.js';
import { createTarget } from '../gpu/texture.js';

const COUNT = `
@fragment
fn overdrawFragment() -> @location(0) vec4f {
  return vec4f(1.0 / 255.0);
}
`;

// Returns { width, height, counts } with counts as one byte per pixel (capped
// at 255), rows from the top.
export async function measureOverdraw({ renderer, scene, camera, frame }) {
  const { width, height } = frame.size;
  // 8-bit colour: each fragment adds exactly 1/255.
  const target = createTarget(renderer.gpu, { name: 'overdraw', width, height, format: 'rgba8unorm', depth: true });
  const meshes = scene.meshes(undefined, [], true);
  const originals = [...new Set(meshes.map((mesh) => mesh.material))].sort((a, b) => a.id - b.id);
  const counting = new Map(
    originals.map((m) => [
      m,
      new Material({
        name: `${m.name} (overdraw)`,
        shader: m.shader + COUNT,
        vertex: m.vertex,
        fragment: 'overdrawFragment',
        uniforms: m.uniforms,
        overrides: m.overrides,
        side: m.side,
        depthTest: m.depthTest,
        depthWrite: m.depthWrite,
        transparent: m.transparent, // transparent draws are sorted apart
        blend: { color: { srcFactor: 'one', dstFactor: 'one' }, alpha: { srcFactor: 'one', dstFactor: 'one' } },
      }),
    ]),
  );

  try {
    // Their pipelines are made in the background, all at once, rather than one
    // by one as the passes first draw with them.
    const problems = await renderer.compile(meshes.map((mesh) => ({ material: counting.get(mesh.material), geometry: mesh.geometry })), camera, target);
    if (problems.length) throw new Error(`overdraw: ${problems.join('; ')}`);
    const swapped = meshes.map((mesh) => [mesh, mesh.material]);
    try {
      for (const mesh of meshes) mesh.material = counting.get(mesh.material);
      frame.passes.forEach((pass, i) => renderer.render(scene, camera, target, { pass, ...(i === 0 && { clearColor: [0, 0, 0, 0], clearDepth: 0 }) }));
    } finally {
      for (const [mesh, material] of swapped) mesh.material = material;
    }
    const pixels = await target.color.read();
    const counts = new Uint8Array(width * height);
    for (let i = 0; i < counts.length; i++) counts[i] = pixels[4 * i];
    return { width, height, counts };
  } finally {
    for (const material of counting.values()) material.dispose();
    target.dispose();
  }
}
