// The end of every scene material's fragment shader:
//
//   gl_FragColor = sceneOutput(radiance, alpha);
//
// `radiance` is linear HDR colour. sceneOutput applies the frame's exposure and
// compresses the result into [0, 1) with c / (1 + max(c)). MSAA then averages
// each pixel's samples in this compressed space, which is close to how they
// look after tonemapping: a thin dark frond against a bright sky keeps its
// anti-aliased edge instead of being eaten by the sky's huge values.
// Materials get uExposure from ctx.frame.uniforms; built-in three.js materials
// use post/scene-output.js. Passes that read the HDR target undo the
// compression with sceneRadiance().

uniform float uExposure;

vec4 sceneOutput(vec3 radiance, float alpha) {
  vec3 c = max(radiance * uExposure, 0.0);
  return vec4(c / (1.0 + max(c.r, max(c.g, c.b))), alpha);
}

// Exposed linear radiance from a value stored by sceneOutput(). Half floats
// can't get closer to 1 than this floor allows, so it caps at about 2048.
vec3 sceneRadiance(vec3 stored) {
  return stored / max(1.0 - max(stored.r, max(stored.g, stored.b)), 1.0 / 2048.0);
}
