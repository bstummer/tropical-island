// A mesh's own transform, at bind group 2 (gpu/renderer.js fills it for each
// mesh that draws with it): what three.js gave every shader as modelMatrix,
// modelViewMatrix and normalMatrix. World systems that place their vertices in
// world space themselves (terrain, rocks) don't need it.

struct Object {
  modelMatrix: mat4x4f,
  modelViewMatrix: mat4x4f,
  normalMatrix: mat3x3f,
}

@group(2) @binding(0) var<uniform> object: Object;
