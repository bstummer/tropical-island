// Named camera viewpoints, used by ?view=<name> and by tools/screenshot.js.
// Plain ESM with no browser APIs, so Node can import it.
//
// position: [x, y, z] in meters. Y is up, sea level is y = 0, the island is centred on the origin.
// yaw:      degrees around +Y. 0 looks toward -Z, 90 looks toward -X (three.js rotation.y).
// pitch:    degrees, positive looks up.
// fov:      optional vertical FOV in degrees (defaults to config.camera.fov), 2 to 120.
// timeOfDay: hours of daylight or a named time (sky/sun.js). ?time= overrides it.
// brief:    one line on what the shot is for (focal point, where the sun sits, mood). Every new view
//           needs one; the existing views get theirs in PLAN.md Stage 3.
// crops:    optional { name: [x, y] }: centres of regions the screenshot tool also saves zoomed in,
//           as fractions of the frame from the top left. Without it the tool crops the centre.
//
// In a dev build, press P to log the current camera as an entry ready to paste here.

export const views = [
  {
    name: 'beach',
    position: [10, 2.2, 88],
    yaw: 165,
    pitch: -7,
    timeOfDay: 11,
    crops: { shoreline: [0.5, 0.75], horizon: [0.5, 0.41] },
  },
  { name: 'shoreline', position: [80, 9, 80], yaw: 110, pitch: -14, timeOfDay: 14.5, crops: { 'spit-tip': [0.81, 0.33] } },
  { name: 'jungle-edge', position: [-14, 5.1, 70], yaw: -15, pitch: 4, timeOfDay: 9.5, crops: { ridge: [0.54, 0.3] } },
  {
    name: 'horizon',
    position: [10, 2.2, 88],
    yaw: 165,
    pitch: 1,
    fov: 8,
    timeOfDay: 'sunset',
    brief: 'Telephoto from the beach into the setting sun, a degree above the sea: the disk, its glow, and the haze where sea meets sky.',
    crops: { sun: [0.536, 0.5] },
  },
  { name: 'overview', position: [-250, 135, 210], yaw: -50, pitch: -24, fov: 55, timeOfDay: 17, crops: { shoreline: [0.36, 0.49] } },
];

export function findView(name) {
  const view = views.find((v) => v.name === name);
  if (!view) {
    throw new Error(`Unknown view "${name}". Known views: ${views.map((v) => v.name).join(', ')}`);
  }
  return view;
}
