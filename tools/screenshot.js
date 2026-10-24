// Headless screenshots of the built dist/index.html, plus contact sheets.
//
//   node tools/screenshot.js [--views beach,shoreline] [--label before] [--size 1600x900]
//                            [--t 12.5] [--time 17.5|sunset] [--seed 1] [--quality high]
//                            [--tonemap agx] [--exposure 1.5] [--fixture tonecard]
//                            [--gl auto|hardware|swiftshader] [--checks]
//   node tools/screenshot.js --compare <labelA> <labelB>
//
// Capture writes screenshots/<label>/<view>.png, contact-sheet.png and info.json,
// plus per view the measurements in <label>/<view>/ (see tools/measure.js). The
// numbers go to info.json, with warnings above the limits in src/config.js. A
// reused label replaces the old capture.
// With --checks (npm run verify does it) the tool also tests itself and the
// game: each measurement must catch a scene built to fail it (src/fixtures/,
// images in <label>/tool-check/), errors that leave nothing wrong on screen must
// fail a capture, captures must be reproducible (also after the time of day
// changed in the page), and the game runs for a few frames in player mode (no
// ?capture) and as the benchmark.
// Compare writes screenshots/compare/<A>_vs_<B>.png: A | B | diff for every view.
// Exits non-zero on console errors, page errors, shader and WebGPU errors, a lost
// device, network requests, capture errors, timeouts or a failed check, in
// either mode. Limits only warn.
//
// --gl picks the WebGPU adapter: hardware (the machine's GPU) or swiftshader
// (Chromium's software GPU, which CI uses; only Linux has it: on Windows, run
// the tool in a Linux container with node tools/linux.js); auto takes the
// hardware and falls back to SwiftShader.
// The pure helpers are exported for tests/screenshot.test.js.
import { chromium } from 'playwright';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, readdirSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { views as allViews } from '../src/views.js';
import { config } from '../src/config.js';
import { sunPath } from '../src/sky/sun.js';
import { measureCost, measureShimmer, measureView, renderFrame, stopAnalysis } from './measure.js';
import { decodeDataUrl, decodePng, encodePng } from './png.js';
import { bandedShare, bandingView, brightestNear, meanColor, overdrawImage } from './image.js';
import { blendLayout, cardSpan } from '../src/fixtures/blend-layout.js';
import { coefficients, directions, texels } from '../src/fixtures/maths-cases.js';
import { answers as hazeAnswers } from '../src/fixtures/haze-cases.js';
import { shBasis, shIrradiance } from '../src/sky/light.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const BUILT_HTML = join(ROOT, 'dist', 'index.html');
const SHOTS = join(ROOT, 'screenshots');
const READY_TIMEOUT_MS = 60_000;
// Player mode and the benchmark draw in the same browser as the checks running
// beside them, whose full-size frames take seconds each on SwiftShader: they
// fail once a page draws no frame for this long (untilDone), not when slow.
const STALL_MS = 60_000;
// And what they wait for must happen within this, frames or not: a game that
// never starts drawing (its loop waits for the sky's light) fails, not hangs.
const DONE_MS = 600_000;
// Player mode and the benchmark only have to work: small, as SwiftShader draws every pixel on the CPU.
// meanLevels: how far the canvas's mean colour may be from the capture's of the same view.
const PLAYER_MODE = { frames: 30, viewport: { width: 320, height: 180 }, meanLevels: 4 };
const BENCH_SECONDS = 0.25; // per view: enough to prove the benchmark works
const CHECKS_AT_ONCE = 2; // see runChecks()
const SHEET_ORIGIN = 'http://contact-sheet.local';

// WebGPU in the headless shell needs --enable-unsafe-webgpu. On Windows its real
// GPU (D3D12) needs Dawn to compile with FXC: the shell ships without DXC.
const HARDWARE_ARGS = {
  win32: ['--disable-dawn-features=use_dxc'],
  darwin: [],
  linux: ['--enable-features=Vulkan'],
};
const BACKENDS = {
  hardware: ['--enable-unsafe-webgpu', '--enable-gpu', '--ignore-gpu-blocklist', ...(HARDWARE_ARGS[process.platform] ?? [])],
  // The compositor shows a WebGPU canvas through GL: without ANGLE on SwiftShader too, presenting loses the device.
  swiftshader: ['--enable-unsafe-webgpu', '--enable-features=Vulkan', '--use-vulkan=swiftshader', '--use-webgpu-adapter=swiftshader', '--use-angle=swiftshader'],
};
const SOFTWARE_GPU = /swiftshader|llvmpipe|softpipe|software|basic render|warp/i;

const OPTIONS = new Set(['views', 'label', 'size', 't', 'time', 'seed', 'quality', 'tonemap', 'exposure', 'fixture', 'gl']);
const FLAGS = new Set(['checks']);

// ---------------------------------------------------------------- capture

async function capture(args) {
  if (!existsSync(BUILT_HTML)) throw new Error('dist/index.html not found. Run `npm run build` first.');

  const views = selectViews(args.views);
  const [width, height] = parseSize(args.size ?? '1600x900');
  const label = sanitize(args.label ?? defaultLabel());
  if (label === 'compare') throw new Error('the label "compare" is taken: compare sheets go there');
  const outDir = join(SHOTS, label);
  // A reused label replaces the old capture, so no file of it lingers into a compare.
  rmSync(outDir, { recursive: true, force: true });
  mkdirSync(outDir, { recursive: true });

  const query = { capture: '1' };
  for (const key of ['t', 'time', 'seed', 'quality', 'tonemap', 'exposure', 'fixture']) {
    if (args[key] !== undefined) query[key] = args[key];
  }
  if (query.t !== undefined && !Number.isFinite(Number(query.t))) throw new Error('--t must be a number');
  if (query.time !== undefined) {
    try {
      sunPath.toHours(/^[a-z-]+$/.test(query.time) ? query.time : Number(query.time));
    } catch {
      throw new Error(`--time must be a time of day in daylight, ${sunPath.describe()}`);
    }
  }

  const { browser, kind, gl } = await launch(args.gl ?? 'auto');
  console.log(`screenshot: WebGPU adapter = ${kind} (${gl}), Chromium ${browser.version()}`);
  console.log(`screenshot: ${views.length} view(s) at ${width}x${height} -> ${rel(outDir)}${args.checks ? ', then the checks' : ''}`);

  const started = Date.now();
  const fileUrl = pathToFileURL(BUILT_HTML).href;
  const context = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: 1 });
  const results = [];
  const outputs = [];
  let player = null;
  let bench = null;

  let toolChecks = [];
  try {
    // Each view is reported once its analysis is done, while the next one renders.
    let reporting = Promise.resolve();
    for (const [i, view] of views.entries()) {
      // The contract checks test the game's capture code, not the view: once per run is enough.
      // The time check runs on every view, each going to the next named time in turn.
      const captured = await captureView(context, fileUrl, query, view, outDir, { contractChecks: args.checks && i === 0, timeCheck: args.checks ? i : null, gpuTime: kind === 'hardware' });
      reporting = reporting.then(async () => {
        const result = await finishView(captured, query);
        if (existsSync(join(outDir, result.file))) outputs.push(join(outDir, result.file));
        if (result.files) outputs.push(join(outDir, view.name, '*.png'));
        report(view.name, result.timing.pageMs, summarize(result), result.problems, result.consoleWarnings, result.warnings);
        delete result.consoleWarnings;
        results.push(result);
      });
    }
    // The checks start while the last view's analysis is still running.
    const checking = args.checks && runChecks(context, fileUrl, query, views[0], outDir);
    await reporting;

    if (checking) {
      ({ toolChecks, player, bench } = await checking);
      for (const check of toolChecks) {
        report(`check ${check.name}`, check.ms, check.detail, check.problems, check.consoleWarnings);
        delete check.consoleWarnings;
      }
      outputs.push(join(outDir, 'tool-check', '*.png'));
      const canvas = player.canvasOff === null ? '' : `, its canvas ${player.canvasOff.toFixed(1)} levels off the capture's mean colour`;
      report('player mode', player.ms, `${views[0].name}, real-time loop without ?capture${canvas}`, player.problems, player.consoleWarnings);
      report('benchmark', bench.ms, bench.detail, bench.problems, bench.consoleWarnings);
    }

    const meta = {
      label,
      createdAt: new Date().toISOString(),
      backend: kind,
      gl,
      browser: browser.version(), // SwiftShader output is only pixel-identical within one Chromium build
      size: [width, height],
      params: query,
      durationMs: Date.now() - started,
      results,
      ...(args.checks && {
        toolChecks,
        playerMode: { view: views[0].name, problems: player.problems },
        benchmark: { problems: bench.problems },
      }),
    };
    writeFileSync(join(outDir, 'info.json'), JSON.stringify(meta, null, 2));
    outputs.push(join(outDir, 'info.json'));

    const sheet = join(outDir, 'contact-sheet.png');
    await renderPage(browser, contactSheetHtml(meta), sheetFiles(outDir, results), sheet);
    outputs.push(sheet);
  } finally {
    await stopAnalysis();
    await browser.close();
  }

  const failed = results.filter((r) => r.problems.length).map((r) => r.view);
  failed.push(...toolChecks.filter((c) => c.problems.length).map((c) => `check ${c.name}`));
  if (player?.problems.length) failed.push('player mode');
  if (bench?.problems.length) failed.push('benchmark');
  printOutputs(outputs);
  const took = `in ${Math.round((Date.now() - started) / 1000)} s`;
  if (failed.length) {
    console.log(`screenshot: FAILED (${failed.join(', ')}) ${took}`);
    return 1;
  }
  console.log(`screenshot: OK ${took}${args.checks ? '' : ' (views only: --checks adds the checks)'}`);
  return 0;
}

