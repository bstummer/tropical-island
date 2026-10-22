// All tunables live here as plain data. Keep this file free of browser APIs:
// the Node tools (tools/*.js) import it too.

// Quality presets, picked with ?quality=<name>. Systems read their own fields
// from ctx.quality, so a new system adds its per-preset knobs here.
export const quality = {
  default: 'high',
  // msaa: samples per pixel in the HDR target (post/frame.js), at least 2 (it
  // checks): the after-opaque pass reads the resolved target while it draws into the samples.
  presets: {
    low: { renderScale: 0.67, maxPixelRatio: 1, msaa: 2 },
    medium: { renderScale: 0.85, maxPixelRatio: 1.5, msaa: 4 },
    high: { renderScale: 1, maxPixelRatio: 2, msaa: 4 },
  },
};

// Depth is reversed and 32-bit float (post/frame.js), so precision is about
// the same fraction of the distance everywhere: a near plane at a leaf's
// distance costs nothing at the horizon. Without reversed depth (no
// EXT_clip_control) the near plane moves out to nearFallback instead.
export const camera = {
  fov: 70, // vertical, degrees; a view may override it
  near: 0.02,
  nearFallback: 0.5,
  far: 100000, // beyond the horizon from any hilltop
};

// The output pass (post/output.frag). `tonemap` picks one of `tonemaps`
// (?tonemap=<name> overrides it); the numbers are the shader's TONEMAP define.
export const post = {
  exposure: 1, // a factor on the exposure, which follows the light (sky/light.js); ?exposure= overrides it
  // The user's pick (PLAN.md, Decisions): keeps authored colours. agx-punchy's extra
  // saturation pushed strong cyans out of gamut (red clipped to 0, visible contours).
  tonemap: 'neutral',
  tonemaps: { neutral: 1, agx: 2, 'agx-punchy': 3, aces: 4 },
};

// The sky (sky/). The sun's path is solar geometry at an art-directed latitude
// and season (sky/sun.js): the noon sun stands 90 - |latitude - declination|
// degrees up, towards the north for a southern latitude, which is to the right
// of a viewer facing the sunset.
export const sky = {
  sun: {
    latitude: -27, // degrees: 63° at noon, high enough for a tropical noon, low enough to model shapes
    declination: 0, // degrees: equinox, so daylight runs from 6:00 to 18:00
    sunsetYaw: 165, // the view yaw (views.js) that looks into the setting sun: the beach faces it
  },
  // The sun's height in degrees at the named times (sky/sun.js). Sunrise and
  // sunset stand a degree up, so the land still catches the low sun (the user's
  // pick, PLAN.md Decisions); daylight goes on until its centre meets the horizon.
  namedElevations: { sunset: 1, goldenHour: 5 },
  // The haze thins as the sun sinks (sky/light.js hazeAmount): its share with the
  // sun on the horizon, and the sun's height (degrees) from which it is all there.
  haze: { low: 0.3, fullAbove: 25 },
  // The sun's disk once exposed is held softly under this (sky/sky.frag), so a
  // low sun keeps its colour instead of clipping to white.
  sunCeiling: 8,
  limbDarkening: 0.6, // the disk's edge at 40% of its centre's brightness
  // The aureole around the sun (sky/sky.frag): the sharp forward peak of the haze's
  // scattering, which makes the sun glow a few degrees wide, as the eye sees it.
  aureole: { g: 0.98, strength: 0.012 },
  stepMinutes: 10, // the dev time control (sky/time-control.js): , and . step the time by this much
  // The atmosphere (sky/atmosphere.glsl). Lengths in km, scattering and
  // absorption per km at sea level; Earth's values after Hillaire 2020, plus a
  // humid marine haze layer that softens the horizon and warms the low sun.
  atmosphere: {
    groundRadius: 6360,
    topRadius: 6460,
    rayleighScattering: [5.802e-3, 13.558e-3, 33.1e-3],
    rayleighHeight: 8,
    mieScattering: 3.996e-3,
    mieAbsorption: 0.444e-3,
    mieHeight: 1.2,
    // Haze: dense near the sea and thin above, so it softens the horizon and
    // reddens the low sun without greying the sky overhead.
    hazeScattering: 0.2, // and absorption: at 550 nm
    hazeAbsorption: 0.002,
    hazeAngstrom: 1, // how much more it scatters blue than red: the horizon pale blue, not grey
    hazeHeight: 0.15,
    mieG: 0.8,
    hazeG: 0.2, // scatters more evenly than the aerosols above, so seen side-on it reads bright, not grey
    ozoneAbsorption: [0.65e-3, 1.881e-3, 0.085e-3],
    groundAlbedo: [0.08, 0.1, 0.12], // mostly sea, seen from the sky
    sunIlluminance: [1, 1, 1], // linear sRGB, above the atmosphere; the unit of all light
    sunRadius: 0.2678, // degrees, the disk's angular radius
    wavelengths: [680, 550, 440], // nm: the red, green and blue the scattering above is given for
  },
  // Lookup table sizes (sky/atmosphere.js).
  tables: { transmittance: [256, 64], multiscatter: [32, 32], skyView: [192, 108], aerial: [32, 32, 32] },
  // Ray-march steps and sample counts of the tables (sky/*.frag). They run only
  // when the time or the camera's height changes, never per frame.
  samples: {
    transmittance: 40,
    multiscatter: { directions: 8, steps: 20 }, // directions per side of a grid over the sphere
    skyView: 48,
    aerial: 16,
    probe: { azimuths: 32, rings: 16, steps: 16 },
  },
  aerialRange: 64, // km: the aerial-perspective table reaches past the horizon from any view
  // The camera height the sky is drawn for moves in these steps (metres): the sky
  // follows the camera's height, but no faster than this.
  heightStep: 1,
  // Exposure follows the light: key / E^compensation, where E is the illuminance
  // (sky/light.js) in units of the sun above the atmosphere. 1 would make every
  // hour as bright as noon, 0 leave sunset dark. The user's pick (PLAN.md,
  // Decisions): 0.3, so a low sun stays darker and keeps its deep orange; 0.5
  // washed the sunset out. The key keeps noon's exposure as 0.5 had it.
  exposure: { key: 4.47, compensation: 0.3 },
};

