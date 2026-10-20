// Makes a built-in three.js material (Lambert, Standard, Basic...) end the way
// every scene material must: with sceneOutput() from chunks/scene-output.glsl.
// Custom ShaderMaterials call sceneOutput() themselves instead. An
// onBeforeCompile the material already has (wind, say) still runs first.
import sceneOutput from '../shaders/chunks/scene-output.glsl';

export function withSceneOutput(material, frame) {
  const previous = material.onBeforeCompile;
  const previousKey = material.customProgramCacheKey();
  material.onBeforeCompile = (shader, renderer) => {
    previous.call(material, shader, renderer);
    shader.uniforms.uExposure = frame.uniforms.uExposure;
    const main = shader.fragmentShader.replace(/\}\s*$/, '\tgl_FragColor = sceneOutput( gl_FragColor.rgb, gl_FragColor.a );\n}\n');
    shader.fragmentShader = `${sceneOutput}\n${main}`;
  };
  // three.js keys programs by onBeforeCompile's source, the same for every
  // material wrapped here: keep the previous hook in the key.
  material.customProgramCacheKey = () => `${previousKey}|sceneOutput`;
  return material;
}