// One view: load the page, save the still, then render the measurement frames
// in the same page (tools/measure.js). Resolves once the page is done with
// { result, analysis }, where `analysis` is still running (see finishView).
// With `contractChecks`, also require that rendering the start frame again, and
// loading the view fresh at the last motion frame's time, both reproduce the
// pixels exactly. With `timeCheck` (the view's index in the run), changing the
// time of day in the page (timeChangeTarget) must render as loading the view at
// that time does.
async function captureView(context, fileUrl, query, view, outDir, { contractChecks, timeCheck, gpuTime }) {
  const started = Date.now();
  const { page, info, problems, consoleWarnings } = await openCapture(context, fileUrl, { ...query, view: view.name });
  const result = { view: view.name, file: `${view.name}.png`, info, timing: { loadMs: Date.now() - started }, problems, warnings: [], consoleWarnings };
  const still = join(outDir, result.file);
  let analysis = null;
  try {
    if (!info) {
      await shoot(page, still); // saved even when the capture failed: the picture often shows why
    } else {
      const first = await page.evaluate(() => window.__CAPTURE__.image());
      await saveStill(page, info, first, still);
      // Rendering the start frame again must reproduce it exactly; otherwise extra
      // frames would depend on what was rendered before them.
      if (contractChecks && (await renderFrame(page)) !== first) {
        problems.push({ kind: 'capture', text: 'rendering the start frame again changed its pixels' });
      }
      const measured = await measureView(page, { info, crops: view.crops, first, dir: join(outDir, view.name), gpuTime });
      result.measurements = { ...measured.cost, motionTimes: measured.motionTimes };
      result.timing.frameMs = measured.frameMs;
      analysis = measured.analysis;
      if (contractChecks) {
        const t = measured.motionTimes.at(-1);
        const fresh = await openCapture(context, fileUrl, { ...query, view: view.name, t });
        problems.push(...fresh.problems);
        if (fresh.info && (await fresh.page.evaluate(() => window.__CAPTURE__.image())) !== measured.lastFrame) {
          problems.push({ kind: 'capture', text: `loading at t=${t} renders differently from seeking there: some state depends on more than t` });
        }
        await fresh.page.close();
      }
      if (timeCheck !== null) {
        const changed = await changeTime(context, fileUrl, { ...query, view: view.name }, page, timeChangeTarget(timeCheck, info.timeOfDay));
        problems.push(...changed.problems);
        if (changed.same === false) {
          problems.push({ kind: 'capture', text: `the time of day changed to ${changed.time} in the page renders differently from loading at ${changed.time}` });
        }
      }
    }
  } catch (err) {
    problems.push(classify(err.message.split('\n')[0], 'capture error'));
  }
  await page.close();
  result.timing.pageMs = Date.now() - started;
  return { result, analysis };
}

// The still is the canvas's own PNG when the canvas fills the page pixel for
// pixel, which saves a page screenshot. Below full resolution (a preset's
// renderScale), it is a screenshot of the page, scaled up as players see it.
async function saveStill(page, info, dataUrl, path) {
  const viewport = page.viewportSize();
  const [width, height] = info.drawingBuffer;
  if (width === viewport.width && height === viewport.height) writeFileSync(path, Buffer.from(dataUrl.slice(dataUrl.indexOf(',') + 1), 'base64'));
  else await shoot(page, path);
}

// Waits for a view's analysis and adds it to the result, with the warnings above the limits.
async function finishView({ result, analysis }, query) {
  if (analysis) {
    try {
      const { measurements, files, analyseMs } = await analysis;
      Object.assign(result.measurements, measurements);
      result.files = Object.fromEntries(Object.entries(files).map(([k, f]) => [k, `${result.view}/${f}`]));
      result.timing.analyseMs = analyseMs;
    } catch (err) {
      result.problems.push({ kind: 'analysis', text: err.message.split('\n')[0] });
    }
  }
  result.warnings.push(...checkLimits({ frameMs: result.timing.frameMs, ...result.measurements }, limitsFor(query)));
  return result;
}

// Every limit that applies to a capture with these params.
function limitsFor(query) {
  return {
    frameMs: config.capture.frameBudgetMs,
    shimmerPercent: config.capture.shimmer.limitPercent,
    bandingPercent: config.capture.banding.limitPercent,
    ...config.budget[query.quality ?? config.quality.default],
  };
}

// The console line for a view: its measurements, or where the still went.
function summarize(result) {
  const m = result.measurements;
  if (!m) return rel(join(SHOTS, result.file));
  const [, tris] = METRIC_LABELS.triangles;
  const count = (n, word, plural = `${word}s`) => `${n} ${n === 1 ? word : plural}`;
  const percent = (p, digits) => (Number.isFinite(p) ? `${p.toFixed(digits)}%` : '?');
  const gpu = m.gpuMs == null ? '' : ` · GPU ${m.gpuMs.toFixed(2)} ms`;
  return (
    `shimmer ${percent(m.shimmerPercent, 2)} · banding ${percent(m.bandingPercent, 2)} · motion ${percent(m.motionPercent, 1)} · ` +
    `${count(m.drawCalls, 'draw')} · ${tris(m.triangles)} tris · ${count(m.passes, 'pass', 'passes')} · ${count(m.pipelines, 'pipeline')} · ` +
    `overdraw ${m.overdraw.toFixed(2)} · tex ${megabytes(m.textureMB)} · RT ${megabytes(m.renderTargetMB)}${gpu} · ` +
    `${Math.round(result.timing.frameMs)} ms/frame`
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

// Every check of --checks, CHECKS_AT_ONCE at a time: the browser renders one
// page at a time anyway, and meanwhile the other check loads its page, reads
// back frames or waits for its analysis. The benchmark, the longest, goes first.
async function runChecks(context, fileUrl, query, view, outDir) {
  const tasks = [
    () => checkBenchmark(context, fileUrl, query, outDir),
    () => checkPlayerMode(context, fileUrl, query, view, outDir),
    ...toolCheckTasks(context, fileUrl, query, view, outDir),
  ];
  // SCREENSHOT_PROGRESS=1 says when each check is done, for finding one that hangs.
  const progress = process.env.SCREENSHOT_PROGRESS
    ? tasks.map((task, i) => async () => {
        const result = await task();
        console.log(`  … ${result.name ?? ['benchmark', 'player mode'][i]} done in ${result.ms} ms`);
        return result;
      })
    : tasks;
  const [bench, player, ...tools] = await inParallel(progress, CHECKS_AT_ONCE);
  return { toolChecks: tools, player, bench };
}

// Runs the async tasks, at most `limit` at a time. Resolves to their results, in order.
async function inParallel(tasks, limit) {
  const results = [];
  let next = 0;
  const lane = async () => {
    while (next < tasks.length) {
      const i = next++;
      results[i] = await tasks[i]();
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, tasks.length) }, lane));
  return results;
}

