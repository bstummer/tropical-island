// Headless screenshots of the built dist/index.html, plus contact sheets.
//
//   node tools/screenshot.js [--views beach,shoreline] [--label before] [--size 1600x900]
//                            [--t 12.5] [--time 17.5] [--seed 1] [--quality high]
//                            [--tonemap agx] [--fixture tonecard]
//                            [--gl auto|hardware|swiftshader]
//   node tools/screenshot.js --compare <labelA> <labelB>
//
// Capture writes screenshots/<label>/<view>.png, contact-sheet.png and info.json,
// plus per view the measurements in <label>/<view>/ (see tools/measure.js). The
// numbers go to info.json, with warnings above the limits in src/config.js. Each
// measurement is then run on a scene built to fail it (src/fixtures/, images in
// <label>/tool-check/), and must catch it. Last, the game runs for a few frames
// in player mode (no ?capture).
// Compare writes screenshots/compare/<A>_vs_<B>.png: A | B | diff for every view.
// Exits non-zero on console errors, page errors, shader errors, network requests,
// capture errors, timeouts or a failed tool check, in either mode. Limits only warn.
// The pure helpers are exported for tests/screenshot.test.js.
import { chromium } from 'playwright';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, readdirSync, realpathSync, writeFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { views as allViews } from '../src/views.js';
import { config } from '../src/config.js';
import { decodeDataUrl, measureCost, measureShimmer, measureView, renderFrame } from './measure.js';
import { encodePng } from './png.js';
import { heatImage, overdrawImage } from './image.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const BUILT_HTML = join(ROOT, 'dist', 'index.html');
const SHOTS = join(ROOT, 'screenshots');
const READY_TIMEOUT_MS = 60_000;
const PLAYER_MODE = { frames: 30, viewport: { width: 640, height: 360 } }; // errors only, so small
const SHEET_ORIGIN = 'http://contact-sheet.local';

const HARDWARE_ARGS = {
  win32: ['--use-angle=d3d11'],
  darwin: ['--use-angle=metal'],
  linux: ['--use-angle=vulkan', '--enable-features=Vulkan'],
};
const BACKENDS = {
  hardware: ['--enable-gpu', '--ignore-gpu-blocklist', ...(HARDWARE_ARGS[process.platform] ?? [])],
  swiftshader: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
};
const SOFTWARE_GL = /swiftshader|llvmpipe|softpipe|software|basic render/i;

const OPTIONS = new Set(['views', 'label', 'size', 't', 'time', 'seed', 'quality', 'tonemap', 'fixture', 'gl']);

// ---------------------------------------------------------------- capture

async function capture(args) {
  if (!existsSync(BUILT_HTML)) throw new Error('dist/index.html not found. Run `npm run build` first.');

  const views = selectViews(args.views);
  const [width, height] = parseSize(args.size ?? '1600x900');
  const label = sanitize(args.label ?? defaultLabel());
  const outDir = join(SHOTS, label);
  mkdirSync(outDir, { recursive: true });

  const query = { capture: '1' };
  for (const key of ['t', 'time', 'seed', 'quality', 'tonemap', 'fixture']) {
    if (args[key] !== undefined) query[key] = args[key];
  }
  for (const key of ['t', 'time']) {
    if (query[key] !== undefined && !Number.isFinite(Number(query[key]))) throw new Error(`--${key} must be a number`);
  }

  const { browser, kind, gl } = await launch(args.gl ?? 'auto');
  console.log(`screenshot: WebGL2 backend = ${kind} (${gl}), Chromium ${browser.version()}`);
  console.log(`screenshot: ${views.length} view(s) at ${width}x${height} -> ${rel(outDir)}`);

  const fileUrl = pathToFileURL(BUILT_HTML).href;
  const context = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: 1 });
  const results = [];
  const outputs = [];
  let player = null;

  let toolChecks = [];
  try {
    for (const [i, view] of views.entries()) {
      // The contract checks test the game's capture code, not the view: once per run is enough.
      const result = await captureView(context, fileUrl, query, view, outDir, { contractChecks: i === 0, gpuTime: kind === 'hardware' });
      if (existsSync(join(outDir, result.file))) outputs.push(join(outDir, result.file));
      if (result.files) outputs.push(join(outDir, view.name, '*.png'));
      report(view.name, result.timing.totalMs, summarize(result), result.problems, result.consoleWarnings, result.warnings);
      delete result.consoleWarnings;
      results.push(result);
    }

    toolChecks = await checkTools(context, fileUrl, query, views[0], outDir);
    for (const check of toolChecks) {
      report(`check ${check.name}`, check.ms, check.detail, check.problems, check.consoleWarnings);
      delete check.consoleWarnings;
    }
    outputs.push(join(outDir, 'tool-check', '*.png'));

    player = await checkPlayerMode(context, fileUrl, query, views[0]);
    report('player mode', player.ms, `${views[0].name}, real-time loop without ?capture`, player.problems, player.consoleWarnings);

    const meta = {
      label,
      createdAt: new Date().toISOString(),
      backend: kind,
      gl,
      browser: browser.version(), // SwiftShader output is only pixel-identical within one Chromium build
      size: [width, height],
      params: query,
      results,
      toolChecks,
      playerMode: { view: views[0].name, problems: player.problems },
    };
    writeFileSync(join(outDir, 'info.json'), JSON.stringify(meta, null, 2));
    outputs.push(join(outDir, 'info.json'));

    const sheet = join(outDir, 'contact-sheet.png');
    await renderPage(browser, contactSheetHtml(meta), sheetFiles(outDir, results), sheet);
    outputs.push(sheet);
  } finally {
    await browser.close();
  }

  const failed = results.filter((r) => r.problems.length).map((r) => r.view);
  failed.push(...toolChecks.filter((c) => c.problems.length).map((c) => `check ${c.name}`));
  if (player?.problems.length) failed.push('player mode');
  printOutputs(outputs);
  if (failed.length) {
    console.log(`screenshot: FAILED (${failed.join(', ')})`);
    return 1;
  }
  console.log('screenshot: OK');
  return 0;
}

