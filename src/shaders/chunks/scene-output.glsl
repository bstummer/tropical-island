// The end of every scene material's fragment shader:
//
//   gl_FragColor = sceneOutput(radiance, alpha);
//
// `radiance` is linear HDR colour. sceneOutput applies the frame's exposure and
// compresses the result into [0, 1) with c / (1 + max(c)). MSAA then averages
// each pixel's samples in this compressed space, which is close to how they
// look after tonemapping: a thin dark frond against a bright sky keeps its
// anti-aliased edge instead of being eaten by the sky's huge values.
// post/output.frag undoes the compression. Materials get uExposure from
// ctx.frame.uniforms; built-in three.js materials use post/scene-output.js.

uniform float uExposure;

vec4 sceneOutput(vec3 radiance, float alpha) {
  vec3 c = max(radiance * uExposure, 0.0);
  return vec4(c / (1.0 + max(c.r, max(c.g, c.b))), alpha);
}