// Each measurement must catch the problem it measures in a scene built to have
// it (src/fixtures/), or the tool itself is broken. Images go to tool-check/.
// Returns the checks as functions to run.
function toolCheckTasks(context, fileUrl, query, view, outDir) {
  const dir = join(outDir, 'tool-check');
  mkdirSync(dir, { recursive: true });
  const params = { ...query, view: view.name };
  return [
    () => checkFixture(context, fileUrl, { ...params, fixture: 'shimmer' }, async (page, info, problems) => {
      const { limitPercent, threshold } = config.capture.shimmer;
      const { percent, heat, width, height } = await measureShimmer(page, info, join(dir, 'shimmer.png'));
      const smooth = shimmerShare(heat, width, height, threshold, (x) => x > width / 2 + 8);
      const detail = `${percent.toFixed(1)}% shimmers (limit ${limitPercent}%), smooth half ${smooth.toFixed(2)}%`;
      if (!(percent > limitPercent)) problems.push({ kind: 'tool check', text: `shimmer fixture: ${detail}; the score no longer catches aliasing` });
      if (smooth > limitPercent) problems.push({ kind: 'tool check', text: `shimmer fixture: ${detail}; smooth content counts as shimmer` });
      return detail;
    }),
    // Built to exceed every cost limit of the low preset.
    () => checkFixture(context, fileUrl, { ...params, fixture: 'heavy', quality: 'low' }, async (page, info, problems) => {
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
    // The bars are counted among edge pixels: about 2% of them shimmer as built,
    // 20% with a plain linear MSAA resolve.
    () => checkClean(context, fileUrl, { ...params, fixture: 'silhouette' }, dir, 'thin dark bars against a bright sky', {
      edges: true,
      limit: config.capture.shimmer.edgeLimitPercent,
    }),
    // 0.13% of the frame as built (SwiftShader lets a few far pixels of the lower
    // plane through; hardware GL shows none), 42% without reversed depth.
    () => checkClean(context, fileUrl, { ...params, fixture: 'depth' }, dir, 'two planes 5 cm apart, from a hilltop'),
    () => checkErrors(context, fileUrl, params),
    // Slow gradients must come out dithered, without bands.
    () => checkFixture(context, fileUrl, { ...params, fixture: 'gradient' }, async (page, info, problems) => {
      const image = decodeDataUrl(await page.evaluate(() => window.__CAPTURE__.image()));
      writeFileSync(join(dir, 'gradient.png'), encodePng(bandingView(image, config.capture.banding)));
      const banded = bandedShare(image);
      const limit = config.capture.banding.limitPercent;
      const detail = `slow gradients: ${banded.toFixed(2)}% in bands (limit ${limit}%)`;
      if (banded > limit) problems.push({ kind: 'tool check', text: `gradient fixture: ${detail}` });
      return detail;
    }),
    // Translucent layers blend in linear light (post/frame.js), through the post chain.
    // At an exposure other than 1: the cards and their references both scale with
    // it, so a pass that applies it twice or not at all shows only there.
    () => checkFixture(context, fileUrl, { ...params, fixture: 'blend', exposure: 2 }, async (page, info, problems) => {
      const dataUrl = await page.evaluate(() => window.__CAPTURE__.image());
      writeFileSync(join(dir, 'blend.png'), Buffer.from(dataUrl.slice(dataUrl.indexOf(',') + 1), 'base64'));
      const { worst, contrast } = blendMismatch(decodeDataUrl(dataUrl), { bands: blendLayout.bands, spans: blendLayout.cards.map((_, i) => cardSpan(i)) });
      const { limitLevels: limit, minContrastLevels } = config.capture.blend;
      const detail = `translucent cards off their linear-light mix by ${worst.toFixed(1)} levels at most (limit ${limit}), ${Math.round(contrast)} levels off the light behind`;
      if (worst > limit) problems.push({ kind: 'tool check', text: `blend fixture: ${detail}` });
      if (contrast < minContrastLevels) problems.push({ kind: 'tool check', text: `blend fixture: ${detail}; the cards don't show, so this measures nothing` });
      return detail;
    }),
    // The shared lighting's colour, on a white sphere with the sun behind the camera:
    // neutral at midday, warm at golden hour (PLAN.md Stage 2). And at midday the
    // light from below, on the shaded undersides of white spheres over sand and
    // over sea: the ground's, so brighter over sand (PLAN.md Stage 4).
    ...[
      ['midday', (c) => Math.max(...c) - Math.min(...c) <= config.capture.light.neutralLevels, 'neutral'],
      ['golden-hour', (c) => c[0] - c[2] >= config.capture.light.warmLevels, 'warm'],
    ].map(([time, ok, want]) => () =>
      checkFixture(context, fileUrl, { ...params, fixture: 'light', view: 'jungle-edge', time, name: `light ${time}` }, async (page, info, problems) => {
        const { white, radius, overSand, overSea } = await page.evaluate(() => window.__LIGHT__);
        const image = decodeDataUrl(await page.evaluate(() => window.__CAPTURE__.image()));
        writeFileSync(join(dir, `light-${time}.png`), encodePng(image));
        const colour = brightestNear(image, white, radius).map(Math.round);
        let detail = `a white sphere's lit side at ${time}: ${colour.join(', ')} (should read ${want})`;
        if (!ok(colour)) problems.push({ kind: 'tool check', text: `light fixture: ${detail}` });
        if (time !== 'midday') return detail;
        const underside = ({ at: [x, y], radius: r }) => meanColor(image, Math.round(x - 2), Math.round(y + 0.75 * r - 2), 5, 5).map(Math.round);
        const [sand, sea] = [underside(overSand), underside(overSea)];
        const luma = ([r, g, b]) => 0.2126 * r + 0.7152 * g + 0.0722 * b;
        const ratio = luma(sand) / Math.max(luma(sea), 1);
        const { bounceRatio } = config.capture.light;
        detail += `; undersides over sand ${sand.join(', ')}, over sea ${sea.join(', ')}: ${ratio.toFixed(2)}x (at least ${bounceRatio}x)`;
        if (!(ratio >= bounceRatio)) problems.push({ kind: 'tool check', text: `light fixture: the light from below doesn't follow the ground: ${detail}` });
        return detail;
      }),
    ),
    // What the GPU and JS both compute agrees, and the sky's table mappings invert (CLAUDE.md §5).
    () => checkFixture(context, fileUrl, { ...params, fixture: 'maths' }, async (page, info, problems) => {
      const m = mathsMismatch(await page.evaluate(() => window.__MATHS__));
      const { valueTolerance, texelTolerance } = config.capture.maths;
      const detail =
        `GPU SH vs sky/light.js off by ${m.basis.toExponential(1)} (basis) and ${m.irradiance.toExponential(1)} (irradiance), ` +
        `table mappings invert to ${m.skyView.toFixed(4)}, ${m.aerial.toFixed(4)} and ${m.multiscatter.toFixed(4)} texels`;
      if (!(m.basis <= valueTolerance && m.irradiance <= valueTolerance)) problems.push({ kind: 'tool check', text: `maths fixture: ${detail}` });
      if (!(m.skyView <= texelTolerance && m.aerial <= texelTolerance && m.multiscatter <= texelTolerance)) problems.push({ kind: 'tool check', text: `maths fixture: ${detail}` });
      return detail;
    }),
    // The heights and the ground the GPU draws are the ones JS knows
    // (src/fixtures/terrain.js), the comparison catches a sampler half a metre
    // off, the drawn ground keeps close to the island's between samples, the
    // mesh's own height on the GPU is its JS twin's, and the light from below
    // reads the ground's albedo JS expects where it expects it.
    () => checkFixture(context, fileUrl, { ...params, fixture: 'terrain' }, async (page, info, problems) => {
      const t = await page.evaluate(() => window.__TERRAIN__);
      for (const text of terrainProblems(t, config.capture.terrain)) problems.push({ kind: 'tool check', text: `terrain fixture: ${text}` });
      const { limit, mesh, bounce } = config.capture.terrain;
      return (
        `${t.points} points: GPU vs world/heightmap.js off by ${t.gpu.toExponential(1)} m (limit ${limit}), ` +
        `${t.mistaken.toFixed(2)} m half a metre off; the ground at ${t.ground.gpu.toFixed(2)} of its limits ` +
        `(${Object.entries(t.ground.fields).map(([f, v]) => `${f} ${v.toFixed(2)}`).join(', ')}), ` +
        `${t.ground.mistaken.toFixed(1)} half a metre off; drawn vs world/island.js per level (median) ${t.island.map((l) => `${l.median.toFixed(3)} m`).join(', ')}; ` +
        `the mesh's height at ${t.mesh.points} points off its twin by ${t.mesh.gpu.toExponential(1)} m (limit ${mesh}), ${t.mesh.mistaken.toFixed(2)} m for a camera 30 m off; ` +
        `the light from below's albedo at ${t.bounce.points} points off world/albedo.js's by ${t.bounce.gpu.toExponential(1)} (limit ${bounce}), ${t.bounce.mistaken.toFixed(2)} half a texel off`
      );
    }),
    // The rocks' GPU side puts them where JS knows they are (src/fixtures/rocks.js):
    // their offsets in the mesh as drawn, and where their vertex shader draws them.
    () => checkFixture(context, fileUrl, { ...params, fixture: 'rocks' }, async (page, info, problems) => {
      const r = await page.evaluate(() => window.__ROCKS__);
      for (const text of rockProblems(r, config.capture.rocks)) problems.push({ kind: 'tool check', text: `rocks fixture: ${text}` });
      const { offsets, vertices } = config.capture.rocks;
      return (
        `${r.rocks} rocks for ${r.cameras} cameras: offsets at ${r.offsets.points} points off their twin by ${r.offsets.gpu.toExponential(1)} m (limit ${offsets}), ` +
        `${r.offsets.mistaken.toFixed(2)} m read from the next rock's; ${r.vertices.pixels} pixels of ${r.vertices.rocks} rocks off their twin's surface by ` +
        `${r.vertices.gpu.toExponential(1)} m (limit ${vertices}), ${r.vertices.mistaken.toFixed(2)} m turned the wrong way`
      );
    }),
    // The ground's tiles repeat (src/fixtures/surfaces.js), and the check would see if they didn't.
    () => checkFixture(context, fileUrl, { ...params, fixture: 'surfaces', view: 'sand' }, async (page, info, problems) => {
      const s = await page.evaluate(() => window.__SURFACES__);
      for (const text of surfaceProblems(s, config.capture.surfaces)) problems.push({ kind: 'tool check', text: `surfaces fixture: ${text}` });
      const pct = (v) => `${(100 * v).toFixed(2)}%`;
      return Object.entries(s).map(([name, t]) => `${name} tile: ${pct(t.whole)} of texels change shifted a whole tile, ${pct(t.half)} half a tile`).join('; ');
    }),
    // The green's patches on the GPU are the ones JS knows (src/fixtures/patches.js).
    () => checkFixture(context, fileUrl, { ...params, fixture: 'patches' }, async (page, info, problems) => {
      const p = await page.evaluate(() => window.__PATCHES__);
      for (const text of patchesProblems(p, config.capture.patches)) problems.push({ kind: 'tool check', text: `patches fixture: ${text}` });
      return `${p.points} points: GPU vs world/green.js off by ${p.gpu.toExponential(1)} (limit ${config.capture.patches.limit}), ${p.mistaken.toFixed(2)} a tenth of a patch off`;
    }),
    // The sky's tables agree with the air they come from (src/fixtures/haze.js): from
    // the beach at golden hour, and from the hill at sunset, high enough above the
    // sea for tables that ignore the camera's height to show. And the sunlight in
    // the last minutes of daylight, when the hills keep the sun the beach is losing.
    ...[
      ['beach', 'golden-hour', {}],
      ['overview', 'sunset', { high: true }],
      ['overview', (sunPath.daylight.end - 0.002).toFixed(4), { sunOnly: true }],
    ].map(([view, time, cases]) => () =>
      checkFixture(context, fileUrl, { ...params, fixture: 'haze', view, time, name: `haze ${view} ${time}` }, async (page, info, problems) => {
        const haze = await page.evaluate(() => window.__HAZE__);
        const limit = config.capture.haze.limitLevels;
        for (const text of hazeProblems(haze, limit, cases)) problems.push({ kind: 'tool check', text: `haze fixture: ${text}` });
        const sun = Object.entries(haze.sun).map(([h, ratio]) => `${ratio.toFixed(2)}x at ${h} m`).join(', ');
        return `tables vs direct marches, worst in levels (limit ${limit}): ${hazeAnswers.map((name) => `${name} ${haze[name].toFixed(1)}`).join(', ')}; sunlight vs sea level ${sun}`;
      }),
    ),
    // Teardown: what a quality change rebuilds must go away completely and come
    // back the same. Also with the blend fixture, which makes the frame create
    // the targets of its translucent pass and post chain.
    ...[{ name: 'teardown' }, { name: 'teardown blend', fixture: 'blend' }].map((check) => () =>
      checkFixture(context, fileUrl, { ...params, ...check }, async (page, info, problems) => {
        const { leaks, samePicture, trip } = await qualityRoundTrip(page, query);
        if (leaks.length) problems.push({ kind: 'tool check', text: `${check.name}: ${trip} leaks ${leaks.join(', ')}` });
        if (!samePicture) problems.push({ kind: 'tool check', text: `${check.name}: the picture changed after ${trip}` });
        return `${trip}: ${leaks.length ? `leaks ${leaks.join(', ')}` : 'nothing leaked'}, ${samePicture ? 'same picture' : 'picture changed'}`;
      }),
    ),
    () => checkFixture(context, fileUrl, { ...params, fixture: 'leaky' }, async (page, info, problems) => {
      const { leaks, trip } = await qualityRoundTrip(page, query);
      // It forgets a texture, a render target and a mesh in the scene.
      const expected = ['Texture', 'RenderTarget', 'left in the scene'];
      if (!expected.every((what) => leaks.some((leak) => leak.includes(what)))) {
        problems.push({ kind: 'tool check', text: `leaky fixture: ${trip} reports only ${leaks.join(', ') || 'nothing'}` });
      }
      return `caught ${leaks.join(', ')}`;
    }),
    // The time-of-day check must catch a system that reads the time only at boot.
    () => checkFixture(context, fileUrl, { ...params, fixture: 'stale-time' }, async (page, info, problems) => {
      const changed = await changeTime(context, fileUrl, { ...params, fixture: 'stale-time' }, page, timeChangeTarget(0, info.timeOfDay));
      problems.push(...changed.problems);
      if (changed.same !== false) problems.push({ kind: 'tool check', text: `stale-time fixture: changing the time to ${changed.time} in the page went unnoticed` });
      return `a time read only at boot: ${changed.same === false ? 'caught' : 'missed'}`;
    }),
  ];
}

// The named time view i of a run changes to for the time check: the next one in
// turn, so a run covers them all, but never the view's own (`hours`).
export function timeChangeTarget(i, hours) {
  const names = ['golden-hour', 'sunrise', 'sunset', 'midday'];
  for (let k = 0; k < names.length; k++) {
    const name = names[(i + k) % names.length];
    if (Math.abs(sunPath.times[name] - hours) > 0.5) return name;
  }
}

// Sets the named `time` of day in a loaded capture page, as the game's time
// control does, and loads that time fresh: the two frames must match, or
// something that depends on the time doesn't follow it. Returns { time, same,
// problems }, with same null when the fresh page failed.
async function changeTime(context, fileUrl, params, page, time) {
  await page.evaluate((time) => window.__CAPTURE__.render({ time }), time);
  const changed = await page.evaluate(() => window.__CAPTURE__.image());
  const fresh = await openCapture(context, fileUrl, { ...params, time });
  const same = fresh.info ? (await fresh.page.evaluate(() => window.__CAPTURE__.image())) === changed : null;
  await fresh.page.close();
  return { time, same, problems: fresh.problems };
}

// Errors that leave nothing wrong on screen, or only blank and stale frames
// that would pass every measurement, must still fail a capture: a shader that
// doesn't compile, a material without sceneOutput() and one that blends outside
// the translucent pass, all out of sight
// (src/fixtures/broken.js), then a validation error and a lost device. Those
// problems are expected here; anything else on the page still fails the check.
async function checkErrors(context, fileUrl, params) {
  const started = Date.now();
  const { page, info, problems, consoleWarnings } = await openCapture(context, fileUrl, { ...params, fixture: 'broken' });
  const expected = [
    ['a hidden shader that fails to compile', (p) => p.kind === 'shader error' && /fixture-broken/.test(p.text)],
    ['a material without sceneOutput()', (p) => /without sceneOutput\(\): fixture-unwrapped/.test(p.text)],
    ['a material that blends outside the translucent pass', (p) => /blend outside the translucent pass.*: fixture-blended/.test(p.text)],
    ['a validation error', (p) => p.kind === 'webgpu error' && /MAP_WRITE|MapWrite|usage/i.test(p.text)],
    // The browser reports it too, as a console warning: proves GPU_ERROR still knows its words.
    ["the browser's warning of it", (p) => p.kind === 'webgpu warning' && /MAP_WRITE|MapWrite|usage/i.test(p.text)],
    ['a lost device', (p) => p.kind === 'device lost'],
  ];
  try {
    await page.evaluate(async () => {
      const { device } = document.getElementById('view').getContext('webgpu').getConfiguration();
      device.createBuffer({ size: 4, usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.MAP_WRITE }); // not allowed together
      await new Promise((resolve) => setTimeout(resolve, 100)); // the error arrives on its own
      device.destroy();
      await device.lost;
    });
    await page.evaluate(() => new Promise((resolve) => setTimeout(resolve, 100))); // for the console messages to arrive
  } catch (err) {
    problems.push(classify(err.message.split('\n')[0], 'capture error'));
  }
  await page.close();

  const seen = new Set();
  const unexpected = problems.filter((p) => {
    const matches = expected.filter(([, test]) => test(p)); // one message may report two of them
    for (const [what] of matches) seen.add(what);
    return !matches.length;
  });
  const missed = expected.map(([what]) => what).filter((what) => !seen.has(what));
  if (info) unexpected.push({ kind: 'tool check', text: 'errors: the broken fixture still signalled ready' });
  if (missed.length) unexpected.push({ kind: 'tool check', text: `errors: nothing reported ${missed.join(', ')}` });
  const caught = expected.map(([what]) => what).filter((what) => seen.has(what));
  const detail = `caught ${caught.join(', ') || 'nothing'}`;
  return { name: 'errors', detail, problems: unexpected, consoleWarnings, ms: Date.now() - started };
}

// Rebuilds the world with another preset and back, as a quality change in the
// game would, with a window resize on the way, then tears it down for good.
// Returns what grew on the GPU or was left in the scene, and whether the
// picture came back the same.
async function qualityRoundTrip(page, query) {
  const home = query.quality ?? config.quality.default;
  const away = home === 'low' ? 'high' : 'low';
  const size = page.viewportSize();
  const before = await page.evaluate(() => window.__CAPTURE__.resources());
  const picture = await page.evaluate(() => window.__CAPTURE__.image());
  await page.evaluate((preset) => window.__CAPTURE__.rebuild(preset), away);
  // Resize, render at the new size, and come back: targets get reallocated twice.
  for (const viewport of [{ width: Math.round(size.width * 0.6), height: Math.round(size.height * 0.6) }, size]) {
    await page.setViewportSize(viewport);
    await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(resolve))); // the resize event
    await page.evaluate(() => window.__CAPTURE__.render());
  }
  await page.evaluate((preset) => window.__CAPTURE__.rebuild(preset), home);
  const after = await page.evaluate(() => window.__CAPTURE__.resources());
  const samePicture = (await page.evaluate(() => window.__CAPTURE__.image())) === picture;
  const left = await page.evaluate(() => window.__CAPTURE__.teardown());
  const leaks = resourceLeaks(before, after);
  if (left.sceneObjects) leaks.push(`${left.sceneObjects} object(s) left in the scene`);
  return { leaks, samePicture, trip: `${home} → ${away} (and a resize) → ${home}` };
}