// The frame readout (core/readout.js) and the benchmark (core/benchmark.js, ?bench=1).
export const readout = {
  key: 'F3',
  refreshSeconds: 0.5, // how often the numbers change: readable, and averaged over that time
};
export const bench = {
  warmupSeconds: 1, // per view, not measured: shaders compile, the frame rate settles
  warmupFrames: 10, // and at least this many frames, so one long hitch can't end the warmup
  seconds: 5, // measured per view
};

export const movement = {
  flySpeed: 8, // m/s
  minFlySpeed: 0.5,
  maxFlySpeed: 200,
  wheelSpeedStep: 1.2, // speed multiplier per mouse-wheel notch
  lookSensitivity: 0.0022, // radians per mouse pixel
  maxPitch: 89, // degrees
};

// Used when a URL param and the active view leave a value unset.
export const defaults = {
  view: 'beach',
  seed: '1',
  timeOfDay: 10, // hours of daylight, or a named time (sky/sun.js)
  t: 0, // simulation start time, seconds
};

export const capture = {
  // Frames rendered at the frozen time before the app signals ready, and again
  // for every extra frame the tool asks for. Raise it only for an effect that
  // builds up over frames: each frame costs ~0.4 s on SwiftShader.
  warmupFrames: 1,
  // tools/screenshot.js warns when an extra frame of a view (rendering and
  // reading it back) takes longer. Captures must stay quick on SwiftShader, the
  // one renderer every machine has, and each view renders about ten frames.
  frameBudgetMs: 1000,
  // What the screenshot tool measures per view (tools/measure.js).
  motion: { frames: 6, stepSeconds: 0.5, threshold: 4 }, // strip at t, t + 0.5 s, ...; threshold in 8-bit levels
  // Frames panned by stepPixels at the centre; see shimmer() in tools/image.js.
  // edge: local contrast (levels) that makes a pixel an edge pixel; edgeLimitPercent: the
  // share of edge pixels the silhouette fixture may have shimmering.
  shimmer: { frames: 5, stepPixels: 0.25, threshold: 24, ratio: 0.5, fullRatio: 0.7, edge: 48, limitPercent: 0.5, edgeLimitPercent: 5 },
  crop: { width: 300, height: 168, zoom: 4 }, // source pixels, shown at zoom x
  // edge: levels off the local mean that count as a real edge (drawn flat grey);
  // limitPercent: the share of a view, or of the gradient fixture, in bands (tools/image.js bandedShare).
  banding: { radius: 6, gain: 32, edge: 6, limitPercent: 1 },
  // The blend fixture, in 8-bit levels: how far a translucent card may land from its
  // reference mixed in linear light (post/frame.js; blending in the compressed HDR
  // target misses by 68, linear blending by 0.2), and how far the cards must differ
  // from the light behind them for the check to measure anything.
  blend: { limitLevels: 2, minContrastLevels: 20 },
  // The maths fixture (src/fixtures/maths.js): how far the GPU's SH values may land
  // from sky/light.js's (relative), and the tables' mappings from inverting (texels).
  // A wrong formula misses by whole texels; the GPUs' approximate sin and asin cost
  // up to 0.08 near the zenith on SwiftShader, and cost 0.28 at the horizon before
  // the mappings measured angles from it (chunks/angles.glsl).
  maths: { valueTolerance: 1e-4, texelTolerance: 0.1 },
  // The light fixture (src/fixtures/light.js), in 8-bit levels on a white sphere's
  // lit side: how far its channels may spread at midday (neutral), and how much
  // redder than blue it must be at golden hour (warm).
  light: { neutralLevels: 10, warmLevels: 80 },
  // The haze fixture (src/fixtures/haze.js), in 8-bit levels: how far the sky's
  // tables may land from direct marches through the same air. The sky's light as
  // SH misses the bright band along the horizon by up to 5 levels on a white
  // surface at golden hour; the tables miss by 1 to 4 levels.
  haze: { limitLevels: 6 },
};

// Frame cost limits per quality preset. tools/screenshot.js measures every view
// and warns above them. Guesses until PLAN.md Stage 11 calibrates them on real
// machines; the counts are the same on every GPU, so they work in CI too.
//   drawCalls, triangles   per frame, all passes
//   passes                 runs of drawing into one framebuffer, per frame
//   programs               linked shader programs
//   overdraw               fragments shaded per pixel of the main view, on average
//   textureMB              textures, mipmaps included
//   renderTargetMB         render targets, renderbuffers and the canvas
export const budget = {
  high: { drawCalls: 1500, triangles: 3e6, passes: 16, programs: 64, overdraw: 5, textureMB: 512, renderTargetMB: 256 },
  medium: { drawCalls: 1000, triangles: 1.5e6, passes: 12, programs: 64, overdraw: 4, textureMB: 384, renderTargetMB: 160 },
  low: { drawCalls: 600, triangles: 7.5e5, passes: 8, programs: 64, overdraw: 3, textureMB: 128, renderTargetMB: 96 },
};

export const build = {
  sizeBudgetBytes: 3 * 1024 * 1024, // raw size of dist/index.html; warn above, fail above 2x
};

export const config = { quality, camera, post, sky, readout, bench, movement, defaults, capture, budget, build };
