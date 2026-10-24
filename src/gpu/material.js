// A material: a WGSL module with a vertex and a fragment entry point, the
// values of its overrides and uniforms, and how it draws (depth, blending,
// culling). Plain data until the renderer first draws with it, which makes its
// pipelines and buffers (renderer.js); `needsUpdate` makes them again after a
// change to the shader, overrides or render state.
//
// Bindings, by group:
//   0  the frame's: chunks/frame.wgsl, filled from ctx.frame.uniforms and the camera
//   1  the material's own, filled from `uniforms` by name: each field of a
//      var<uniform> struct from uniforms[field].value, each texture from
//      uniforms[name].value (a Texture, or null for zeros), and a sampler
//      `<texture>Sampler` from that texture's sampler
//   2  the object's: chunks/object.wgsl, the mesh's matrices
// Overrides (WGSL `override`) take what `defines` did: booleans and numbers.

let nextId = 0;

// Premultiplied "over" for the translucent pass (post/frame.js translucent()):
// colour = src + dst x (1 - a), and alpha keeps the product of the layers'
// (1 - a), the share of the scene that shows through.
export const TRANSLUCENT_BLEND = {
  color: { srcFactor: 'one', dstFactor: 'one-minus-src-alpha', operation: 'add' },
  alpha: { srcFactor: 'zero', dstFactor: 'one-minus-src-alpha', operation: 'add' },
};

export class Material {
  constructor({
    name = 'material',
    shader,
    vertex = 'vertexMain',
    fragment = 'fragmentMain',
    uniforms = {},
    overrides = {},
    side = 'front', // 'front' (back faces culled), 'back' or 'double'
    depthTest = true,
    depthWrite = true,
    blend = null, // a GPUBlendState, or null for none
    transparent = false, // drawn after the opaque objects of its pass, back to front
    alphaToCoverage = false,
    colorWrite = true, // false: writes depth only
  }) {
    if (typeof shader !== 'string') throw new Error(`material ${name}: no shader`);
    this.id = nextId++;
    Object.assign(this, { name, shader, vertex, fragment, uniforms, overrides, side, depthTest, depthWrite, blend, transparent, alphaToCoverage, colorWrite });
    this.version = 0;
    this.gpu = null; // the renderer's
  }

  set needsUpdate(value) {
    if (value) this.version++;
  }

  dispose() {
    this.gpu?.dispose();
    this.gpu = null;
  }
}