// One view: load the page, save the still, then measure it with extra frames
// rendered in the same page (tools/measure.js). With `contractChecks`, also
// require that rendering the start frame again, and loading the view fresh at
// the last motion frame's time, both reproduce the pixels exactly.
async function captureView(context, fileUrl, query, view, outDir, { contractChecks, gpuTime }) {
  const started = Date.now();
  const { page, info, problems, consoleWarnings } = await openCapture(context, fileUrl, { ...query, view: view.name });
  const result = { view: view.name, file: `${view.name}.png`, info, timing: { loadMs: Date.now() - started }, problems, warnings: [], consoleWarnings };

  // Saved even when the capture failed: the picture often shows why.
  let still = null;
  try {
    still = await shoot(page, join(outDir, result.file));
  } catch (err) {
    problems.push({ kind: 'screenshot failed', text: err.message.split('\n')[0] });
  }

  if (info && still) {
    try {
      // Rendering the start frame again must reproduce it exactly; otherwise extra
      // frames would depend on what was rendered before them.
      const first = await page.evaluate(() => window.__CAPTURE__.image());
      if (contractChecks && (await renderFrame(page)) !== first) {
        problems.push({ kind: 'capture', text: 'rendering the start frame again changed its pixels' });
      }
      const measured = await measureView(page, { info, crops: view.crops, first, dir: join(outDir, view.name), gpuTime });
      result.measurements = measured.measurements;
      result.files = Object.fromEntries(Object.entries(measured.files).map(([k, f]) => [k, `${view.name}/${f}`]));
      if (contractChecks) {
        const t = measured.measurements.motionTimes.at(-1);
        const fresh = await openCapture(context, fileUrl, { ...query, view: view.name, t });
        problems.push(...fresh.problems);
        if (fresh.info && (await fresh.page.evaluate(() => window.__CAPTURE__.image())) !== measured.lastFrame) {
          problems.push({ kind: 'capture', text: `loading at t=${t} renders differently from seeking there: some state depends on more than t` });
        }
        await fresh.page.close();
      }
    } catch (err) {
      problems.push(classify(err.message.split('\n')[0], 'capture error'));
    }
  }
  await page.close();

  result.timing.totalMs = Date.now() - started;
  result.warnings.push(...checkLimits({ captureMs: result.timing.totalMs, ...result.measurements }, limitsFor(query)));
  return result;
}

// Every limit that applies to a capture with these params.
function limitsFor(query) {
  return {
    captureMs: config.capture.timeBudgetMs,
    shimmerPercent: config.capture.shimmer.limitPercent,
    ...config.budget[query.quality ?? config.quality.default],
  };
}

// The console line for a view: its measurements, or where the still went.
function summarize(result) {
  const m = result.measurements;
  if (!m) return rel(join(SHOTS, result.file));
  const [, tris] = METRIC_LABELS.triangles;
  const count = (n, word, plural = `${word}s`) => `${n} ${n === 1 ? word : plural}`;
  const gpu = m.gpuMs == null ? '' : ` · GPU ${m.gpuMs.toFixed(2)} ms`;
  return (
    `shimmer ${m.shimmerPercent.toFixed(2)}% · motion ${m.motionPercent.toFixed(1)}% · ` +
    `${count(m.drawCalls, 'draw')} · ${tris(m.triangles)} tris · ${count(m.passes, 'pass', 'passes')} · ${count(m.programs, 'program')} · ` +
    `overdraw ${m.overdraw.toFixed(2)} · tex ${megabytes(m.textureMB)} · RT ${megabytes(m.renderTargetMB)}${gpu}`
  );
}

