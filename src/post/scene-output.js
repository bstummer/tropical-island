// Makes a built-in three.js material (Lambert, Standard, Basic...) end the way
// every scene material must: with sceneOutput() from chunks/scene-output.glsl.
// Custom ShaderMaterials call sceneOutput() themselves instead.
import sceneOutput from '../shaders/chunks/scene-output.glsl';

export function withSceneOutput(material, frame) {
  material.onBeforeCompile = (shader) => {
    shader.uniforms.uExposure = frame.uniforms.uExposure;
    const main = shader.fragmentShader.replace(/\}\s*$/, '\tgl_FragColor = sceneOutput( gl_FragColor.rgb, gl_FragColor.a );\n}\n');
    shader.fragmentShader = `${sceneOutput}\n${main}`;
  };
  return material;
}
