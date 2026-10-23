// A top-down map of the island (world/island.js): relief, depths, zones and
// where the views stand, to judge the layout without rendering the game.
//
//   node tools/map.js [--seed 1] [--label name] [--set path=value ...]
//
// Writes screenshots/map/<label>.png: the whole island, the cove and its bay, drawn
// as someone on the cove's beach facing the sea sees them, the setting sun at
// the top. --set overrides a setting under config.world.island for candidates,
// with a JSON value: --set size=3000 --set cove.headlandSide=1.
// Land is coloured by zone and shaded from the upper left; contours every 20 m
// (100 m bold). Water is coloured by depth, with contours at 1, 2, 5, 10, 20 and 50 m.
// The pure helpers are exported for tests/map.test.js.
import { chromium } from 'playwright';
import { existsSync, mkdirSync, realpathSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { config } from '../src/config.js';
import { views } from '../src/views.js';
import { createRandom } from '../src/core/random.js';
import { createIsland } from '../src/world/island.js';
import { encodePng } from './png.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(ROOT, 'screenshots', 'map');
const PANEL = 760; // px, the longer side of each panel

// sRGB colours.
const ZONE_COLOURS = {
  'wet-sand': [196, 176, 134],
  'dry-sand': [236, 221, 178],
  scrub: [170, 182, 104],
  'palm-belt': [112, 156, 74],
  jungle: [48, 108, 52],
  rock: [138, 131, 120],
};
const DEPTH_COLOURS = [
  [0, [150, 232, 222]],
  [1, [110, 214, 210]],
  [3, [43, 179, 189]],
  [8, [24, 130, 170]],
  [25, [14, 82, 136]],
  [80, [10, 50, 98]],
  [400, [6, 28, 64]],
];
const LAND_CONTOUR = 20;
const SEA_CONTOURS = [1, 2, 5, 10, 20, 50];


async function main(argv) {
  const args = parseArgs(argv);
  const seed = args.seed ?? config.defaults.seed;
  const settings = withOverrides(config.world.island, args.set);
  const label = args.label ?? `seed-${seed}`;

  const started = performance.now();
  const island = createIsland(createRandom(seed), settings);
  // The whole island with its reef and the deep water round it, whatever its size.
  const { minA, maxA, minO, maxO } = island.coveBounds;
  const side = settings.cove.headlandSide;
  const panels = [
    { name: 'island', u: [Math.min(side * minA, side * maxA), Math.max(side * minA, side * maxA)], o: [minO, maxO] },
    { name: 'cove', u: [-560, 560], o: [-760, 560] },
    { name: 'bay', u: [-300, 300], o: [-200, 400] },
  ].map((p) => drawPanel(island, p));
  const ms = performance.now() - started;
  const samples = panels.reduce((n, p) => n + p.width * p.height, 0);

  const facts = describe(island);
  const html = page({ seed, label, settings, panels, island, facts, timing: `${samples.toLocaleString('en')} samples, ${((ms * 1000) / samples).toFixed(2)} µs each` });
  mkdirSync(OUT, { recursive: true });
  const file = join(OUT, `${label}.png`);
  const browser = await chromium.launch();
  try {
    const tab = await browser.newPage({ viewport: { width: 1900, height: 1100 }, deviceScaleFactor: 1 });
    await tab.setContent(html);
    await tab.screenshot({ path: file, fullPage: true });
  } finally {
    await browser.close();
  }
  console.log(`map: ${file}`);
  for (const line of facts) console.log(`  ${line}`);
}

export function parseArgs(argv) {
  const args = { set: [] };
  for (let i = 0; i < argv.length; i++) {
    const key = argv[i].replace(/^--/, '');
    const value = argv[++i];
    if (value === undefined) throw new Error(`--${key} needs a value`);
    if (key === 'set') args.set.push(value);
    else if (key === 'seed' || key === 'label') args[key] = value;
    else throw new Error(`unknown option --${key}`);
  }
  return args;
}

// A deep copy of settings with path=value overrides (JSON values).
export function withOverrides(settings, overrides) {
  const copy = structuredClone(settings);
  for (const item of overrides) {
    const at = item.indexOf('=');
    if (at < 0) throw new Error(`--set ${item}: expected path=value`);
    const path = item.slice(0, at).split('.');
    let value;
    try {
      value = JSON.parse(item.slice(at + 1));
    } catch {
      throw new Error(`--set ${item}: the value must be JSON`);
    }
    let node = copy;
    for (const key of path.slice(0, -1)) {
      if (typeof node[key] !== 'object' || node[key] === null) throw new Error(`--set ${item}: no setting ${path.join('.')}`);
      node = node[key];
    }
    if (!(path.at(-1) in node)) throw new Error(`--set ${item}: no setting ${path.join('.')}`);
    node[path.at(-1)] = value;
  }
  return copy;
}

// One panel: u (to the right of someone facing the sea) across, o (out to sea) up.
function drawPanel(island, { name, u: [u0, u1], o: [o0, o1] }) {
  const scale = PANEL / Math.max(u1 - u0, o1 - o0); // px per metre
  const width = Math.round((u1 - u0) * scale);
  const height = Math.round((o1 - o0) * scale);
  const side = island.settings.cove.headlandSide;
  const world = (px, py) => island.fromCove(side * (u0 + (px + 0.5) / scale), o1 - (py + 0.5) / scale);

  const samples = new Array(width * height);
  const heights = new Float64Array(width * height);
  for (let py = 0; py < height; py++) {
    for (let px = 0; px < width; px++) {
      const s = island.sample(...world(px, py));
      samples[py * width + px] = s;
      heights[py * width + px] = s.height;
    }
  }
  const data = new Uint8Array(width * height * 4);
  const at = (x, y) => heights[Math.min(height - 1, Math.max(0, y)) * width + Math.min(width - 1, Math.max(0, x))];
  for (let py = 0; py < height; py++) {
    for (let px = 0; px < width; px++) {
      const i = py * width + px;
      const s = samples[i];
      const gx = (at(px + 1, py) - at(px - 1, py)) * scale / 2;
      const gy = (at(px, py - 1) - at(px, py + 1)) * scale / 2; // up the map
      const slope = Math.hypot(gx, gy);
      const land = s.height > 0;
      let colour = land ? ZONE_COLOURS[island.zoneOf(s, slope)] : depthColour(-s.height);
      // Light from the upper left, 45° up; softer under water.
      const nx = -gx;
      const ny = -gy;
      const shade = (nx * -0.5 + ny * 0.5 + 0.7071) / Math.sqrt(nx * nx + ny * ny + 1) / 0.7071;
      const k = land ? 0.35 + 0.65 * shade : 0.75 + 0.25 * shade;
      colour = colour.map((c) => c * k);
      const line = contour(heights, width, height, px, py, land);
      if (line) colour = colour.map((c) => c * (1 - line));
      data.set([...colour.map((c) => Math.round(Math.min(255, Math.max(0, c)))), 255], i * 4);
    }
  }
  return { name, width, height, scale, u0, o1, png: encodePng({ width, height, data }) };
}

// How dark a contour line through this pixel is: 0 none, up to 0.55. A line
// is drawn on the high side of where the height crosses its level, towards
// any of the four neighbours, so it is one pixel wide and runs round every shore.
function contour(heights, width, height, px, py, land) {
  const h = heights[py * width + px];
  const around = [[1, 0], [0, 1], [-1, 0], [0, -1]]
    .filter(([dx, dy]) => px + dx >= 0 && px + dx < width && py + dy >= 0 && py + dy < height)
    .map(([dx, dy]) => heights[(py + dy) * width + px + dx]);
  const crossed = (level) => h >= level && around.some((n) => n < level);
  if (land) {
    const level = Math.floor(h / LAND_CONTOUR) * LAND_CONTOUR;
    const shore = crossed(0) ? 0.55 : 0;
    return Math.max(shore, level > 0 && crossed(level) ? (level % 100 === 0 ? 0.55 : 0.3) : 0);
  }
  return SEA_CONTOURS.some((d) => crossed(-d)) ? 0.22 : 0;
}

export function depthColour(depth) {
  for (let i = 1; i < DEPTH_COLOURS.length; i++) {
    const [d1, c1] = DEPTH_COLOURS[i];
    if (depth <= d1 || i === DEPTH_COLOURS.length - 1) {
      const [d0, c0] = DEPTH_COLOURS[i - 1];
      const t = Math.min(1, Math.max(0, (Math.log1p(depth) - Math.log1p(d0)) / (Math.log1p(d1) - Math.log1p(d0))));
      return c0.map((c, k) => c + (c1[k] - c) * t);
    }
  }
}

// The layout's numbers that the plan and the Decisions name.
function describe(island) {
  const { settings } = island;
  const along = (o) => island.sample(...island.fromCove(0, o));
  let reefAt = null;
  let deepest = 0;
  for (let o = 10; o < 900; o += 1) {
    const s = along(o);
    deepest = Math.min(deepest, s.height);
    if (reefAt === null && o > 60 && s.reef >= 0 && s.coast < 0) reefAt = o; // where the reef offset crosses 0: its crest
  }
  let peak = { height: -Infinity };
  for (let a = -900; a <= 900; a += 5) {
    for (let o = -1200; o <= 0; o += 5) {
      const h = island.sample(...island.fromCove(a, o)).height;
      if (h > peak.height) peak = { height: h, a, o };
    }
  }
  // Walk the shore from point to point: the first land coming in from the sea.
  let beach = 0;
  let last = null;
  for (let a = -400; a <= 400; a += 2) {
    let o = 400;
    while (o > -200 && island.sample(...island.fromCove(a, o)).coast < 0) o -= 0.5;
    const s = island.sample(...island.fromCove(a, o));
    if (last && s.beach > 0.5 && last.beach > 0.5) beach += Math.hypot(a - last.a, o - last.o);
    last = { a, o, beach: s.beach };
  }
  // Beyond the cove: the coast traced in from the sea along rays from the
  // island's middle, and its sandy stretches.
  const centre = [0, settings.coast.lobes.front - settings.size / 2];
  const outer = [];
  for (let k = 0; k < 720; k++) {
    const t = (2 * Math.PI * k) / 720;
    const at = (r) => island.sample(...island.fromCove(centre[0] + r * Math.sin(t), centre[1] - r * Math.cos(t)));
    let r = 3500;
    while (r > 0 && at(r).coast < 0) r -= 4;
    const [a, o] = [centre[0] + r * Math.sin(t), centre[1] - r * Math.cos(t)];
    if (Math.hypot(a, o) >= settings.cove.radius + settings.cove.blend) outer.push({ a, o, sandy: at(r).beach > 0.5 });
  }
  const beaches = [];
  let run = 0;
  outer.forEach((p, i) => {
    const q = outer[(i + 1) % outer.length];
    const step = Math.hypot(q.a - p.a, q.o - p.o);
    if (p.sandy && step < 50) run += step;
    else if (run) {
      beaches.push(run);
      run = 0;
    }
  });
  if (run) beaches.push(run);
  const long = beaches.filter((m) => m >= 100);
  const b = island.bounds;
  return [
    `size ${settings.size} m, island bounds ${Math.round(b.maxX - b.minX)} x ${Math.round(b.maxZ - b.minZ)} m (world x, z)`,
    `highest point ${peak.height.toFixed(0)} m, ${Math.round(Math.hypot(peak.a, peak.o))} m from the beach`,
    `reef crest straight out from the beach: ${reefAt === null ? 'none' : `${reefAt} m`}`,
    `sandy shore around the cove: about ${Math.round(beach)} m`,
    `beyond the cove: ${long.length} beaches of 100 m or more (${long.map((m) => Math.round(m / 10) * 10).join(', ')} m), ${Math.round((100 * outer.filter((p) => p.sandy).length) / outer.length)}% of the coast sand`,
  ];
}

function page({ seed, label, settings, panels, island, facts, timing }) {
  const side = settings.cove.headlandSide;
  const fovH = (fov) => 2 * Math.atan(Math.tan(((fov ?? config.camera.fov) * Math.PI) / 360) * (16 / 9));
  const svgFor = (p) => {
    const toPx = (x, z) => {
      const [a, o] = island.toCove(x, z);
      return [(side * a - p.u0) * p.scale, (p.o1 - o) * p.scale];
    };
    const marks = views.map((v) => {
      const [x, , z] = v.position;
      const [px, py] = toPx(x, z);
      const yaw = (v.yaw * Math.PI) / 180;
      const half = fovH(v.fov) / 2;
      const reach = Math.min(160, 0.12 * Math.max(p.width, p.height));
      const ray = (turn) => {
        const [tx, ty] = toPx(x - Math.sin(yaw + turn) * 50, z - Math.cos(yaw + turn) * 50);
        const len = Math.hypot(tx - px, ty - py) || 1;
        return [px + ((tx - px) / len) * reach, py + ((ty - py) / len) * reach];
      };
      const [l, r] = [ray(half), ray(-half)];
      return `<path d="M${px},${py} L${l} L${r} Z" fill="rgba(255,255,255,0.18)" stroke="#fff" stroke-width="1"/>
        <circle cx="${px}" cy="${py}" r="4" fill="#ff5a36" stroke="#fff"/>
        <text x="${px + 7}" y="${py - 7}">${v.name}</text>`;
    });
    const metres = { island: 500, cove: 100, bay: 50 }[p.name];
    return `<svg width="${p.width}" height="${p.height}">
      ${marks.join('')}
      <g transform="translate(${p.width / 2},18)"><text text-anchor="middle">▲ the setting sun</text></g>
      <g transform="translate(16,${p.height - 18})"><rect width="${metres * p.scale}" height="5" fill="#fff"/><text y="-6">${metres} m</text></g>
    </svg>`;
  };
  const legend = Object.entries(ZONE_COLOURS)
    .map(([name, c]) => `<span><i style="background:rgb(${c})"></i>${name}</span>`)
    .join('');
  const depths = DEPTH_COLOURS.slice(0, -1)
    .map(([d, c]) => `<span><i style="background:rgb(${c})"></i>${d} m</span>`)
    .join('');
  return `<!doctype html><meta charset="utf-8"><style>
    body { margin: 0; padding: 20px; background: #15171a; color: #e8e4dc; font: 14px/1.4 system-ui, 'Segoe UI', sans-serif; width: max-content; }
    h1 { margin: 0 0 4px; font-size: 20px; font-weight: 600; } .meta { color: #9aa0a8; margin-bottom: 12px; }
    .row { display: flex; gap: 20px; align-items: flex-start; } figure { margin: 0; position: relative; }
    figure img, figure svg { display: block; } figure svg { position: absolute; inset: 0; }
    svg text { fill: #fff; font-size: 13px; paint-order: stroke; stroke: rgba(0,0,0,0.7); stroke-width: 3px; }
    figcaption { margin-top: 6px; color: #9aa0a8; } .legend span { margin-right: 14px; white-space: nowrap; }
    .legend i { display: inline-block; width: 12px; height: 12px; margin-right: 5px; vertical-align: -1px; border-radius: 2px; }
  </style>
  <h1>${label}</h1>
  <div class="meta">seed ${seed} · ${facts.join(' · ')} · ${timing}</div>
  <div class="row">${panels
    .map((p) => `<figure><img src="data:image/png;base64,${Buffer.from(p.png).toString('base64')}">${svgFor(p)}<figcaption>${p.name}: facing the sea from the cove's beach</figcaption></figure>`)
    .join('')}</div>
  <p class="legend">${legend}</p><p class="legend">depth: ${depths} · contours every ${LAND_CONTOUR} m on land (100 m bold), at ${SEA_CONTOURS.join(', ')} m under water</p>`;
}

const invokedPath = process.argv[1] && existsSync(process.argv[1]) ? realpathSync.native(process.argv[1]) : null;
if (invokedPath === realpathSync.native(fileURLToPath(import.meta.url))) {
  main(process.argv.slice(2)).catch((err) => {
    console.error(`map: ${err.message}`);
    process.exit(1);
  });
}