// Opens a capture page and waits until it is ready or has failed.
async function openCapture(context, fileUrl, params) {
  const page = await context.newPage();
  const { problems, consoleWarnings } = watchPage(page, fileUrl);
  let info = null;
  try {
    await page.goto(`${fileUrl}?${new URLSearchParams(params)}`);
    const handle = await page.waitForFunction(
      () =>
        (window.__CAPTURE_ERROR__ && { error: String(window.__CAPTURE_ERROR__) }) ||
        (window.__CAPTURE_READY__ === true && { info: window.__CAPTURE_INFO__ ?? {} }),
      null,
      { timeout: READY_TIMEOUT_MS, polling: 50 },
    );
    const state = await handle.jsonValue();
    // The app usually console.error()s the same failure; report it once.
    if (state.error && !problems.some((p) => p.text.includes(state.error))) {
      problems.push(classify(state.error, 'capture error'));
    }
    info = state.info ?? null;
  } catch (err) {
    problems.push({ kind: 'timeout', text: `not ready after ${READY_TIMEOUT_MS / 1000} s: ${err.message.split('\n')[0]}` });
  }
  return { page, info, problems, consoleWarnings };
}

function shoot(page, path) {
  return page.screenshot({ path, animations: 'disabled', caret: 'hide' });
}

// Each measurement must catch the problem it measures in a scene built to have
// it (src/fixtures/), or the tool itself is broken. Images go to tool-check/.
async function checkTools(context, fileUrl, query, view, outDir) {
  const dir = join(outDir, 'tool-check');
  mkdirSync(dir, { recursive: true });
  const params = { ...query, view: view.name };
  return [
    await checkFixture(context, fileUrl, { ...params, fixture: 'shimmer' }, async (page, info, problems) => {
      const { limitPercent, threshold } = config.capture.shimmer;
      const start = decodeDataUrl(await page.evaluate(() => window.__CAPTURE__.image()));
      const { percent, heat } = await measureShimmer(page, info, start);
      writeFileSync(join(dir, 'shimmer.png'), encodePng(heatImage(start, heat, threshold)));
      const smooth = shimmerShare(heat, start.width, start.height, threshold, (x) => x > start.width / 2 + 8);
      const detail = `${percent.toFixed(1)}% shimmers (limit ${limitPercent}%), smooth half ${smooth.toFixed(2)}%`;
      if (!(percent > limitPercent)) problems.push({ kind: 'tool check', text: `shimmer fixture: ${detail}; the score no longer catches aliasing` });
      if (smooth > limitPercent) problems.push({ kind: 'tool check', text: `shimmer fixture: ${detail}; smooth content counts as shimmer` });
      return detail;
    }),
    // Built to exceed every cost limit of the low preset.
    await checkFixture(context, fileUrl, { ...params, fixture: 'heavy', quality: 'low' }, async (page, info, problems) => {
      const { cost, overdraw } = await measureCost(page);
      writeFileSync(join(dir, 'heavy-overdraw.png'), encodePng(overdrawImage(overdraw)));
      const limits = config.budget.low;
      const over = new Set(checkLimits(cost, limits).map((w) => w.metric));
      const missed = Object.keys(limits).filter((metric) => !over.has(metric));
      if (missed.length) {
        const values = missed.map((m) => `${m} ${Number(cost[m].toFixed(2))} vs ${limits[m]}`).join(', ');
        problems.push({ kind: 'tool check', text: `heavy fixture: no warning for ${values}` });
      }
      return `over the low preset's limit on ${over.size} of ${Object.keys(limits).length} metrics`;
    }),
    // What the frame promises (post/frame.js): edges stay anti-aliased against a
    // bright sky after tonemapping, and depth holds from a hilltop to the horizon.
    // The bars' edges are about 1% of the frame: 0.01% shimmers as built, 0.4%
    // with a plain linear MSAA resolve, so this check gets a tighter limit.
    await checkClean(context, fileUrl, { ...params, fixture: 'silhouette' }, dir, 'thin dark bars against a bright sky', 0.1),
    // 0.14% as built (where the planes end at the horizon), 43% without reversed depth.
    await checkClean(context, fileUrl, { ...params, fixture: 'depth' }, dir, 'two planes 5 cm apart, from a hilltop'),
  ];
}

// A fixture the frame must render without shimmer.
function checkClean(context, fileUrl, params, dir, what, limitPercent = config.capture.shimmer.limitPercent) {
  return checkFixture(context, fileUrl, params, async (page, info, problems) => {
    const { threshold } = config.capture.shimmer;
    const start = decodeDataUrl(await page.evaluate(() => window.__CAPTURE__.image()));
    const { percent, heat } = await measureShimmer(page, info, start);
    writeFileSync(join(dir, `${params.fixture}.png`), encodePng(heatImage(start, heat, threshold)));
    const detail = `${what}: ${percent.toFixed(2)}% shimmers (limit ${limitPercent}%)`;
    if (percent > limitPercent) problems.push({ kind: 'tool check', text: `${params.fixture} fixture: ${detail}` });
    return detail;
  });
}

