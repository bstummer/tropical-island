// The frame's uniforms without its textures, for passes that draw into them
// (sky/atmosphere.js's tables): a pass can't read what it draws into, and
// frame.wgsl's group 0 binds them all. Filled from renderer.globals.

#include "frame-struct.wgsl"

@group(1) @binding(9) var<uniform> frame: Frame;