// The blend fixture (src/fixtures/blend.js) band by band: each translucent card
// against its reference half a frame to the right, and against the light just
// left of it, as mean colours over their insides (dither averages out). Returns
// the largest differences in 8-bit levels, { worst } between card and
// reference and { contrast } between card and light, which shows the cards are there.
export function blendMismatch(image, { bands, spans }) {
  const { width, height } = image;
  const inset = 3;
  let worst = 0;
  let contrast = 0;
  const diff = (a, b) => Math.max(...a.map((v, c) => Math.abs(v - b[c])));
  for (let k = 0; k < bands; k++) {
    const top = Math.ceil(height - ((k + 1) * height) / bands) + inset; // band k counts from the bottom
    const rows = Math.floor(height - (k * height) / bands) - inset - top;
    for (const [left, right] of spans) {
      const x = Math.ceil(left * width) + inset;
      const w = Math.floor(right * width) - inset - x;
      const card = meanColor(image, x, top, w, rows);
      const reference = meanColor(image, x + Math.round(width / 2), top, w, rows);
      const light = meanColor(image, Math.max(0, Math.round((left - 0.02) * width)), top, Math.round(0.015 * width), rows);
      worst = Math.max(worst, diff(card, reference));
      contrast = Math.max(contrast, diff(card, light));
    }
  }
  return { worst, contrast };
}

