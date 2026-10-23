// A rock (world/rocks.js): its prototype scaled, turned and placed by its
// instance, moved by its offset to stay sunk in the terrain's mesh as drawn
// (rock-offsets.frag: the least of its block of 3 x 3), and bent down with the planet as the ground under it
// is, all of it by the drop at its place, so it keeps its shape.

#include "chunks/planet.glsl"

attribute vec4 aPlace; // world position of its base; its texel of the offsets, counted row by row
attribute vec4 aTurn; // rotation, a quaternion
attribute vec4 aScale; // and how tall it is, m

uniform highp sampler2D uRockOffsets;

centroid varying vec3 vWorldPos;
varying vec3 vNormal;
varying float vOffset;
varying float vSize;

vec3 turn(vec4 q, vec3 v) {
  return v + 2.0 * cross(q.xyz, cross(q.xyz, v) + q.w * v);
}

void main() {
  int id = int(aPlace.w + 0.5);
  int side = textureSize(uRockOffsets, 0).x / 3;
  ivec2 block = 3 * ivec2(id % side, id / side);
  float offset = 1e9;
  for (int j = 0; j < 3; j++) {
    for (int i = 0; i < 3; i++) offset = min(offset, texelFetch(uRockOffsets, block + ivec2(i, j), 0).r);
  }
  vec3 world = aPlace.xyz + turn(aTurn, position * aScale.xyz);
  world.y += offset - planetDrop(aPlace.xz);
  vWorldPos = world;
  vOffset = offset;
  vSize = aScale.w;
  vNormal = turn(aTurn, normal / aScale.xyz); // scaled unevenly, normals take the inverse
  gl_Position = projectionMatrix * viewMatrix * vec4(world, 1.0);
}
