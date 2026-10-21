// What capture mode checks about the scene's materials (core/capture.js): that
// each ends with sceneOutput() and that only the translucent pass blends. Pure:
// tests/scene-check.test.js runs it on three.js objects in Node.
import { NoBlending, NormalBlending } from 'three';

// The scene's materials that don't end with sceneOutput(): ShaderMaterials
// whose fragment shader never assigns it, and built-in materials not wrapped by
// withSceneOutput (or whose hook was replaced since). As "name (type)".
export function missingSceneOutput(scene) {
  const missing = new Set();
  scene.traverse((object) => {
    if (!(object.isMesh || object.isPoints || object.isLine || object.isSprite)) return;
    for (const material of [].concat(object.material ?? [])) {
      const ok = material.isShaderMaterial ? /=\s*sceneOutput\s*\(/.test(material.fragmentShader) : material.onBeforeCompile.sceneOutput === true;
      if (!ok) missing.add(describe(material));
    }
  });
  return [...missing];
}

// What breaks the frame's passes (post/frame.js), as sentences: a material that
// blends outside the translucent pass, where it would blend in the compressed
// space and darken bright light behind it by stops; an object in the
// translucent pass that frame.translucent() didn't set up; and an object in
// none or several of the passes.
export function misplacedBlending(scene, layers) {
  const passes = Object.values(layers);
  const blending = new Set();
  const unprepared = new Set();
  const lost = new Set();
  scene.traverse((object) => {
    if (!(object.isMesh || object.isPoints || object.isLine || object.isSprite)) return;
    const inPasses = passes.filter((layer) => object.layers.isEnabled(layer));
    if (inPasses.length !== 1) lost.add(object.name || object.type);
    const translucent = object.layers.isEnabled(layers.translucent);
    for (const material of [].concat(object.material ?? [])) {
      if (translucent && !('SCENE_TRANSLUCENT' in (material.defines ?? {}))) unprepared.add(describe(material));
      if (!translucent && blends(material)) blending.add(describe(material));
    }
  });
  const problems = [];
  if (blending.size) problems.push(`materials that blend outside the translucent pass (use frame.translucent()): ${[...blending].join(', ')}`);
  if (unprepared.size) problems.push(`materials in the translucent pass not set up by frame.translucent(): ${[...unprepared].join(', ')}`);
  if (lost.size) problems.push(`objects in none or several of the frame's passes: ${[...lost].join(', ')}`);
  return problems;
}

// Whether three.js blends this material: everything but NoBlending, except
// Normal blending on a material that isn't transparent.
function blends(material) {
  return material.blending !== NoBlending && !(material.blending === NormalBlending && !material.transparent);
}

function describe(material) {
  return material.name ? `${material.name} (${material.type})` : material.type;
}