// The maths fixture's answers (src/fixtures/maths.js, RGBA per texel) against
// sky/light.js: the largest differences of the SH basis and irradiance, relative
// to the largest value, and the mappings' worst round trips in texels.
export function mathsMismatch(values) {
  const texel = (i) => values.slice(4 * i, 4 * i + 3);
  const unit = (d) => d.map((v) => v / Math.hypot(...d));
  let basis = 0;
  let irradiance = 0;
  directions.forEach((d, j) => {
    const expected = shBasis(unit(d));
    expected.forEach((e, k) => (basis = Math.max(basis, Math.abs(texel(texels.basis + 9 * j + k)[0] - e))));
    const want = shIrradiance(coefficients, unit(d));
    const got = texel(texels.irradiance + j);
    const scale = Math.max(...want.map(Math.abs), 1e-6);
    want.forEach((w, c) => (irradiance = Math.max(irradiance, Math.abs(got[c] - w) / scale)));
  });
  return { basis, irradiance, skyView: texel(texels.skyView)[0], aerial: texel(texels.aerial)[0], multiscatter: texel(texels.multiscatter)[0] };
}

// The terrain fixture's results (src/fixtures/terrain.js): the GPU's heights
// within `limit` of heightmap.js's and its ground within its limits (a share
// of them, at most 1), the deliberate mistakes beyond them, and per level the
// drawn ground's median miss of the island within islandMedian of the level's
// spacing, and the light from below's albedo within `bounce`, its mistake
// beyond it. Returns problem texts.
export function terrainProblems(t, { limit, islandMedian, mesh, bounce }) {
  const problems = [];
  if (!(t.gpu <= limit)) problems.push(`GPU vs world/heightmap.js off by ${t.gpu?.toExponential(1)} m (limit ${limit})`);
  if (!(t.mistaken > limit)) problems.push(`a sampler half a metre off is only ${t.mistaken?.toExponential(1)} m off, within the limit: the check misses it`);
  if (!(t.ground?.gpu <= 1)) problems.push(`the GPU's ground vs world/heightmap.js's at ${t.ground?.gpu?.toFixed(2)} of its limits`);
  if (!(t.ground?.mistaken > 1)) problems.push(`the ground half a metre off is only ${t.ground?.mistaken?.toFixed(2)} of its limits: the check misses it`);
  if (!(t.mesh?.gpu <= mesh)) problems.push(`the GPU's mesh height vs world/lod.js's twin off by ${t.mesh?.gpu?.toExponential(1)} m (limit ${mesh})`);
  if (!(t.mesh?.mistaken > mesh)) problems.push(`the mesh's height for a camera 30 m off is only ${t.mesh?.mistaken?.toExponential(1)} m off, within the limit: the check misses it`);
  if (!(t.bounce?.gpu <= bounce)) problems.push(`the ground's albedo the GPU's light from below reads vs world/albedo.js's off by ${t.bounce?.gpu?.toExponential(1)} (limit ${bounce})`);
  if (!(t.bounce?.mistaken > bounce)) problems.push(`the albedo map read half a texel off is only ${t.bounce?.mistaken?.toExponential(1)} off, within the limit: the check misses it`);
  for (const { texel, median } of t.island) {
    if (!(median <= islandMedian * texel)) problems.push(`the ${texel} m level misses world/island.js by ${median?.toFixed(3)} m (median; limit ${(islandMedian * texel).toFixed(2)})`);
  }
  return problems;
}