// Opens a fixture and runs `check(page, info, problems)`, which returns a one-line detail.
async function checkFixture(context, fileUrl, params, check) {
  const started = Date.now();
  const { page, info, problems, consoleWarnings } = await openCapture(context, fileUrl, params);
  let detail = 'not measured';
  if (info) {
    try {
      detail = await check(page, info, problems);
    } catch (err) {
      problems.push(classify(err.message.split('\n')[0], 'capture error'));
    }
  }
  await page.close();
  return { name: params.fixture, detail, problems, consoleWarnings, ms: Date.now() - started };
}

// Percentage of the pixels in columns where inColumn(x) holds whose heat reaches threshold.
function shimmerShare(heat, width, height, threshold, inColumn) {
  let flagged = 0;
  let total = 0;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (!inColumn(x)) continue;
      total++;
      if (heat[y * width + x] >= threshold) flagged++;
    }
  }
  return total ? (100 * flagged) / total : 0;
}

// Measurements above their limits, as { metric, value, limit }. Metrics without a limit are skipped.
export function checkLimits(values, limits) {
  return Object.entries(values)
    .filter(([metric, value]) => Number.isFinite(limits[metric]) && Number.isFinite(value) && value > limits[metric])
    .map(([metric, value]) => ({ metric, value, limit: limits[metric] }));
}

const megabytes = (mb) => `${mb.toFixed(0)} MB`;
const METRIC_LABELS = {
  captureMs: ['capture time', (ms) => `${(ms / 1000).toFixed(1)} s`],
  shimmerPercent: ['shimmer', (p) => `${p.toFixed(2)}%`],
  drawCalls: ['draw calls', String],
  triangles: ['triangles', (n) => (n >= 1e6 ? `${(n / 1e6).toFixed(2)} M` : `${(n / 1e3).toFixed(1)} k`)],
  passes: ['render passes', String],
  programs: ['shader programs', String],
  overdraw: ['overdraw', (n) => `${n.toFixed(2)} fragments/pixel`],
  textureMB: ['texture memory', megabytes],
  renderTargetMB: ['render-target memory', megabytes],
  motionPercent: ['motion', (p) => `${p.toFixed(1)}%`],
  gpuMs: ['GPU time', (ms) => `${ms.toFixed(2)} ms`],
};

export function describeWarning({ metric, value, limit }) {
  const [label, format] = METRIC_LABELS[metric] ?? [metric, String];
  return `${label} ${format(value)} is over the limit of ${format(limit)}`;
}

// Capture mode freezes time and skips input, so it never runs the game the way
// players get it. Run it that way for a few frames: no errors or requests, and
// the start screen must be up.
async function checkPlayerMode(context, fileUrl, query, view) {
  const page = await context.newPage();
  await page.setViewportSize(PLAYER_MODE.viewport);
  const { problems, consoleWarnings } = watchPage(page, fileUrl);
  const params = new URLSearchParams({ ...query, view: view.name });
  params.delete('capture');
  const started = Date.now();
  try {
    await page.goto(`${fileUrl}?${params}`);
    // Polled once per animation frame, the same frames that drive the game loop.
    await page.waitForFunction(
      (frames) => (window.__PLAYER_FRAMES__ = (window.__PLAYER_FRAMES__ ?? 0) + 1) >= frames,
      PLAYER_MODE.frames,
      { polling: 'raf', timeout: READY_TIMEOUT_MS },
    );
    if (!(await page.evaluate(() => document.getElementById('start').checkVisibility()))) {
      problems.push({ kind: 'player mode', text: 'the start screen is not showing' });
    }
  } catch (err) {
    problems.push({ kind: 'player mode', text: err.message.split('\n')[0] });
  }
  await page.close();
  return { problems, consoleWarnings, ms: Date.now() - started };
}

// Turns console errors, page errors and requests for anything but the built file into problems.
function watchPage(page, fileUrl) {
  const problems = [];
  const consoleWarnings = [];
  page.on('console', (msg) => {
    if (msg.type() === 'error') problems.push(classify(msg.text()));
    else if (msg.type() === 'warning') consoleWarnings.push(msg.text());
  });
  page.on('pageerror', (err) => problems.push({ kind: 'page error', text: err.stack ?? err.message }));
  page.on('request', (req) => {
    const url = req.url();
    if (!isSameFile(url, fileUrl) && !/^(data|blob):/.test(url)) {
      problems.push({ kind: 'network request', text: url });
    }
  });
  return { problems, consoleWarnings };
}

