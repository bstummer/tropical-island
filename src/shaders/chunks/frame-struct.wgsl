// The frame's uniforms (chunks/frame.wgsl): the camera and ctx.frame.uniforms,
// as one struct. Scene materials bind it at group 0 with frame.wgsl; passes
// that draw into the frame's own tables bind it alone, with frame-values.wgsl.

struct Frame {
  projectionMatrix: mat4x4f,
  viewMatrix: mat4x4f,
  cameraPosition: vec3f,
  uExposure: f32,
  uSunDirection: vec3f, // towards the sun
  uSkyViewHeight: f32, // km: the camera's height the sky-view table is for
  uSunRadiance: vec3f, // the sun's illuminance on a surface facing it, at sea level
  uGroundRadius: f32, // km
  uSkySH: array<vec3f, 9>, // radiance as nine coefficients: the sky's (lighting.wgsl)
  uLevelLight: vec3f, // irradiance on level ground in the open: sun and sky
  uAerialRange: f32, // km
  uBounceAlbedo: vec3f, // the far sea's, for the light it sends back up where there is no ground (groundAlbedo())
  uSunlightSize: f32, // texels
  uBounceLayout: vec4f, // its corner in the cove's frame; 1 / its size in metres (0: no ground); the mip level read
  uAerialSize: vec3f, // texels
  uSunlightTop: f32, // km: the table's top; above it, the top's light
  uSkyViewSize: vec2f,
  uTerrainBlend: f32,
  uTerrainLevels: array<vec4f, 2>, // per level: origin a, o; texel; samples across
  uTerrainFrame: vec4f, // a = dot(xz, .xy), o = dot(xz, .zw)
  uTerrainReady: f32, // 0 until the grids are built: everything is deep sea
  uShadeLayout: vec4f, // the island's shade (shadows.wgsl): its corner in the cove's frame; 1 / its size in metres (0: no shade); 1 / its texel
  uShadeParams: vec4f, // x: 1 / the sun's disk's radius (radians); y: 1 / the height (m) over which what stands on the ground goes from its share to the share at its height
  uShadowFrame: array<vec4f, 3>, // the sun's shadow maps (shadows.wgsl): the sun's frame, right, up and towards it
  uShadowCascades: array<vec4f, 4>, // per cascade, its centre in the sun's frame and its radius (m)
  uShadowParams: vec4f, // how many cascades (0: none); their reach towards the sun (m); 1 / their texels across; the share of the last one over which they fade
  uShadowSoftness: vec4f, // x: the tangent of the sun's disk's radius as the maps soften it: a penumbra's half-width per metre to its caster
}