// The rocks fixture's results (src/fixtures/rocks.js): the GPU's offsets and
// the pixels its vertex shader draws within their limits of their JS twins,
// the deliberate mistakes beyond them, and enough pixels drawn to tell.
// Returns problem texts.
export function rockProblems(r, { offsets, vertices, pixels }) {
  const problems = [];
  if (!(r?.offsets?.gpu <= offsets)) problems.push(`the GPU's offsets vs their JS twin off by ${r?.offsets?.gpu?.toExponential(1)} m (limit ${offsets})`);
  if (!(r?.offsets?.mistaken > offsets)) problems.push(`offsets read from the next rock's block are only ${r?.offsets?.mistaken?.toExponential(1)} m off, within the limit: the check misses it`);
  if (!(r?.vertices?.gpu <= vertices)) problems.push(`world/rocks.wgsl draws rocks ${r?.vertices?.gpu?.toExponential(1)} m off their twin's surface (limit ${vertices})`);
  if (!(r?.vertices?.mistaken > vertices)) problems.push(`rocks turned the wrong way are only ${r?.vertices?.mistaken?.toExponential(1)} m off, within the limit: the check misses it`);
  if (!(r?.vertices?.pixels >= pixels)) problems.push(`only ${r?.vertices?.pixels} pixels of rocks drawn (at least ${pixels}): the check measures too little`);
  return problems;
}

// The surfaces fixture's tile check (src/fixtures/surfaces.js): per tile, the
// share of texels a whole tile's shift changed within `share`, and half a
// tile's above `mistaken`. Returns problem texts.
export function surfaceProblems(s, { share, mistaken, tiles }) {
  const problems = [];
  for (const name of tiles) {
    const t = s?.[name];
    if (!(t?.whole <= share)) problems.push(`the ${name} tile doesn't repeat: shifted a whole tile, ${(100 * t?.whole).toFixed(2)}% of its texels change (limit ${100 * share}%)`);
    if (!(t?.half > mistaken)) problems.push(`the ${name} tile shifted half a tile changes only ${(100 * t?.half).toFixed(2)}% of its texels: the check misses it`);
  }
  return problems;
}

// The patches fixture's results (src/fixtures/patches.js): the GPU's patches
// within `limit` of world/green.js's, and the deliberate mistake beyond it.
// Returns problem texts.
export function patchesProblems(p, { limit }) {
  const problems = [];
  if (!(p?.gpu <= limit)) problems.push(`GPU vs world/green.js off by ${p?.gpu?.toExponential(1)} (limit ${limit})`);
  if (!(p?.mistaken > limit)) problems.push(`points a tenth of a patch off are only ${p?.mistaken?.toExponential(1)} off, within the limit: the check misses it`);
  return problems;
}

// The haze fixture's answers (src/fixtures/haze-cases.js), worst misses in
// levels: what the tables miss must stay within `limit`, and the deliberate
// mistakes must go over it, or the measure sees nothing; and the sunlight must
// grow with height. `high`: the camera is high enough for tables made at sea
// level to show. `sunOnly`: judge the sunlight alone. Returns problem texts.
export function hazeProblems(haze, limit, { high = false, sunOnly = false } = {}) {
  const problems = [];
  for (const name of sunOnly ? ['sunlight'] : ['aerial', 'skyView', 'skyLight', 'sunlight']) {
    if (!(haze[name] <= limit)) problems.push(`${name} off by ${haze[name]?.toFixed(1)} levels (limit ${limit})`);
  }
  for (const name of sunOnly ? ['seaLevelSun'] : ['noHaze', 'dimSkyLight', 'seaLevelSun', ...(high ? ['seaLevel'] : [])]) {
    if (!(haze[name] > limit)) problems.push(`the deliberate mistake ${name} is only ${haze[name]?.toFixed(1)} levels off, within the limit: the measure misses it`);
  }
  const ratios = Object.entries(haze.sun ?? {}).sort(([a], [b]) => a - b);
  let last = 1;
  for (const [h, ratio] of ratios) {
    if (!(ratio >= last * (1 - 1e-3))) problems.push(`the sunlight at ${h} m is ${ratio?.toFixed(3)} times the sea level's, less than lower down`);
    last = ratio;
  }
  if (!ratios.length) problems.push('no sunlight reported by height');
  return problems;
}

// What grew between two __CAPTURE__.resources() snapshots: live GPU objects
// by kind and memory, as short phrases ("+2 Texture", "+0.2 MB textures").
export function resourceLeaks(before, after) {
  const leaks = [];
  for (const [kind, n] of Object.entries(after.objects)) {
    const grown = n - (before.objects[kind] ?? 0);
    if (grown > 0) leaks.push(`+${grown} ${kind}`);
  }
  for (const [key, label] of [['textureBytes', 'textures'], ['renderTargetBytes', 'render targets'], ['bufferBytes', 'buffers']]) {
    const grown = after[key] - before[key];
    if (grown > 0) leaks.push(`+${grown < 1024 * 1024 ? `${Math.ceil(grown / 1024)} KB` : `${(grown / (1024 * 1024)).toFixed(1)} MB`} ${label}`);
  }
  return leaks;
}

// A fixture the frame must render without shimmer: under `limit` percent of
// the frame, or of its edge pixels with `edges`.
function checkClean(context, fileUrl, params, dir, what, { edges = false, limit = config.capture.shimmer.limitPercent } = {}) {
  return checkFixture(context, fileUrl, params, async (page, info, problems) => {
    const result = await measureShimmer(page, info, join(dir, `${params.fixture}.png`));
    const percent = edges ? result.edgePercent : result.percent;
    const detail = `${what}: ${percent.toFixed(2)}% of ${edges ? 'edge pixels' : 'the frame'} shimmers (limit ${limit}%)`;
    if (percent > limit) problems.push({ kind: 'tool check', text: `${params.fixture} fixture: ${detail}` });
    return detail;
  });
}

