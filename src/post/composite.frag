// The composite (frame.js): the translucent layer over the scene, in linear
// light. The scene is compressed (chunks/scene-output.glsl); the layer holds
// premultiplied linear colour and, in alpha, the share of the scene that still
// shows through it. Writes linear, exposed radiance for the post chain.

#include "chunks/scene-output.glsl"

uniform sampler2D uScene;
uniform sampler2D uLayer;
uniform bool uHasLayer;

varying vec2 vUv;

void main() {
  vec3 scene = sceneRadiance(texture2D(uScene, vUv).rgb);
  vec4 layer = uHasLayer ? texture2D(uLayer, vUv) : vec4(0.0, 0.0, 0.0, 1.0);
  gl_FragColor = vec4(scene * layer.a + layer.rgb, 1.0);
}
