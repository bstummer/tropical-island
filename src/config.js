// All tunables live here as plain data. Keep this file free of browser APIs:
// the Node tools (tools/*.js) import it too.

// Quality presets, picked with ?quality=<name>. Systems read their own fields
// from ctx.quality, so a new system adds its per-preset knobs here.
export const quality = {
  default: 'high',
  // msaa: samples per pixel in the HDR target (post/frame.js); 0 turns it off.
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
  exposure: 1, // the scene materials' pre-exposure (chunks/scene-output.glsl); ?exposure= overrides it
  // The user's pick (PLAN.md, Decisions): keeps authored colours. agx-punchy's extra
  // saturation pushed strong cyans out of gamut (red clipped to 0, visible contours).
  tonemap: 'neutral',
  tonemaps: { neutral: 1, agx: 2, 'agx-punchy': 3, aces: 4 },
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
  timeOfDay: 10, // hours, 0–24
  t: 0, // simulation start time, seconds
};

export const capture = {
  // Frames rendered at the frozen time before the app signals ready, and again
  // for every extra frame the tool asks for. Raise it only for an effect that
  // builds up over frames: each frame costs ~0.4 s on SwiftShader.
  warmupFrames: 1,
  // tools/screenshot.js warns when one view's capture, measurements included,
  // takes longer. Captures must stay quick on SwiftShader, the one renderer
  // every machine has.
  timeBudgetMs: 15000,
  // What the screenshot tool measures per view (tools/measure.js).
  motion: { frames: 6, stepSeconds: 0.5, threshold: 4 }, // strip at t, t + 0.5 s, ...; threshold in 8-bit levels
  // Frames panned by stepPixels at the centre; see shimmer() in tools/image.js.
  // edge: local contrast (levels) that makes a pixel an edge pixel; edgeLimitPercent: the
  // share of edge pixels the silhouette fixture may have shimmering.
  shimmer: { frames: 5, stepPixels: 0.25, threshold: 24, ratio: 0.5, fullRatio: 0.7, edge: 48, limitPercent: 0.5, edgeLimitPercent: 5 },
  crop: { width: 300, height: 168, zoom: 4 }, // source pixels, shown at zoom x
  // edge: levels off the local mean that count as a real edge (drawn flat grey);
  // limitPercent: the gradient fixture's share in bands (tools/image.js bandedShare).
  banding: { radius: 6, gain: 32, edge: 6, limitPercent: 1 },
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

export const config = { quality, camera, post, readout, bench, movement, defaults, capture, budget, build };
