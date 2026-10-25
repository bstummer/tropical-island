// Named camera viewpoints, used by ?view=<name> and by tools/screenshot.js.
// Plain ESM with no browser APIs, so Node can import it.
//
// position: [x, y, z] in meters. Y is up, sea level is y = 0, the cove's beach is at the origin and the
//           island lies behind it (world/island.js).
// yaw:      degrees around +Y. 0 looks toward -Z, 90 looks toward -X (three.js rotation.y).
// pitch:    degrees, positive looks up.
// fov:      optional vertical FOV in degrees (defaults to config.camera.fov), 2 to 120.
// timeOfDay: hours of daylight or a named time (sky/sun.js). ?time= overrides it.
// brief:    one line on what the shot is for (focal point, where the sun sits, mood). Every view needs
//           one; reviews judge each capture against it.
// crops:    optional { name: [x, y] }: centres of regions the screenshot tool also saves zoomed in,
//           as fractions of the frame from the top left. Without it the tool crops the centre.
// disabled: optional true: kept, and found by name (?view=, the screenshot tool's --views), but left
//           out of every run over the views: captures, their checks, the benchmark and the tests.
//
// In a dev build, press P to log the current camera as an entry ready to paste here.

const all = [
  {
    name: 'beach',
    position: [3.11, 2.64, -11.59],
    yaw: 165,
    pitch: -3,
    fov: 60,
    timeOfDay: 11,
    brief: "Late morning on the dry sand in the middle of the bay, looking straight out to sea: the lagoon's turquoise deepening to the reef's surf line and the deep blue beyond, the headland on the left; the sun high behind your right shoulder.",
    crops: { shoreline: [0.5, 0.63], horizon: [0.5, 0.46] },
  },
  {
    name: 'shoreline',
    position: [-187.15, 11.03, 22.32],
    yaw: -99.2,
    pitch: -9,
    timeOfDay: 14.5,
    brief: "Early afternoon from just above the low point at the far end of the bay, along the curve of the beach to the headland: the waterline sweeping into the distance, the sun behind on the right lighting the headland's face.",
    crops: { headland: [0.69, 0.35] },
  },
  {
    name: 'jungle-edge',
    position: [2.76, 6.67, -48.95],
    yaw: -22.8,
    pitch: 9,
    timeOfDay: 9.5,
    brief: "Mid-morning from the palm belt behind the beach, looking up the cove's valley to the ridges and the summit, the sun high ahead on the left: the ground later stages fill with palms, undergrowth and dappled shade.",
    crops: { ridge: [0.5, 0.3] },
  },
  {
    name: 'horizon',
    position: [-20.01, 2.97, -21.93],
    yaw: 165,
    pitch: 1,
    fov: 8,
    timeOfDay: 'sunset',
    brief: "Telephoto from the beach into the setting sun, a degree above the sea: the disk, its glow, and the haze where sea meets sky.",
    crops: { sun: [0.536, 0.5] },
  },
  {
    name: 'overview',
    position: [-411.46, 1078.81, -120.56],
    yaw: -48.3,
    pitch: -64.8,
    fov: 60,
    timeOfDay: 11,
    brief: "Late morning from a kilometre up, looking down on the island: the volcano and its gullies in the middle, the cove's crescent beach and the headland at the bottom right, beaches and the lagoon inside the reef all round.",
    crops: { cove: [0.72, 0.76] },
  },
  {
    name: 'into-the-sun',
    position: [55.69, 2.14, 23.98],
    yaw: 168,
    pitch: -5,
    fov: 55,
    timeOfDay: 'golden-hour',
    brief: "Golden hour near the water's edge by the headland, looking into the low sun: the headland dark on the left, the bay's waterline leading out, the sun just right of centre above its path across the lagoon. The shot the cove is laid out for.",
    crops: { sun: [0.55, 0.32], waterline: [0.3, 0.67] },
  },
  {
    name: 'sand',
    position: [-8.56, 2.11, -6.69],
    yaw: 120,
    pitch: -35,
    fov: 60,
    timeOfDay: 16.5,
    brief: "Late afternoon, looking down at the sand at your feet near the water: its grain and ripples in the low sun from ahead on the left, the wet margin and the water's edge across the top.",
    crops: { grain: [0.6, 0.7], edge: [0.5, 0.2] },
  },
  {
    name: 'rocks',
    position: [95.93, 3.32, 94.03],
    yaw: -160,
    pitch: 6,
    fov: 60,
    timeOfDay: 15,
    brief: "Mid-afternoon at the end of the beach, where rock takes over: the low rock shelf running out to the water, wet and dark where the sea reaches it, and the headland's face rising behind, lit from the right by the sun over the lagoon.",
    crops: { face: [0.35, 0.35], shelf: [0.6, 0.65] },
  },
  {
    name: 'headland',
    disabled: true,
    position: [483.98, 190, 357.44],
    yaw: 35.4,
    pitch: -17.5,
    fov: 55,
    timeOfDay: 15.5,
    brief: "Mid-afternoon from the air outside the reef, along the headland's outer shore to its tip: cliffs of changing height above a wave-cut foot, green down to their edges, and beach again past the headland's root.",
  },
  {
    name: 'cape',
    disabled: true,
    position: [-736.03, 30, -1812.25],
    yaw: -140,
    pitch: -2.1,
    timeOfDay: 16,
    brief: "Late afternoon from above the lagoon off the rocky cape on the far side of the island: its low black wall between two beaches, the coastal flat and the hills behind.",
  },
  {
    name: 'coastal-flat',
    disabled: true,
    position: [-161.47, 6.08, -1792.88],
    yaw: -48,
    pitch: -1,
    timeOfDay: 10.5,
    brief: "Mid-morning at eye height on the coastal flat on the far side of the island, along it with the lagoon on the left and the hills on the right: old beach ridges and hummocks a few metres above the sea, the beach below.",
  },
  {
    name: 'summit',
    disabled: true,
    position: [239.13, 272.8, -579.04],
    yaw: -12.9,
    pitch: 1.2,
    fov: 60,
    timeOfDay: 11,
    brief: "Late morning at eye height in a dip near the summit, between its rough humps, a rocky one on the right: the ground's skyline up close, which must curve, not break into straight pieces.",
  },
];

export const views = all.filter((v) => !v.disabled);

export function findView(name) {
  const view = all.find((v) => v.name === name);
  if (!view) {
    throw new Error(`Unknown view "${name}". Known views: ${all.map((v) => v.name).join(', ')}`);
  }
  return view;
}