// Whether a request URL is the page's own file:// URL, ignoring query and hash.
// Chromium upper-cases the Windows drive letter (file:///C:/...) while Node keeps
// the case of the working directory, and Windows paths ignore case anyway.
export function isSameFile(url, fileUrl, platform = process.platform) {
  const strip = (u) => u.split(/[?#]/)[0];
  return platform === 'win32' ? strip(url).toLowerCase() === strip(fileUrl).toLowerCase() : strip(url) === strip(fileUrl);
}

function report(name, ms, detail, problems, consoleWarnings, warnings = []) {
  console.log(`  ${problems.length ? 'FAIL' : 'ok  '} ${name.padEnd(14)} ${String(ms).padStart(5)} ms  ${detail}`);
  for (const p of problems) console.log(indent(`[${p.kind}] ${p.text}`, 7));
  for (const w of warnings) console.log(indent(`WARN ${describeWarning(w)}`, 7));
  if (consoleWarnings.length) console.log(indent(`${consoleWarnings.length} console warning(s); first: ${consoleWarnings[0]}`, 7));
}

function classify(text, fallback = 'console error') {
  if (/shader (error|compile)|WebGLProgram|ERROR: \d+:\d+/i.test(text)) return { kind: 'shader error', text };
  return { kind: fallback, text };
}

// ---------------------------------------------------------------- compare

async function compare(args) {
  const [labelA, labelB] = args.compare;
  const sides = [labelA, labelB].map((label) => {
    const dir = join(SHOTS, label);
    if (!existsSync(dir)) throw new Error(`no screenshots for label "${label}" (${rel(dir)})`);
    const infoFile = join(dir, 'info.json');
    const info = existsSync(infoFile) ? JSON.parse(readFileSync(infoFile, 'utf8')) : null;
    const pngs = new Set(readdirSync(dir).filter((f) => f.endsWith('.png') && f !== 'contact-sheet.png'));
    return { label, dir, info, pngs };
  });

  // views.js order first, then anything else found on disk.
  const names = [...new Set([...sides[0].pngs, ...sides[1].pngs].map((f) => f.slice(0, -4)))];
  const order = allViews.map((v) => v.name);
  names.sort((a, b) => (order.indexOf(a) + 1 || 1e9) - (order.indexOf(b) + 1 || 1e9) || a.localeCompare(b));
  if (!names.length) throw new Error('no view screenshots to compare');

  const files = new Map();
  const rows = names.map((name) => {
    const cell = (side, i) => {
      if (!side.pngs.has(`${name}.png`)) return null;
      const path = `/${i ? 'b' : 'a'}/${name}.png`;
      files.set(path, join(side.dir, `${name}.png`));
      return path;
    };
    const measurements = (side) => side.info?.results?.find((r) => r.view === name)?.measurements;
    return { name, a: cell(sides[0], 0), b: cell(sides[1], 1), changes: metricChanges(measurements(sides[0]), measurements(sides[1])) };
  });

  const outDir = join(SHOTS, 'compare');
  mkdirSync(outDir, { recursive: true });
  const out = join(outDir, `${sanitize(labelA)}_vs_${sanitize(labelB)}.png`);

  const browser = await chromium.launch({ headless: true }); // headless shell only, see launch()
  try {
    const stats = await renderPage(browser, compareSheetHtml(sides, rows), files, out);
    console.log(`screenshot: compare ${labelA} vs ${labelB}`);
    for (const warning of mismatchWarnings(sides)) console.log(`  WARN ${warning}`);
    for (const s of stats ?? []) {
      const changes = rows.find((r) => r.name === s.name)?.changes ?? [];
      console.log(`  ${s.name.padEnd(14)} ${s.summary}${changes.length ? `; ${changes.join(', ')}` : ''}`);
    }
  } finally {
    await browser.close();
  }
  printOutputs([out]);
  return 0;
}

// How a view's numbers changed between two captures, as "label before → after"
// for each metric whose shown value differs. Missing measurements give nothing.
export function metricChanges(a, b) {
  if (!a || !b) return [];
  return Object.entries(METRIC_LABELS)
    .filter(([metric]) => metric !== 'captureMs' && Number.isFinite(a[metric]) && Number.isFinite(b[metric]))
    .map(([metric, [label, format]]) => [label, format(a[metric]), format(b[metric])])
    .filter(([, before, after]) => before !== after)
    .map(([label, before, after]) => `${label} ${before} → ${after}`);
}

export function mismatchWarnings([a, b]) {
  if (!a.info || !b.info) return ['info.json missing on one side; cannot check capture settings'];
  const warnings = [];
  if (a.info.gl !== b.info.gl) warnings.push(`different GL backends: "${a.info.gl}" vs "${b.info.gl}"`);
  if (a.info.browser !== b.info.browser) {
    warnings.push(`different Chromium builds: ${a.info.browser ?? 'unknown'} vs ${b.info.browser ?? 'unknown'}`);
  }
  if (String(a.info.size) !== String(b.info.size)) warnings.push(`different sizes: ${a.info.size} vs ${b.info.size}`);
  if (JSON.stringify(a.info.params) !== JSON.stringify(b.info.params)) {
    warnings.push(`different params: ${JSON.stringify(a.info.params)} vs ${JSON.stringify(b.info.params)}`);
  }
  return warnings;
}

// ---------------------------------------------------------------- browser

// mode: 'auto' (hardware, falling back to SwiftShader), 'hardware' or 'swiftshader'.
async function launch(mode) {
  if (!['auto', 'hardware', 'swiftshader'].includes(mode)) {
    throw new Error(`--gl must be auto, hardware or swiftshader (got "${mode}")`);
  }
  const order = mode === 'auto' ? ['hardware', 'swiftshader'] : [mode];
  const tried = [];
  for (const kind of order) {
    let browser;
    try {
      // Headless shell only: no `channel:`, never headed. Other modes can clip the user's real mouse on Windows.
      browser = await chromium.launch({ headless: true, args: BACKENDS[kind] });
      const gl = await probeWebGL2(browser);
      if (!gl) throw new Error('no WebGL2 context');
      if (kind === 'hardware' && SOFTWARE_GL.test(gl)) throw new Error(`got a software renderer instead (${gl})`);
      return { browser, kind, gl };
    } catch (err) {
      await browser?.close();
      tried.push(`${kind}: ${explainLaunchError(err.message)}`);
      if (order.length > 1 && kind === 'hardware') console.log(`screenshot: hardware GL unavailable (${tried.at(-1)}), trying SwiftShader`);
    }
  }
  throw new Error(`could not start headless Chromium with WebGL2.\n  ${tried.join('\n  ')}`);
}

// Playwright's first error line can be generic ("Target page, context or browser has
// been closed") while the cause sits in the browser log below it. Returns one line.
export function explainLaunchError(message) {
  const lib = /error while loading shared libraries: ([^:\s]+)/.exec(message)?.[1];
  if (lib) return `missing system library ${lib}. Install Chromium's dependencies: npx playwright install-deps chromium (needs root or sudo)`;
  if (message.includes("Executable doesn't exist")) return 'the Chromium headless shell is not installed. Run: npx playwright install --only-shell chromium';
  return message.split('\n')[0];
}

async function probeWebGL2(browser) {
  const page = await browser.newPage();
  try {
    return await page.evaluate(() => {
      const gl = document.createElement('canvas').getContext('webgl2');
      if (!gl) return null;
      const ext = gl.getExtension('WEBGL_debug_renderer_info');
      return String(ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER));
    });
  } finally {
    await page.close();
  }
}

// Renders an HTML page (served from a fake origin so images are same-origin and
// canvas-readable) and saves a full-page PNG. Returns window.__SHEET_DONE__.
async function renderPage(browser, html, files, outPath) {
  const page = await browser.newPage({ viewport: { width: 1200, height: 600 }, deviceScaleFactor: 1 });
  try {
    await page.route(`${SHEET_ORIGIN}/**`, (route) => {
      const path = decodeURIComponent(new URL(route.request().url()).pathname);
      if (path === '/') return route.fulfill({ contentType: 'text/html', body: html });
      const file = files.get(path);
      return file ? route.fulfill({ path: file }) : route.fulfill({ status: 404, body: 'not found' });
    });
    await page.goto(`${SHEET_ORIGIN}/`);
    const width = await page.evaluate(() => document.documentElement.scrollWidth);
    await page.setViewportSize({ width, height: 600 });
    const done = await page.waitForFunction(() => window.__SHEET_DONE__, null, { timeout: READY_TIMEOUT_MS });
    await page.screenshot({ path: outPath, fullPage: true });
    // Awaited here: a bare `return` would let `finally` close the page mid-read.
    return await done.jsonValue();
  } finally {
    await page.close();
  }
}

function sheetFiles(dir, results) {
  return new Map(results.map((r) => [`/${r.file}`, join(dir, r.file)]));
}

// ---------------------------------------------------------------- sheets

const SHEET_CSS = `
  body { margin: 0; padding: 24px; background: #15171a; color: #e8e4dc; font: 14px/1.4 system-ui, 'Segoe UI', sans-serif; width: max-content; }
  h1 { margin: 0 0 4px; font-size: 20px; font-weight: 600; }
  .meta { color: #9aa0a8; margin-bottom: 18px; }
  .warn { color: #ffb454; margin: 4px 0 12px; }
  .grid { display: grid; gap: 16px; }
  figure { margin: 0; }
  figure img, figure canvas { display: block; width: var(--cell); height: auto; background: #000; }
  figcaption { padding: 6px 2px 0; }
  figcaption b { font-size: 16px; }
  figcaption span { color: #9aa0a8; margin-left: 8px; }
  .bad { outline: 3px solid #ff4d4d; }
  .missing { width: var(--cell); aspect-ratio: var(--aspect); display: grid; place-items: center; background: #222; color: #777; }
  .row-label { display: flex; align-items: baseline; gap: 10px; }
  .same { color: #6fd08c; } .diff { color: #ffb454; }
`;

function contactSheetHtml(meta) {
  const [w, h] = meta.size;
  const cols = meta.results.length <= 1 ? 1 : meta.results.length <= 4 ? 2 : 3;
  const cell = Math.min(w, 800);
  const params = Object.entries(meta.params).filter(([k]) => k !== 'capture').map(([k, v]) => `${k}=${v}`).join(' ');
  const figures = meta.results.map((r) => {
    const detail = r.info ? `time ${fmt(r.info.timeOfDay)} h · t ${fmt(r.info.t)} s · seed ${esc(r.info.seed)}` : 'no capture info';
    const status = r.problems.length ? ` · <span class="diff">${r.problems.length} problem(s)</span>` : '';
    const numbers = r.measurements ? `<br>${esc(summarize(r))} · ${fmt(r.timing.totalMs / 1000)} s` : '';
    const warnings = r.warnings.map((w) => `<br><span class="diff">⚠ ${esc(describeWarning(w))}</span>`).join('');
    return `<figure><img src="/${esc(r.file)}" class="${r.problems.length ? 'bad' : ''}">
      <figcaption><b>${esc(r.view)}</b><span>${detail}${status}${numbers}${warnings}</span></figcaption></figure>`;
  });
  return htmlDocument(`
    <h1>${esc(meta.label)}</h1>
    <div class="meta">${w}×${h} · ${esc(meta.backend)}: ${esc(meta.gl)} · Chromium ${esc(meta.browser)}${params ? ` · ${esc(params)}` : ''} · ${esc(meta.createdAt)}</div>
    <div class="grid" style="--cell:${cell}px; grid-template-columns: repeat(${cols}, ${cell}px)">${figures.join('')}</div>
    <script>
      Promise.all([...document.images].map((img) => img.decode().catch(() => {}))).then(() => { window.__SHEET_DONE__ = true; });
    </script>`);
}

function compareSheetHtml(sides, rows) {
  const [a, b] = sides;
  const size = a.info?.size ?? b.info?.size ?? [1600, 900];
  const cell = Math.min(size[0], 640);
  const describe = (s) => (s.info ? `${s.info.backend}: ${s.info.gl} · Chromium ${s.info.browser ?? 'unknown'} · ${s.info.size.join('×')}` : 'no info.json');
  const warnings = mismatchWarnings(sides).map((w) => `<div class="warn">⚠ ${esc(w)}</div>`).join('');
  const img = (src) => (src ? `<img src="${esc(src)}">` : `<div class="missing">missing</div>`);
  const body = rows.map((r) => `
    <div class="row-label"><b style="font-size:16px">${esc(r.name)}</b><span class="stat" data-view="${esc(r.name)}"></span>
      ${r.changes.length ? `<span class="diff">${esc(r.changes.join(' · '))}</span>` : ''}</div>
    <div class="grid" style="grid-template-columns: repeat(3, ${cell}px); margin-bottom: 22px">
      <figure>${img(r.a)}<figcaption>A · ${esc(a.label)}</figcaption></figure>
      <figure>${img(r.b)}<figcaption>B · ${esc(b.label)}</figcaption></figure>
      <figure>${r.a && r.b ? `<canvas data-a="${esc(r.a)}" data-b="${esc(r.b)}" data-view="${esc(r.name)}"></canvas>` : `<div class="missing">no diff</div>`}
        <figcaption>diff (changed pixels in magenta over B)</figcaption></figure>
    </div>`);
  return htmlDocument(`
    <h1>${esc(a.label)} <span style="color:#9aa0a8">vs</span> ${esc(b.label)}</h1>
    <div class="meta">A: ${esc(describe(a))}<br>B: ${esc(describe(b))}</div>
    ${warnings}
    <div style="--cell:${cell}px; --aspect:${size[0]} / ${size[1]}">${body.join('')}</div>
    <script>
      const load = (src) => new Promise((ok, fail) => { const i = new Image(); i.onload = () => ok(i); i.onerror = fail; i.src = src; });
      const pixels = (img) => {
        const c = new OffscreenCanvas(img.naturalWidth, img.naturalHeight);
        const g = c.getContext('2d', { willReadFrequently: true });
        g.drawImage(img, 0, 0);
        return g.getImageData(0, 0, c.width, c.height).data;
      };
      async function diff(canvas) {
        const [ia, ib] = await Promise.all([load(canvas.dataset.a), load(canvas.dataset.b)]);
        if (ia.naturalWidth !== ib.naturalWidth || ia.naturalHeight !== ib.naturalHeight) {
          return { name: canvas.dataset.view, summary: 'size mismatch', changed: -1 };
        }
        const w = ia.naturalWidth, h = ia.naturalHeight, pa = pixels(ia), pb = pixels(ib);
        const out = new ImageData(w, h);
        let changed = 0, max = 0;
        for (let i = 0; i < pa.length; i += 4) {
          const d = Math.max(Math.abs(pa[i] - pb[i]), Math.abs(pa[i + 1] - pb[i + 1]), Math.abs(pa[i + 2] - pb[i + 2]));
          const grey = 0.25 * (0.2126 * pb[i] + 0.7152 * pb[i + 1] + 0.0722 * pb[i + 2]);
          const k = d ? Math.min(1, 0.35 + d / 24) : 0;
          out.data[i] = grey + (255 - grey) * k;
          out.data[i + 1] = grey + (40 - grey) * k;
          out.data[i + 2] = grey + (200 - grey) * k;
          out.data[i + 3] = 255;
          if (d) { changed++; if (d > max) max = d; }
        }
        canvas.width = w; canvas.height = h;
        canvas.getContext('2d').putImageData(out, 0, 0);
        const pct = (100 * changed) / (w * h);
        const summary = changed ? pct.toFixed(pct < 0.01 ? 4 : 2) + '% of pixels differ (max channel delta ' + max + ')' : 'identical';
        return { name: canvas.dataset.view, summary, changed, maxDelta: max };
      }
      Promise.all([...document.images].map((i) => i.decode().catch(() => {})))
        .then(() => Promise.all([...document.querySelectorAll('canvas[data-a]')].map(diff)))
        .then((stats) => {
          for (const s of stats) {
            const el = document.querySelector('.stat[data-view="' + CSS.escape(s.name) + '"]');
            el.textContent = s.summary;
            el.className = 'stat ' + (s.changed === 0 ? 'same' : 'diff');
          }
          window.__SHEET_DONE__ = stats;
        });
    </script>`);
}

function htmlDocument(body) {
  return `<!doctype html><html><head><meta charset="utf-8"><style>${SHEET_CSS}</style></head><body>${body}</body></html>`;
}

// ---------------------------------------------------------------- helpers

export function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (!arg.startsWith('--')) throw new Error(`unexpected argument "${arg}"`);
    const eq = arg.indexOf('=');
    const key = eq === -1 ? arg.slice(2) : arg.slice(2, eq);
    if (key === 'compare') {
      out.compare = [argv[++i], argv[++i]];
      if (!out.compare[0] || !out.compare[1] || out.compare.some((l) => l.startsWith('--'))) {
        throw new Error('usage: --compare <labelA> <labelB>');
      }
      continue;
    }
    if (!OPTIONS.has(key)) throw new Error(`unknown option --${key}. Options: --${[...OPTIONS].join(', --')}, --compare`);
    const value = eq === -1 ? argv[++i] : arg.slice(eq + 1);
    if (value === undefined || value.startsWith('--')) throw new Error(`--${key} needs a value`);
    out[key] = value;
  }
  return out;
}

