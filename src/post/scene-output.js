// Makes a built-in three.js material (Lambert, Standard, Basic...) end the way
// every scene material must: with sceneOutput() from chunks/scene-output.glsl.
// Custom ShaderMaterials call sceneOutput() themselves instead. An
// onBeforeCompile the material already has (wind, say) still runs first, so set
// it before wrapping: one set afterwards replaces the hook, and capture mode
// fails on a material without it (missingSceneOutput in scene-check.js).
import { Material } from 'three';
import sceneOutput from '../shaders/chunks/scene-output.glsl';

export function withSceneOutput(material, frame) {
  if (material.onBeforeCompile.sceneOutput) throw new Error(`withSceneOutput: ${describe(material)} is already wrapped`);
  const previous = material.onBeforeCompile;
  const previousKey = material.customProgramCacheKey;
  const hook = (shader, renderer) => {
    previous.call(material, shader, renderer);
    shader.uniforms.uExposure = frame.uniforms.uExposure;
    const main = shader.fragmentShader.replace(/\}\s*$/, '\tgl_FragColor = sceneOutput( gl_FragColor.rgb, gl_FragColor.a );\n}\n');
    shader.fragmentShader = `${sceneOutput}\n${main}`;
  };
  hook.sceneOutput = true;
  material.onBeforeCompile = hook;
  // three.js keys programs by onBeforeCompile's source, the same for every
  // material wrapped here: key by the previous hook instead, or by the
  // material's own key function. Asked at compile time, so it stays current.
  material.customProgramCacheKey = () =>
    `${previousKey === Material.prototype.customProgramCacheKey ? previous.toString() : previousKey.call(material)}|sceneOutput`;
  return material;
}

function describe(material) {
  return material.name ? `${material.name} (${material.type})` : material.type;
}