// Opens a capture page (a fixture, or the island when params.name names the
// check instead) and runs `check(page, info, problems)`, which returns a one-line detail.
async function checkFixture(context, fileUrl, { name, ...params }, check) {
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
  return { name: name ?? params.fixture, detail, problems, consoleWarnings, ms: Date.now() - started };
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
  frameMs: ['capture time per frame', (ms) => `${Math.round(ms)} ms`],
  shimmerPercent: ['shimmer', (p) => `${p.toFixed(2)}%`],
  bandingPercent: ['banding', (p) => `${p.toFixed(2)}%`],
  drawCalls: ['draw calls', String],
  triangles: ['triangles', (n) => (n >= 1e6 ? `${(n / 1e6).toFixed(2)} M` : `${(n / 1e3).toFixed(1)} k`)],
  passes: ['render passes', String],
  pipelines: ['pipelines', String],
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
async function checkPlayerMode(context, fileUrl, query, view, outDir) {
  const page = await context.newPage();
  await page.setViewportSize(PLAYER_MODE.viewport);
  await stubPointerLock(page);
  const { problems, consoleWarnings } = watchPage(page, fileUrl);
  await countFrames(page);
  const params = new URLSearchParams({ ...query, view: view.name, stats: '1' }); // with the frame readout
  params.delete('capture');
  const started = Date.now();
  let canvasOff = null; // how far the canvas's mean colour is from the capture's
  try {
    await page.goto(`${fileUrl}?${params}`);
    await untilDone(page, (frames) => window.__FRAMES__ >= frames, PLAYER_MODE.frames);
    // The readout refreshes every config.readout.refreshSeconds; its key hides it.
    await untilDone(page, () => /\d+ draws/.test(document.getElementById('readout').textContent)).catch(() =>
      problems.push({ kind: 'player mode', text: 'the frame readout shows no numbers' }),
    );
    // Once the game draws (the readout's numbers), not after a count of the browser's
    // frames: a busy machine can take longer than that to boot.
    if (!(await page.evaluate(() => document.getElementById('start').checkVisibility()))) {
      problems.push({ kind: 'player mode', text: 'the start screen is not showing' });
    }
    await page.keyboard.press(config.readout.key); // a synthetic key event in the page, not the OS keyboard
    if (await page.evaluate(() => document.getElementById('readout').checkVisibility())) {
      problems.push({ kind: 'player mode', text: `${config.readout.key} does not hide the frame readout` });
    }
    // What the player sees, the canvas without the overlays, against the capture of
    // the same view (the same framing, more pixels): the game draws its output
    // straight onto the canvas, captures into a texture of their own (post/frame.js).
    const reference = join(outDir, `${view.name}.png`);
    if (existsSync(reference)) {
      const shown = await canvasMean(page);
      const captured = decodePng(readFileSync(reference));
      const expected = meanColor(captured, 0, 0, captured.width, captured.height);
      const off = (canvasOff = Math.max(...shown.map((v, c) => Math.abs(v - expected[c]))));
      if (!(off <= PLAYER_MODE.meanLevels)) {
        const levels = (c) => c.map((v) => v.toFixed(1)).join(', ');
        problems.push({ kind: 'player mode', text: `the canvas's mean colour (${levels(shown)}) is ${off.toFixed(1)} levels off the capture's (${levels(expected)}; limit ${PLAYER_MODE.meanLevels})` });
      }
    }
    // Start, walk on the ground for a few frames, and fly again. The pointer
    // lock is stubbed (stubPointerLock), so no real mouse is captured. The
    // readout, shown again, says where the camera is and how high above the
    // ground: the walk has to move it along the ground at eye height, with
    // Space held too, which would lift a flying camera.
    await page.click('#start');
    await page.keyboard.press(config.readout.key);
    const where = (previous) =>
      untilDone(
        page,
        (previous) => {
          const m = document.getElementById('readout').textContent.match(/at (\S+), (\S+), (\S+) · (\S+) m above the ground/);
          const at = m?.slice(1).map(Number);
          return at && at.every(Number.isFinite) && (!previous || at.some((v, i) => v !== previous[i])) && at;
        },
        previous,
      );
    const start = await where(null);
    await page.keyboard.press(config.movement.walk.key);
    await page.keyboard.down('KeyW');
    await page.keyboard.down('Space');
    const walking = await page.evaluate(() => window.__FRAMES__);
    await untilDone(page, (frames) => window.__FRAMES__ >= frames, walking + 10);
    await page.keyboard.up('Space');
    await page.keyboard.up('KeyW');
    const walked = await where(start);
    const { eye, float } = config.movement.walk;
    const moved = Math.hypot(walked[0] - start[0], walked[2] - start[2]);
    if (!(moved > 0.05 && (Math.abs(walked[3] - eye) < 0.02 || walked[1] <= float + 0.02))) {
      problems.push({ kind: 'player mode', text: `walking (${config.movement.walk.key}, W and Space) moved the camera ${moved.toFixed(2)} m to ${walked[3].toFixed(2)} m above the ground, not at eye height (${eye} m)` });
    }
    await page.keyboard.press(config.movement.walk.key);
  } catch (err) {
    problems.push({ kind: 'player mode', text: err.message.split('\n')[0] });
  }
  await page.close();
  return { problems, consoleWarnings, ms: Date.now() - started, canvasOff };
}

// The mean colour of the page's canvas as shown, with everything over it hidden for the shot.
async function canvasMean(page) {
  await page.evaluate(() => {
    for (const el of document.body.children) if (el.id !== 'view') el.style.visibility = 'hidden';
  });
  const image = decodePng(await page.locator('#view').screenshot());
  await page.evaluate(() => {
    for (const el of document.body.children) el.style.visibility = '';
  });
  return meanColor(image, 0, 0, image.width, image.height);
}

// Counts the page's animation frames into window.__FRAMES__ from its start:
// the frames that drive the game loop.
function countFrames(page) {
  return page.addInitScript(() => {
    window.__FRAMES__ = 0;
    const tick = () => {
      window.__FRAMES__++;
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });
}

// Resolves to what done(arg) returns in the page once it is truthy (it must
// be serializable). Fails if the page draws no frame for STALL_MS
// (countFrames), if it isn't done within DONE_MS, or if it closes.
async function untilDone(page, done, arg) {
  let frames = -1;
  let since = Date.now();
  const deadline = since + DONE_MS;
  for (;;) {
    const value = await page.evaluate(done, arg);
    if (value) return value;
    if (Date.now() > deadline) throw new Error(`not done in ${DONE_MS / 1000} s`);
    const now = await page.evaluate(() => window.__FRAMES__);
    if (now !== frames) {
      frames = now;
      since = Date.now();
    } else if (Date.now() - since > STALL_MS) {
      throw new Error(`no frame drawn for ${STALL_MS / 1000} s`);
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
}

// Pointer lock that never reaches the browser: requestPointerLock() makes the
// element the lock holder and fires pointerlockchange, as a real lock would.
function stubPointerLock(page) {
  return page.addInitScript(() => {
    let holder = null;
    Object.defineProperty(Document.prototype, 'pointerLockElement', { get: () => holder, configurable: true });
    Element.prototype.requestPointerLock = function () {
      holder = this;
      document.dispatchEvent(new Event('pointerlockchange'));
      return Promise.resolve();
    };
    Document.prototype.exitPointerLock = function () {
      holder = null;
      document.dispatchEvent(new Event('pointerlockchange'));
    };
  });
}

// The benchmark (?bench=1), shortened: it must visit every view and end with a
// complete summary, saved to <label>/benchmark.txt. SwiftShader's numbers say
// nothing about real hardware; this only proves the benchmark works.
async function checkBenchmark(context, fileUrl, query, outDir) {
  const page = await context.newPage();
  await page.setViewportSize(PLAYER_MODE.viewport);
  const { problems, consoleWarnings } = watchPage(page, fileUrl);
  await countFrames(page);
  const params = new URLSearchParams({ ...query, bench: '1', benchSeconds: String(BENCH_SECONDS) });
  params.delete('capture');
  const started = Date.now();
  let detail = 'did not finish';
  try {
    await page.goto(`${fileUrl}?${params}`);
    const { summary, results } = await untilDone(page, () => window.__BENCH__?.done && window.__BENCH__);
    writeFileSync(join(outDir, 'benchmark.txt'), `${summary}\n`);
    problems.push(...benchmarkProblems(summary, results, allViews.map((v) => v.name)));
    if (await page.evaluate(() => document.getElementById('start').checkVisibility())) {
      problems.push({ kind: 'benchmark', text: 'the start screen shows during the benchmark' });
    }
    detail = `${results.length} views, ${results.reduce((n, r) => n + r.frameMs.length, 0)} frames measured -> ${rel(join(outDir, 'benchmark.txt'))}`;
  } catch (err) {
    problems.push({ kind: 'benchmark', text: err.message.split('\n')[0] });
  }
  await page.close();
  return { problems, consoleWarnings, detail, ms: Date.now() - started };
}

// What is wrong with a benchmark result, if anything: every view measured, and
// a summary that says where it ran.
export function benchmarkProblems(summary, results, viewNames) {
  const problems = [];
  const measured = results.map((r) => r.view);
  if (String(measured) !== String(viewNames)) problems.push(`measured views ${measured.join(', ') || 'none'}, expected ${viewNames.join(', ')}`);
  for (const r of results) {
    if (!r.frameMs.length || !r.frameMs.every((ms) => Number.isFinite(ms) && ms > 0)) problems.push(`no valid frame times for ${r.view}`);
    if (!r.counts?.drawCalls) problems.push(`no GPU counts for ${r.view}`);
  }
  for (const line of ['build', 'gpu', 'browser', 'screen', 'preset']) {
    if (!new RegExp(`^${line} +\\S`, 'm').test(summary)) problems.push(`the summary has no "${line}" line`);
  }
  return problems.map((text) => ({ kind: 'benchmark', text }));
}

// WebGPU errors the browser reports as console warnings (the game reports the
// ones it hears of as errors itself, gpu/device.js). Dawn ends each with what it
// was doing: "While calling [Device].CreateBuffer(...)".
const GPU_ERROR = /^WebGPU|\[Invalid [A-Z]|GPUValidationError|validation error|While (calling|encoding|validating) \[/i;

// Turns console errors, WebGPU errors, page errors and requests for anything but
// the built file into problems.
function watchPage(page, fileUrl) {
  const problems = [];
  const consoleWarnings = [];
  page.on('console', (msg) => {
    if (msg.type() === 'error') problems.push(classify(msg.text()));
    else if (msg.type() === 'warning' && GPU_ERROR.test(msg.text())) problems.push({ kind: 'webgpu warning', text: msg.text() });
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
  if (/GPU device was lost/.test(text)) return { kind: 'device lost', text };
  if (/shader (error|compile)/i.test(text)) return { kind: 'shader error', text };
  if (/WebGPU error/.test(text)) return { kind: 'webgpu error', text };
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
    // The views info.json lists, so stray files from older captures stay out.
    const listed = info?.results?.map((r) => r.file);
    const pngs = new Set(listed ?? readdirSync(dir).filter((f) => f.endsWith('.png') && f !== 'contact-sheet.png'));
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
    .filter(([metric]) => metric !== 'frameMs' && Number.isFinite(a[metric]) && Number.isFinite(b[metric]))
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
      if (kind === 'swiftshader' && process.platform !== 'linux') {
        throw new Error('WebGPU has a SwiftShader adapter on Linux only: run this in a Linux container (node tools/linux.js node tools/screenshot.js ...)');
      }
      browser = await chromium.launch({ headless: true, args: BACKENDS[kind] });
      const { gl, fallback } = (await probeWebGPU(browser)) ?? {};
      if (!gl) throw new Error('no WebGPU adapter');
      if (kind === 'hardware' && (SOFTWARE_GPU.test(gl) || fallback)) throw new Error(`got a software adapter instead (${gl})`);
      if (kind === 'swiftshader' && !/swiftshader/i.test(gl)) throw new Error(`got another adapter instead (${gl})`);
      return { browser, kind, gl };
    } catch (err) {
      await browser?.close();
      tried.push(`${kind}: ${explainLaunchError(err.message)}`);
      if (order.length > 1 && kind === 'hardware') console.log(`screenshot: hardware WebGPU unavailable (${tried.at(-1)}), trying SwiftShader`);
    }
  }
  throw new Error(`could not start headless Chromium with WebGPU.\n  ${tried.join('\n  ')}`);
}

// Playwright's first error line can be generic ("Target page, context or browser has
// been closed") while the cause sits in the browser log below it. Returns one line.
export function explainLaunchError(message) {
  const lib = /error while loading shared libraries: ([^:\s]+)/.exec(message)?.[1];
  if (lib) return `missing system library ${lib}. Install Chromium's dependencies: npx playwright install-deps chromium (needs root or sudo)`;
  if (message.includes("Executable doesn't exist")) return 'the Chromium headless shell is not installed. Run: npx playwright install --only-shell chromium';
  return message.split('\n')[0];
}

// { gl: the adapter as gpu/device.js describes it ("google swiftshader"),
// fallback: whether it is a fallback (software) one }, or null without one.
// WebGPU needs a secure context: the page is the built game's own file:// URL.
async function probeWebGPU(browser) {
  const page = await browser.newPage();
  try {
    await page.goto(pathToFileURL(BUILT_HTML).href + '?probe');
    return await page.evaluate(async () => {
      const adapter = await navigator.gpu?.requestAdapter({ powerPreference: 'high-performance' });
      if (!adapter) return null;
      const { vendor, architecture, device, description, isFallbackAdapter } = adapter.info ?? {};
      return { gl: [vendor, architecture, device, description].filter(Boolean).join(' ') || 'unknown adapter', fallback: Boolean(isFallbackAdapter) };
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
    const numbers = r.measurements ? `<br>${esc(summarize(r))}` : '';
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
        <figcaption>diff over B: magenta, brighter = larger change; faint = 1-2 levels (dither)</figcaption></figure>
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
        let changed = 0, large = 0, max = 0;
        for (let i = 0; i < pa.length; i += 4) {
          const d = Math.max(Math.abs(pa[i] - pb[i]), Math.abs(pa[i + 1] - pb[i + 1]), Math.abs(pa[i + 2] - pb[i + 2]));
          const grey = 0.25 * (0.2126 * pb[i] + 0.7152 * pb[i + 1] + 0.0722 * pb[i + 2]);
          const k = d === 0 ? 0 : d <= 2 ? 0.15 : Math.min(1, 0.3 + d / 48);
          out.data[i] = grey + (255 - grey) * k;
          out.data[i + 1] = grey + (40 - grey) * k;
          out.data[i + 2] = grey + (200 - grey) * k;
          out.data[i + 3] = 255;
          if (d) { changed++; if (d > 2) large++; if (d > max) max = d; }
        }
        canvas.width = w; canvas.height = h;
        canvas.getContext('2d').putImageData(out, 0, 0);
        const pct = (100 * changed) / (w * h);
        const summary = changed ? pct.toFixed(pct < 0.01 ? 4 : 2) + '% of pixels differ, ' + ((100 * large) / (w * h)).toFixed(2) + '% by more than 2 levels (max channel delta ' + max + ')' : 'identical';
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
    if (FLAGS.has(key)) {
      if (eq !== -1) throw new Error(`--${key} takes no value`);
      out[key] = true;
      continue;
    }
    if (!OPTIONS.has(key)) throw new Error(`unknown option --${key}. Options: --${[...OPTIONS, ...FLAGS].join(', --')}, --compare`);
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
