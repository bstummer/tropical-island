// What every scene material shares, at bind group 0: the camera, and
// ctx.frame.uniforms (post/frame.js), which the systems fill: the exposure, the
// light state that sky/sky.js keeps in step with the time of day (lighting.wgsl),
// and the terrain's grids that world/terrain.js fills (terrain.wgsl). The
// renderer (gpu/renderer.js) packs it by field name once per pass.

#include "frame-struct.wgsl"

@group(0) @binding(0) var<uniform> frame: Frame;
@group(0) @binding(1) var uSkyView: texture_2d<f32>;
@group(0) @binding(2) var uSkyViewSampler: sampler;
@group(0) @binding(3) var uAerial: texture_3d<f32>;
@group(0) @binding(4) var uAerialSampler: sampler;
@group(0) @binding(5) var uAerialTransmittance: texture_2d<f32>;
@group(0) @binding(6) var uAerialTransmittanceSampler: sampler;
@group(0) @binding(7) var uSunlight: texture_2d<f32>; // and by the height above the sea (sunlight.wgsl)
@group(0) @binding(8) var uSunlightSampler: sampler;
@group(0) @binding(9) var uBounceMap: texture_2d<f32>; // the ground's albedo seen from above (world/albedo.js), linear
@group(0) @binding(10) var uBounceMapSampler: sampler;
// The terrain's fine grid (terrain.wgsl), and below its coarse one's, alike.
@group(0) @binding(11) var uTerrainHeight: texture_2d<f32>; // the height at each sample (r32float: read unfiltered)
@group(0) @binding(12) var uTerrainInfo: texture_2d<f32>; // slope along a and o, the ground's band, the reef's offset
@group(0) @binding(13) var uTerrainInfoSampler: sampler;
@group(0) @binding(14) var uTerrainGround: texture_2d<f32>; // how much of the ground is sand, and rock; how lush the green; how sandy the soil
@group(0) @binding(15) var uTerrainGroundSampler: sampler;
@group(0) @binding(16) var uTerrainHeightTexels: sampler; // unfiltered, for textureGather of either grid (gpu/bindings.js)
@group(0) @binding(17) var uTerrainHeightCoarse: texture_2d<f32>;
@group(0) @binding(18) var uTerrainInfoCoarse: texture_2d<f32>;
@group(0) @binding(19) var uTerrainInfoCoarseSampler: sampler;
@group(0) @binding(20) var uTerrainGroundCoarse: texture_2d<f32>;
@group(0) @binding(21) var uTerrainGroundCoarseSampler: sampler;
