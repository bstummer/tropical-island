// All tunables live here as plain data. Keep this file free of browser APIs:
// the Node tools (tools/*.js) import it too.

// Quality presets, picked with ?quality=<name>. Systems read their own fields
// from ctx.quality, so a new system adds its per-preset knobs here.
export const quality = {
  default: 'high',
  presets: {
    low: { renderScale: 0.67, maxPixelRatio: 1, antialias: false },
    medium: { renderScale: 0.85, maxPixelRatio: 1.5, antialias: true },
    high: { renderScale: 1, maxPixelRatio: 2, antialias: true },
  },
};

export const camera = {
  fov: 70, // vertical, degrees; a view may override it
  near: 0.1,
  far: 6000,
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
  // Frames rendered at the frozen time before the app signals ready.
  // Reserved for temporal effects (TAA history, exposure adaptation).
  warmupFrames: 8,
};

export const build = {
  sizeBudgetBytes: 3 * 1024 * 1024, // raw size of dist/index.html; warn above, fail above 2x
};

export const config = { quality, camera, movement, defaults, capture, build };