function selectViews(list) {
  if (!list || list === 'all') return allViews;
  return list.split(',').map((name) => {
    const view = allViews.find((v) => v.name === name.trim());
    if (!view) throw new Error(`unknown view "${name}". Views: ${allViews.map((v) => v.name).join(', ')}`);
    return view;
  });
}

function parseSize(text) {
  const m = /^(\d+)x(\d+)$/.exec(text);
  if (!m) throw new Error(`--size must look like 1600x900 (got "${text}")`);
  return [Number(m[1]), Number(m[2])];
}

function defaultLabel() {
  const stamp = new Date().toISOString().replace(/[-:]/g, '').replace('T', '-').slice(0, 15);
  try {
    const hash = execFileSync('git', ['rev-parse', '--short', 'HEAD'], { cwd: ROOT, stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim();
    const dirty = execFileSync('git', ['status', '--porcelain'], { cwd: ROOT, stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim();
    return `${hash}${dirty ? '-dirty' : ''}-${stamp}`;
  } catch {
    return `nogit-${stamp}`;
  }
}

function sanitize(label) {
  return label.replace(/[^\w.-]+/g, '-');
}

function printOutputs(paths) {
  console.log('\nOutputs:');
  for (const p of paths) console.log(`  ${p}`);
}

function rel(path) {
  return relative(ROOT, path) || '.';
}

function indent(text, n) {
  return text.split('\n').map((line) => ' '.repeat(n) + line).join('\n');
}

function fmt(n) {
  return typeof n === 'number' ? Number(n.toFixed(2)).toString() : '?';
}

function esc(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
}

// ---------------------------------------------------------------- main
// Last, so every module-level constant above is initialised before it runs.
// Runs only when executed directly, not when imported by tests.

const invokedPath = process.argv[1] && existsSync(process.argv[1]) ? realpathSync.native(process.argv[1]) : null;
if (invokedPath === realpathSync.native(fileURLToPath(import.meta.url))) {
  try {
    const args = parseArgs(process.argv.slice(2));
    process.exitCode = args.compare ? await compare(args) : await capture(args);
  } catch (err) {
    console.error(`\nscreenshot: ${err.message}`);
    process.exitCode = 1;
  }
}
