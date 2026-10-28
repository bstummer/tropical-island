import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { createImage } from '../tools/image.js';
import { shBasis, shIrradiance } from '../src/sky/light.js';
import { coefficients, directions, texelCount, texels } from '../src/fixtures/maths-cases.js';
import { answers as hazeAnswers } from '../src/fixtures/haze-cases.js';
import { sunPath } from '../src/sky/sun.js';
import { views } from '../src/views.js';
import { config } from '../src/config.js';
import {
  benchmarkProblems,
  blendMismatch,
  blockMismatch,
  checkLimits,
  describeWarning,
  diffSummary,
  explainLaunchError,
  hazeProblems,
  terrainProblems,
  surfaceProblems,
  patchesProblems,
  greenTilesProblems,
  isSameFile,
  labelFolder,
  mathsMismatch,
  metricChanges,
  mismatchWarnings,
  notReady,
  ownPages,
  pageLimit,
  parseArgs,
  planCapture,
  playerViewport,
  readCapture,
  removeCapture,
  resourceLeaks,
  rockProblems,
  sheetFiles,
  summarize,
  teardownLeftovers,
  timeChangeTarget,
  watchdog,
  watchPage,
} from '../tools/screenshot.js';

// A folder of its own under the system's temp folder, removed after the test.
function scratch(t) {
  const dir = mkdtempSync(join(tmpdir(), 'screenshot-test-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
}

// ---------------------------------------------------------------- own-page requests

test('the page itself is not a network request, whatever the drive letter case', () => {
  const node = 'file:///c:/Users/me/tropical-island/dist/index.html';
  const chromium = 'file:///C:/Users/me/tropical-island/dist/index.html?capture=1&view=beach';
  assert.equal(isSameFile(chromium, node, 'win32'), true);
  assert.equal(isSameFile(`${node}#top`, node, 'win32'), true);
});

test('other files are still requests', () => {
  const page = 'file:///C:/game/dist/index.html';
  assert.equal(isSameFile('file:///C:/game/dist/other.html', page, 'win32'), false);
  assert.equal(isSameFile('https://example.com/index.html', page, 'win32'), false);
  // Linux paths are case-sensitive: a different case is a different file.
  assert.equal(isSameFile('file:///home/Me/dist/index.html', 'file:///home/me/dist/index.html', 'linux'), false);
  assert.equal(isSameFile('file:///home/me/dist/index.html?t=1', 'file:///home/me/dist/index.html', 'linux'), true);
});

test('a watched page reports requests for other files and WebSockets, not its own file', () => {
  const page = new EventEmitter();
  const fileUrl = 'file:///home/me/dist/index.html';
  const { problems } = watchPage(page, fileUrl);
  page.emit('request', { url: () => `${fileUrl}?capture=1` });
  page.emit('request', { url: () => 'data:image/png;base64,AAAA' });
  assert.deepEqual(problems, []);
  page.emit('request', { url: () => 'https://example.com/font.woff2' });
  page.emit('websocket', { url: () => 'ws://localhost:5173/' }); // Playwright reports no request for it
  assert.deepEqual(problems, [
    { kind: 'network request', text: 'https://example.com/font.woff2' },
    { kind: 'network request', text: 'ws://localhost:5173/' },
  ]);
});

// ---------------------------------------------------------------- limits

test('only values above their limit are reported', () => {
  const warnings = checkLimits({ frameMs: 1001, drawCalls: 10, triangles: 5 }, { frameMs: 1000, drawCalls: 10 });
  assert.deepEqual(warnings, [{ metric: 'frameMs', value: 1001, limit: 1000 }]);
});

test('missing or non-numeric values and limits never warn', () => {
  assert.deepEqual(checkLimits({ frameMs: null, gpuMs: NaN }, { frameMs: 1, gpuMs: 1 }), []);
  assert.deepEqual(checkLimits({ frameMs: 99 }, {}), []);
});

test('compare lists the numbers that changed, as shown', () => {
  const before = { drawCalls: 3, triangles: 162208, overdraw: 1.891, shimmerPercent: 0.03, gpuMs: null };
  const after = { drawCalls: 5, triangles: 162210, overdraw: 1.8912, shimmerPercent: 0.03, gpuMs: 1.2 };
  assert.deepEqual(metricChanges(before, after), ['draw calls 3 → 5']); // the rest round the same, or is missing on one side
  assert.deepEqual(metricChanges({ textureMB: 10 }, { textureMB: 300 }), ['texture memory 10 MB → 300 MB']);
  assert.deepEqual(metricChanges(undefined, after), []);
});

test("compare's diff line never reads a real change as zero, and counts the pixels", () => {
  assert.equal(diffSummary({ changed: 0, large: 0, max: 0, total: 1440000 }), 'identical');
  const small = diffSummary({ changed: 61, large: 20, max: 3, total: 1440000 });
  assert.equal(small, '0.0042% (61 px) of pixels differ, 0.0014% (20 px) by more than 2 levels (max channel delta 3)');
  // One pixel of a 4K frame, the smallest share there is.
  assert.match(diffSummary({ changed: 1, large: 1, max: 9, total: 3840 * 2160 }), /^0\.000012% \(1 px\) of pixels differ, 0\.000012% \(1 px\) by more/);
  assert.match(diffSummary({ changed: 400000, large: 0, max: 2, total: 1440000 }), /^27\.78% \(400000 px\) of pixels differ, 0\.00% \(0 px\) by more/);
});

test('a view whose capture failed reports where its still is, under its label, or that it has none', (t) => {
  const dir = join(scratch(t), 'my-label');
  mkdirSync(dir);
  const failed = { view: 'beach', file: 'beach.png', problems: [{ kind: 'timeout', text: '...' }] };
  assert.equal(summarize(failed, dir), 'no still saved');
  writeFileSync(join(dir, 'beach.png'), '');
  assert.ok(summarize(failed, dir).endsWith(join('my-label', 'beach.png')), summarize(failed, dir));
});

test('resource leaks list what grew, and nothing for what shrank or stayed', () => {
  const MB = 1024 * 1024;
  const before = { objects: { Texture: 5, Buffer: 9, Framebuffer: 2 }, textureBytes: 10 * MB, renderTargetBytes: 50 * MB, bufferBytes: 2 * MB };
  assert.deepEqual(resourceLeaks(before, before), []);
  const after = { objects: { Texture: 7, Buffer: 8, Framebuffer: 2, Query: 1 }, textureBytes: 10.5 * MB, renderTargetBytes: 50 * MB, bufferBytes: 1 * MB };
  assert.deepEqual(resourceLeaks(before, after), ['+2 Texture', '+1 Query', '+512 KB textures']);
  assert.deepEqual(resourceLeaks(before, { ...before, renderTargetBytes: 66.5 * MB }), ['+16.5 MB render targets']);
});

test("player mode's canvas is compared with the capture block by block, at any size", () => {
  // Sky above, sand below, a dark headland on the left: as a view looks.
  const view = (width, height) => {
    const image = createImage(width, height);
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const colour = y < height / 2 ? (x < width / 4 ? [40, 60, 30] : [120, 170, 230]) : [220, 200, 160];
        image.data.set(colour, (y * width + x) * 4);
      }
    }
    return image;
  };
  // Each pixel of the canvas from the canvas as drawn at (x, y).
  const moved = (image, from) => {
    const out = createImage(image.width, image.height);
    for (let y = 0; y < image.height; y++) {
      for (let x = 0; x < image.width; x++) {
        const [sx, sy] = from(x, y);
        out.data.set(image.data.subarray((sy * image.width + sx) * 4, (sy * image.width + sx + 1) * 4), (y * image.width + x) * 4);
      }
    }
    return out;
  };
  const capture = view(160, 90);
  const canvas = view(32, 18);
  assert.equal(blockMismatch(canvas, capture, 4), 0);
  const upsideDown = moved(canvas, (x, y) => [x, 17 - y]);
  assert.ok(blockMismatch(upsideDown, capture, 1) < 1e-9, 'upside down, the mean colour stays');
  assert.ok(blockMismatch(upsideDown, capture, 4) > 100);
  const shifted = moved(canvas, (x, y) => [Math.max(x - 8, 0), y]); // a quarter of the width to the right
  assert.ok(blockMismatch(shifted, capture, 4) > 80);
});

test('a final teardown may leave the canvas and nothing else', () => {
  const canvasBytes = 640 * 360 * 4;
  const none = { Texture: 0, RenderTarget: 0, Buffer: 0, QuerySet: 0, Pipeline: 0, ShaderModule: 0 };
  const clean = { objects: none, textureBytes: 0, renderTargetBytes: canvasBytes, canvasBytes, bufferBytes: 0, sceneObjects: 0 };
  assert.deepEqual(teardownLeftovers(clean), []);
  const left = { ...clean, objects: { ...none, Buffer: 1, ShaderModule: 21 }, renderTargetBytes: canvasBytes + 4096, bufferBytes: 464, sceneObjects: 3 };
  assert.deepEqual(teardownLeftovers(left), ['1 Buffer', '21 ShaderModule', '4 KB render targets', '1 KB buffers', '3 object(s) left in the scene']);
});

const BENCH_SUMMARY = ['Tropical Island benchmark', 'build      abc', 'gpu        Test GPU', 'browser    Test', 'screen     640×360', 'preset     high (MSAA 4)'].join('\n');
const BENCH_VIEWS = [
  { name: 'beach', position: [3.11, 2.64, -11.59] },
  { name: 'overview', position: [-411.46, 1078.81, -120.56] },
];
const benchRow = (name) => ({ view: name, frameMs: [16.7, 16.6], counts: { drawCalls: 4 }, camera: BENCH_VIEWS.find((v) => v.name === name).position.slice() });
const benchTexts = (problems) => problems.map((p) => p.text);

test('a benchmark result must cover every view and say where it ran', () => {
  assert.deepEqual(benchmarkProblems(BENCH_SUMMARY, [benchRow('beach'), benchRow('overview')], BENCH_VIEWS), []);
  assert.deepEqual(benchTexts(benchmarkProblems(BENCH_SUMMARY, [benchRow('beach')], BENCH_VIEWS)), ['measured views beach, expected beach, overview']);
  assert.deepEqual(benchTexts(benchmarkProblems(BENCH_SUMMARY, [benchRow('overview'), benchRow('beach')], BENCH_VIEWS)), ['measured views overview, beach, expected beach, overview']);
  for (const counts of [null, { drawCalls: 0 }]) {
    assert.deepEqual(benchTexts(benchmarkProblems(BENCH_SUMMARY, [{ ...benchRow('beach'), counts }], BENCH_VIEWS.slice(0, 1))), ['no GPU counts for beach']);
  }
});

test('a benchmark row needs frame times, every one a positive finite number', () => {
  for (const frameMs of [[], [16.7, NaN], [16.7, 0], [-16.7], [16.7, Infinity], [null]]) {
    const problems = benchTexts(benchmarkProblems(BENCH_SUMMARY, [{ ...benchRow('beach'), frameMs }], BENCH_VIEWS.slice(0, 1)));
    assert.deepEqual(problems, ['no valid frame times for beach'], `frame times ${frameMs}`);
  }
  assert.deepEqual(benchmarkProblems(BENCH_SUMMARY, [{ ...benchRow('beach'), frameMs: [0.01] }], BENCH_VIEWS.slice(0, 1)), []);
});

test('the benchmark summary needs each of its lines, with a value, at the start of a line', () => {
  const rows = [benchRow('beach')];
  const views = BENCH_VIEWS.slice(0, 1);
  for (const line of ['build', 'gpu', 'browser', 'screen', 'preset']) {
    const without = BENCH_SUMMARY.split('\n').filter((l) => !l.startsWith(line)).join('\n');
    assert.deepEqual(benchTexts(benchmarkProblems(without, rows, views)), [`the summary has no "${line}" line`]);
    const empty = BENCH_SUMMARY.replace(new RegExp(`^${line} .*$`, 'm'), `${line}      `);
    assert.deepEqual(benchTexts(benchmarkProblems(empty, rows, views)), [`the summary has no "${line}" line`], `an empty ${line} line`);
    const inside = BENCH_SUMMARY.replace(new RegExp(`^${line} `, 'm'), `the ${line} `);
    assert.deepEqual(benchTexts(benchmarkProblems(inside, rows, views)), [`the summary has no "${line}" line`], `${line} inside a line`);
  }
});

test("each benchmark row must be measured from its view's position", () => {
  // A benchmark that never moves the camera measures every view from the first.
  const stuck = BENCH_VIEWS.map((v) => ({ ...benchRow(v.name), camera: BENCH_VIEWS[0].position.slice() }));
  assert.deepEqual(benchTexts(benchmarkProblems(BENCH_SUMMARY, stuck, BENCH_VIEWS)), ['overview was measured from 3.11, 2.64, -11.59, not from the view at -411.46, 1078.81, -120.56']);
  const missing = [benchRow('beach'), { ...benchRow('overview'), camera: undefined }];
  assert.deepEqual(benchTexts(benchmarkProblems(BENCH_SUMMARY, missing, BENCH_VIEWS)), ['overview was measured from nowhere, not from the view at -411.46, 1078.81, -120.56']);
  assert.equal(benchmarkProblems(BENCH_SUMMARY, [{ ...benchRow('beach'), camera: [3.11, 2.66, -11.59] }], BENCH_VIEWS.slice(0, 1)).length, 1);
  assert.deepEqual(benchmarkProblems(BENCH_SUMMARY, [{ ...benchRow('beach'), camera: [3.111, 2.64, -11.59] }], BENCH_VIEWS.slice(0, 1)), []);
});

test('warnings read as sentences with units', () => {
  assert.equal(describeWarning({ metric: 'frameMs', value: 1240.4, limit: 1000 }), 'capture time per frame 1240 ms is over the limit of 1000 ms');
  assert.equal(describeWarning({ metric: 'bandingPercent', value: 2.5, limit: 1 }), 'banding 2.50% is over the limit of 1.00%');
  assert.equal(describeWarning({ metric: 'unknown', value: 3, limit: 2 }), 'unknown 3 is over the limit of 2');
});

// ---------------------------------------------------------------- launch errors

// Trimmed from a real launch on a bare Ubuntu 24.04 container.
const MISSING_LIB = [
  'browserType.launch: Target page, context or browser has been closed',
  'Browser logs:',
  '',
  '<launched> pid=83',
  '[pid=83][err] /root/.cache/ms-playwright/chromium_headless_shell-1248/chrome-headless-shell-linux64/chrome-headless-shell: ' +
    'error while loading shared libraries: libglib-2.0.so.0: cannot open shared object file: No such file or directory',
  'Call log:',
].join('\n');

test('a launch that dies on a missing library names it and the fix', () => {
  const text = explainLaunchError(MISSING_LIB);
  assert.match(text, /missing system library libglib-2\.0\.so\.0\b/);
  assert.match(text, /npx playwright install-deps chromium/);
  assert.doesNotMatch(text, /\n/);
});

test('a missing browser points at the install command', () => {
  const text = explainLaunchError("browserType.launch: Executable doesn't exist at /root/.cache/ms-playwright/x/chrome-headless-shell\n╔══╗");
  assert.match(text, /npx playwright install --only-shell chromium/);
});

test('other launch errors keep only their first line', () => {
  assert.equal(explainLaunchError('no WebGL2 context'), 'no WebGL2 context');
  assert.equal(explainLaunchError('first line\nsecond line'), 'first line');
});

// ---------------------------------------------------------------- compare warnings

const info = {
  gl: 'ANGLE (Google, Vulkan 1.3.0 (SwiftShader Device (Subzero) (0x0000C0DE)), SwiftShader driver)',
  browser: '156.0.8078.4',
  size: [1600, 900],
  params: { capture: '1' },
};
const side = (overrides) => ({ info: { ...info, ...overrides } });

test('matching captures compare without warnings', () => {
  assert.deepEqual(mismatchWarnings([side({}), side({})]), []);
});

test('every differing capture setting is warned about', () => {
  const warnings = mismatchWarnings([
    side({}),
    side({ gl: 'ANGLE (NVIDIA, D3D11)', browser: '157.0.1.0', size: [800, 450], params: { capture: '1', t: '3' } }),
  ]);
  assert.equal(warnings.length, 4);
  assert.match(warnings.join('\n'), /GL backends/);
  assert.match(warnings.join('\n'), /Chromium builds: 156\.0\.8078\.4 vs 157\.0\.1\.0/);
  assert.match(warnings.join('\n'), /sizes/);
  assert.match(warnings.join('\n'), /params/);
});

test('captures from before the Chromium build was recorded still get a warning', () => {
  const old = side({});
  delete old.info.browser;
  assert.match(mismatchWarnings([old, side({})]).join('\n'), /Chromium builds: unknown vs 156/);
});

test('a missing info.json is reported instead of guessed', () => {
  assert.match(mismatchWarnings([{ info: null }, side({})])[0], /info\.json missing/);
});

// ---------------------------------------------------------------- compare sides and the contact sheet

// A capture as screenshots/<folder>/ holds it: info.json listing `listed`, and the stills in `saved`.
function fakeCapture(shots, folder, listed, saved) {
  mkdirSync(join(shots, folder), { recursive: true });
  const results = listed.map((view) => ({ view, file: `${view}.png`, problems: [] }));
  writeFileSync(join(shots, folder, 'info.json'), JSON.stringify({ ...info, results }));
  for (const view of saved) writeFileSync(join(shots, folder, `${view}.png`), '');
  return results;
}

test('compare finds a capture by its label as the capture wrote it, and says when there is none', (t) => {
  const shots = scratch(t);
  fakeCapture(shots, 'my-run', ['beach'], ['beach']);
  const found = readCapture('my run', shots);
  assert.equal(found.dir, join(shots, 'my-run'));
  assert.deepEqual([...found.pngs], ['beach.png']);
  assert.throws(() => readCapture('other', shots), /no capture labelled "other": .*other does not exist/);
});

test('compare refuses labels that name no capture of their own', (t) => {
  const shots = join(scratch(t), 'screenshots');
  mkdirSync(join(shots, 'compare'), { recursive: true });
  for (const label of ['..', '.', '', 'compare', 'MAP']) assert.throws(() => readCapture(label, shots), /label/, label);
});

test("a view without a still is missing from compare's and the contact sheet's files, not a crash", (t) => {
  const shots = scratch(t);
  const results = fakeCapture(shots, 'run', ['beach', 'lagoon'], ['lagoon']); // beach failed before its still
  assert.deepEqual([...readCapture('run', shots).pngs], ['lagoon.png']);
  assert.deepEqual([...sheetFiles(join(shots, 'run'), results).keys()], ['/lagoon.png']);
});

// ---------------------------------------------------------------- arguments

test('options parse in both --key value and --key=value form', () => {
  assert.deepEqual(parseArgs(['--views', 'beach,overview', '--label=before', '--gl', 'swiftshader']), {
    views: 'beach,overview',
    label: 'before',
    gl: 'swiftshader',
  });
});

test('--checks is a flag without a value', () => {
  assert.deepEqual(parseArgs(['--checks', '--gl', 'swiftshader']), { checks: true, gl: 'swiftshader' });
  assert.throws(() => parseArgs(['--checks=yes']), /--checks takes no value/);
});

test('--compare takes two labels', () => {
  assert.deepEqual(parseArgs(['--compare', 'before', 'after']), { compare: ['before', 'after'] });
  assert.throws(() => parseArgs(['--compare', 'before']), /usage: --compare/);
  assert.throws(() => parseArgs(['--compare', 'before', '--label']), /usage: --compare/);
});

test('unknown options, missing values and stray arguments fail', () => {
  assert.throws(() => parseArgs(['--colour', 'red']), /unknown option --colour/);
  assert.throws(() => parseArgs(['--label']), /--label needs a value/);
  assert.throws(() => parseArgs(['--label', '--views', 'beach']), /--label needs a value/);
  assert.throws(() => parseArgs(['beach']), /unexpected argument "beach"/);
});

// ---------------------------------------------------------------- labels

// Labels that try to leave screenshots/, or to land on it or on a folder of the tools'.
const BAD_LABELS = ['..', '.', '', '...', '../../..', '-', '_', './', '/', '\\', 'compare', 'Compare', 'COMPARE.', 'map', 'Map..'];

test('a label names one folder of its own in screenshots/', () => {
  assert.equal(labelFolder('before'), 'before');
  assert.equal(labelFolder('my run: 2'), 'my-run-2');
  assert.equal(labelFolder('v1.2_rc-3'), 'v1.2_rc-3');
  assert.equal(labelFolder('after.'), 'after', 'Windows drops trailing dots');
  const shots = resolve('screenshots');
  for (const label of ['../x', '..\\x', 'a/../..', '..a', 'C:\\Windows', '/etc', 'compare/../..', '.git', 'mapper']) {
    const folder = labelFolder(label);
    assert.equal(dirname(resolve(shots, folder)), shots, `${label} -> ${folder}`);
  }
});

test('labels without a letter or digit, or naming a folder of the tools, are refused in any case', () => {
  for (const label of BAD_LABELS) assert.throws(() => labelFolder(label), /needs a letter or a digit|is taken/, JSON.stringify(label));
});

test('only a capture\'s own folder right inside screenshots/ can be deleted', (t) => {
  const root = scratch(t);
  const shots = join(root, 'screenshots');
  const keep = join(root, 'keep.txt'); // stands for the repo: it must survive
  writeFileSync(keep, '');
  for (const name of ['compare', 'map', 'mine/nested']) mkdirSync(join(shots, name), { recursive: true });
  for (const dir of ['..', '.', '', 'compare', 'MAP', 'mine/nested', '../keep.txt', 'a/../..'].map((p) => join(shots, p)).concat(root, shots)) {
    assert.throws(() => removeCapture(dir, shots), /refusing to delete/, dir);
  }
  assert.ok(existsSync(keep) && existsSync(join(shots, 'compare')) && existsSync(join(shots, 'map')) && existsSync(join(shots, 'mine', 'nested')));
  removeCapture(join(shots, 'mine'), shots);
  assert.ok(!existsSync(join(shots, 'mine')));
  removeCapture(join(shots, 'never-made'), shots); // nothing to delete is fine
});

// ---------------------------------------------------------------- capture args

test('the args of a capture become its views, size, label and page params', () => {
  const plan = planCapture({ views: 'beach,shoreline', size: '320x180', label: 'my run', t: '2.5', time: 'sunset', quality: 'low', tonemap: 'agx', exposure: '1.5', gl: 'swiftshader' });
  assert.deepEqual(plan.views.map((v) => v.name), ['beach', 'shoreline']);
  assert.deepEqual([plan.width, plan.height, plan.label], [320, 180, 'my-run']);
  assert.deepEqual(plan.query, { capture: '1', t: '2.5', time: 'sunset', quality: 'low', tonemap: 'agx', exposure: '1.5' });
});

test('every arg a capture can get wrong fails before it deletes anything', () => {
  const ok = { label: 'test' };
  const cases = [
    [{ views: 'beach,nowhere' }, /Unknown view "nowhere"/],
    [{ size: '1600*900' }, /--size/],
    [{ label: '..' }, /needs a letter or a digit/],
    [{ label: 'compare' }, /is taken/],
    [{ gl: 'opengl' }, /--gl/],
    [{ t: 'soon' }, /t=soon/],
    [{ t: '-1' }, /t=-1/],
    [{ time: 'midnight' }, /time=midnight/],
    [{ time: '23' }, /time=23/],
    [{ exposure: '0' }, /exposure=0/],
    [{ quality: 'ultra' }, /--quality/],
    [{ quality: 'constructor' }, /--quality/],
    [{ tonemap: 'toString' }, /--tonemap/],
  ];
  for (const [args, error] of cases) assert.throws(() => planCapture({ ...ok, ...args }), error, JSON.stringify(args));
});

// ---------------------------------------------------------------- watchdog

const until = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const fakePage = () => ({ closed: false, close() { this.closed = true; return Promise.resolve(); } });

test("a view's watchdog closes its page and the pages opened after it once its time is up", async () => {
  const context = new EventEmitter();
  const [page, later, other] = [fakePage(), fakePage(), fakePage()];
  const dog = watchdog(context, page, 0.05);
  context.emit('page', later);
  await until(100);
  assert.equal(dog.fired, true);
  assert.deepEqual([page.closed, later.closed, other.closed], [true, true, false]);
  dog.stop();
  assert.equal(context.listenerCount('page'), 0);
});

test("a page's time limit grows with its frame's pixels beyond the default size, and never shrinks", () => {
  const { viewSeconds } = config.capture.timeouts;
  assert.equal(pageLimit({ width: 1600, height: 900 }), viewSeconds);
  assert.equal(pageLimit({ width: 3200, height: 1800 }), 4 * viewSeconds);
  assert.equal(pageLimit({ width: 320, height: 180 }), viewSeconds);
});

test("player mode's page keeps the capture's aspect, so its canvas shows what the capture does", () => {
  assert.deepEqual(playerViewport({ width: 1600, height: 900 }), { width: 320, height: 180 });
  assert.deepEqual(playerViewport({ width: 1200, height: 900 }), { width: 320, height: 240 });
  assert.deepEqual(playerViewport({ width: 1920, height: 1200 }), { width: 320, height: 200 });
  assert.deepEqual(playerViewport({ width: 900, height: 900 }), { width: 320, height: 320 });
});

test('a watchdog stopped in time closes nothing', async () => {
  const context = new EventEmitter();
  const page = fakePage();
  const dog = watchdog(context, page, 0.05);
  dog.stop();
  context.emit('page', fakePage());
  await until(100);
  assert.deepEqual([dog.fired, page.closed], [false, false]);
});

test("a check's watchdog closes the pages the check opened, not those of the check beside it", async () => {
  const context = new EventEmitter();
  context.newPage = async () => {
    const page = fakePage();
    context.emit('page', page);
    return page;
  };
  const own = ownPages(context);
  const page = await own.newPage();
  const dog = watchdog(own, page, 0.05);
  const [later, beside] = [await own.newPage(), await context.newPage()];
  await until(100);
  assert.equal(dog.fired, true);
  assert.deepEqual([page.closed, later.closed, beside.closed], [true, true, false]);
  dog.stop();
  assert.equal(context.listenerCount('page'), 0);
});

// ---------------------------------------------------------------- capture pages

test('a capture page that never got ready says why: crashed, closed, out of time or failed', () => {
  const timeout = Object.assign(new Error('page.waitForFunction: Timeout 180000ms exceeded.'), { name: 'TimeoutError' });
  const closed = new Error('page.waitForFunction: Target page, context or browser has been closed');
  assert.deepEqual(notReady(new Error('page.waitForFunction: Target crashed'), { crashed: true, closed: false }), { kind: 'page crash', text: 'the page crashed before it was ready' });
  assert.deepEqual(notReady(closed, { crashed: false, closed: true }), { kind: 'capture error', text: 'the page was closed before it was ready' });
  assert.deepEqual(notReady(timeout, { crashed: false, closed: false }), { kind: 'timeout', text: 'not ready after 180 s' });
  const failed = notReady(new Error('page.goto: net::ERR_FILE_NOT_FOUND at file:///x\nCall log: ...'), { crashed: false, closed: false });
  assert.deepEqual(failed, { kind: 'capture error', text: 'failed before it was ready: page.goto: net::ERR_FILE_NOT_FOUND at file:///x' });
});

// ---------------------------------------------------------------- blend fixture

// A frame drawn as the blend fixture lays out: two bands, one card with its
// reference, each card colour given per band.
function blendFrame(card, reference, light = [[20, 20, 20], [200, 200, 200]]) {
  const image = createImage(200, 100);
  const set = (x0, x1, y0, y1, c) => {
    for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) image.data.set(c, (y * 200 + x) * 4);
  };
  for (const [k, top] of [[0, 50], [1, 0]]) {
    set(0, 200, top, top + 50, light[k]);
    set(40, 80, top, top + 50, card[k]);
    set(140, 180, top, top + 50, reference[k]);
  }
  return image;
}
const LAYOUT = { bands: 2, spans: [[0.2, 0.4]] };

test('blend mismatch: a card equal to its reference passes, and shows against the light', () => {
  const card = [[10, 10, 10], [120, 100, 90]];
  const { worst, contrast } = blendMismatch(blendFrame(card, card), LAYOUT);
  assert.equal(worst, 0);
  assert.equal(contrast, 110);
});

test('blend mismatch: the largest difference of any band and channel counts', () => {
  const { worst } = blendMismatch(blendFrame([[10, 10, 10], [120, 100, 90]], [[10, 10, 10], [120, 100, 160]]), LAYOUT);
  assert.equal(worst, 70);
});

test('blend mismatch: a missing card shows no contrast', () => {
  const light = [[20, 20, 20], [200, 200, 200]];
  assert.equal(blendMismatch(blendFrame(light, light, light), LAYOUT).contrast, 0);
});

// ---------------------------------------------------------------- maths fixture

// What the maths fixture would read back from a GPU that agrees with sky/light.js.
function mathsAnswers({ skyView = 0.001, aerial = 0.002, multiscatter = 0.003 } = {}) {
  const values = new Array(4 * texelCount).fill(0);
  const unit = (d) => d.map((v) => v / Math.hypot(...d));
  directions.forEach((d, j) => {
    shBasis(unit(d)).forEach((b, k) => (values[4 * (texels.basis + 9 * j + k)] = b));
    values.splice(4 * (texels.irradiance + j), 3, ...shIrradiance(coefficients, unit(d)));
  });
  values[4 * texels.skyView] = skyView;
  values[4 * texels.aerial] = aerial;
  values[4 * texels.multiscatter] = multiscatter;
  return values;
}

test('maths mismatch: answers that agree with sky/light.js come out near zero', () => {
  const m = mathsMismatch(mathsAnswers());
  assert.ok(m.basis < 1e-12 && m.irradiance < 1e-12, JSON.stringify(m));
  assert.equal(m.skyView, 0.001);
  assert.equal(m.aerial, 0.002);
  assert.equal(m.multiscatter, 0.003);
});

test('maths mismatch: a wrong basis value or irradiance shows', () => {
  const values = mathsAnswers();
  values[4 * (texels.basis + 2)] += 0.3;
  values[4 * texels.irradiance + 1] *= 1.01;
  const m = mathsMismatch(values);
  assert.ok(Math.abs(m.basis - 0.3) < 1e-9);
  assert.ok(m.irradiance > 0.005, `irradiance ${m.irradiance}`);
});

// ---------------------------------------------------------------- haze fixture

const goodHaze = { aerial: 1, skyView: 0.5, skyLight: 4, sunlight: 1, noHaze: 150, seaLevel: 40, dimSkyLight: 15, seaLevelSun: 30, sun: { 50: 1.15, 300: 1.6 } };

test('haze problems: small misses and visible mistakes pass', () => {
  assert.deepEqual(Object.keys(goodHaze).slice(0, -1), hazeAnswers);
  assert.deepEqual(hazeProblems(goodHaze, 6, { high: true }), []);
});

test('haze problems: a miss over the limit fails, and so does a mistake the measure cannot see', () => {
  assert.match(hazeProblems({ ...goodHaze, aerial: 9 }, 6).join(), /aerial off by 9\.0/);
  assert.match(hazeProblems({ ...goodHaze, dimSkyLight: 3 }, 6).join(), /dimSkyLight .*misses it/);
  assert.match(hazeProblems({ ...goodHaze, sunlight: 7 }, 6).join(), /sunlight off by 7\.0/);
  assert.match(hazeProblems({ ...goodHaze, seaLevelSun: 2 }, 6).join(), /seaLevelSun .*misses it/);
  assert.match(hazeProblems({ ...goodHaze, skyView: NaN }, 6).join(), /skyView/);
});

test('haze problems: the sunlight must grow with height', () => {
  assert.match(hazeProblems({ ...goodHaze, sun: { 50: 0.9, 300: 1.2 } }, 6).join(), /at 50 m .*less than lower down/);
  assert.match(hazeProblems({ ...goodHaze, sun: { 50: 1.5, 300: 1.2 } }, 6).join(), /at 300 m/);
  assert.match(hazeProblems({ ...goodHaze, sun: {} }, 6).join(), /no sunlight/);
});

test('haze problems: in the last minutes of daylight only the sunlight is judged', () => {
  assert.deepEqual(hazeProblems({ ...goodHaze, aerial: 9, noHaze: 1 }, 6, { sunOnly: true }), []);
  assert.match(hazeProblems({ ...goodHaze, sunlight: 9 }, 6, { sunOnly: true }).join(), /sunlight off/);
});

test('haze problems: tables made at sea level only have to show from high up', () => {
  const low = { ...goodHaze, seaLevel: 0.5 };
  assert.deepEqual(hazeProblems(low, 6), []);
  assert.match(hazeProblems(low, 6, { high: true }).join(), /seaLevel/);
});

// ---------------------------------------------------------------- terrain fixture

const goodTerrain = {
  gpu: 5e-5,
  mistaken: 1.6,
  ground: { gpu: 0.3, mistaken: 9 },
  mesh: { points: 3000, gpu: 2e-4, mistaken: 3 },
  bounce: { points: 1024, gpu: 1e-3, mistaken: 0.1 },
  wet: { points: 256, gpu: 1e-7, mistaken: 0.2 },
  far: { points: 512, lod: 7, gpu: 0.2, mistaken: 30 },
  island: [1, 2, 4, 8].map((texel) => ({ texel, median: 0.004 * texel })),
};
const terrainLimits = { limit: 0.002, islandMedian: 0.04, mesh: 0.01, bounce: 0.01, wet: 0.001 };

test('terrain problems: heights and ground that agree pass', () => {
  assert.deepEqual(terrainProblems(goodTerrain, terrainLimits), []);
});

test('terrain problems: a GPU off, a mistake the check misses, or ground far from the island fail', () => {
  assert.match(terrainProblems({ ...goodTerrain, gpu: 0.01 }, terrainLimits).join(), /GPU vs world\/heightmap\.js off/);
  assert.match(terrainProblems({ ...goodTerrain, mistaken: 1e-4 }, terrainLimits).join(), /misses it/);
  const shifted = { ...goodTerrain, island: goodTerrain.island.map((l) => ({ ...l, median: 0.1 * l.texel })) };
  assert.equal(terrainProblems(shifted, terrainLimits).length, 4);
  assert.match(terrainProblems({ ...goodTerrain, gpu: NaN }, terrainLimits).join(), /GPU/);
});

test("terrain problems: the GPU's ground off, a mistake in it the check misses, or no ground read fail", () => {
  assert.match(terrainProblems({ ...goodTerrain, ground: { gpu: 1.5, mistaken: 9 } }, terrainLimits).join(), /GPU's ground/);
  assert.match(terrainProblems({ ...goodTerrain, ground: { gpu: 0.3, mistaken: 0.8 } }, terrainLimits).join(), /ground half a metre off .* misses it/);
  assert.equal(terrainProblems({ ...goodTerrain, ground: undefined }, terrainLimits).length, 2);
});

test("terrain problems: the GPU's mesh height off its twin, a mistake the check misses, or no mesh read fail", () => {
  assert.match(terrainProblems({ ...goodTerrain, mesh: { points: 3000, gpu: 0.05, mistaken: 3 } }, terrainLimits).join(), /mesh height vs/);
  assert.match(terrainProblems({ ...goodTerrain, mesh: { points: 3000, gpu: 1e-4, mistaken: 0.005 } }, terrainLimits).join(), /30 m off .* misses it/);
  assert.equal(terrainProblems({ ...goodTerrain, mesh: undefined }, terrainLimits).length, 2);
});

test("terrain problems: the light from below's albedo off JS's, a mistake in its layout the check misses, or no albedo read fail", () => {
  assert.match(terrainProblems({ ...goodTerrain, bounce: { points: 1024, gpu: 0.05, mistaken: 0.1 } }, terrainLimits).join(), /albedo the GPU's light from below reads/);
  assert.match(terrainProblems({ ...goodTerrain, bounce: { points: 1024, gpu: 1e-3, mistaken: 0.004 } }, terrainLimits).join(), /half a texel off .* misses it/);
  assert.equal(terrainProblems({ ...goodTerrain, bounce: undefined }, terrainLimits).length, 2);
  assert.equal(terrainProblems({ ...goodTerrain, bounce: { points: 1024, gpu: NaN, mistaken: NaN } }, terrainLimits).length, 2);
});

test("terrain problems: the ground's wetness off its JS twin, a mistake in it the check misses, or no wetness read fail", () => {
  assert.match(terrainProblems({ ...goodTerrain, wet: { points: 256, gpu: 0.03, mistaken: 0.2 } }, terrainLimits).join(), /wetness on the GPU vs world\/albedo\.js sandWetness/);
  assert.match(terrainProblems({ ...goodTerrain, wet: { points: 256, gpu: 1e-7, mistaken: 1e-4 } }, terrainLimits).join(), /5 cm off .* misses it/);
  assert.equal(terrainProblems({ ...goodTerrain, wet: undefined }, terrainLimits).length, 2);
});

test("terrain problems: the far ground off JS's mipmaps, a mistake in them the check misses, or no far read fail", () => {
  assert.match(terrainProblems({ ...goodTerrain, far: { ...goodTerrain.far, gpu: 1.4 } }, terrainLimits).join(), /far ground the GPU reads/);
  assert.match(terrainProblems({ ...goodTerrain, far: { ...goodTerrain.far, mistaken: 0.6 } }, terrainLimits).join(), /quarter of a texel off .* misses it/);
  assert.equal(terrainProblems({ ...goodTerrain, far: undefined }, terrainLimits).length, 2);
  assert.equal(terrainProblems({ ...goodTerrain, far: { points: 512, lod: 7, gpu: NaN, mistaken: NaN } }, terrainLimits).length, 2);
});

// ---------------------------------------------------------------- rocks fixture

const goodRocks = { rocks: 690, cameras: 14, offsets: { points: 80000, gpu: 3e-4, mistaken: 5 }, vertices: { rocks: 336, pixels: 84000, gpu: 1.5e-4, mistaken: 1.9 } };
const rockLimits = { offsets: 0.01, vertices: 0.01, pixels: 20000 };

test('rock problems: offsets and vertices that agree with their twins pass', () => {
  assert.deepEqual(rockProblems(goodRocks, rockLimits), []);
});

test('rock problems: GPU offsets or vertices off, mistakes the check misses, too few pixels or no answer fail', () => {
  assert.match(rockProblems({ ...goodRocks, offsets: { ...goodRocks.offsets, gpu: 0.05 } }, rockLimits).join(), /offsets vs their JS twin/);
  assert.match(rockProblems({ ...goodRocks, offsets: { ...goodRocks.offsets, mistaken: 0.001 } }, rockLimits).join(), /next rock's .* misses it/);
  assert.match(rockProblems({ ...goodRocks, vertices: { ...goodRocks.vertices, gpu: 0.02 } }, rockLimits).join(), /rocks.wgsl draws rocks/);
  assert.match(rockProblems({ ...goodRocks, vertices: { ...goodRocks.vertices, mistaken: 0.002 } }, rockLimits).join(), /wrong way .* misses it/);
  assert.match(rockProblems({ ...goodRocks, vertices: { ...goodRocks.vertices, pixels: 100 } }, rockLimits).join(), /measures too little/);
  assert.match(rockProblems({ ...goodRocks, vertices: { ...goodRocks.vertices, gpu: NaN } }, rockLimits).join(), /rocks.wgsl/);
  assert.equal(rockProblems(undefined, rockLimits).length, 5);
});

// ---------------------------------------------------------------- surfaces fixture

const goodTiles = { grain: { whole: 0.001, half: 0.95 }, ripples: { whole: 0, half: 0.9 }, rock: { whole: 0.002, half: 0.97 }, grass: { whole: 0, half: 0.8 }, litter: { whole: 0, half: 0.95 } };
const tileLimits = { share: 0.01, mistaken: 0.3, tiles: ['grain', 'ripples', 'rock', 'grass', 'litter'] };

test('surface problems: tiles that repeat pass', () => {
  assert.deepEqual(surfaceProblems(goodTiles, tileLimits), []);
});

test("surface problems: a tile that doesn't repeat, a check that can't see it, or no answer fail", () => {
  assert.match(surfaceProblems({ ...goodTiles, ripples: { whole: 0.4, half: 0.9 } }, tileLimits).join(), /ripples tile doesn't repeat/);
  assert.match(surfaceProblems({ ...goodTiles, grain: { whole: 0, half: 0.1 } }, tileLimits).join(), /grain tile .* misses it/);
  assert.match(surfaceProblems({ ...goodTiles, rock: { whole: 0.2, half: 0.97 } }, tileLimits).join(), /rock tile doesn't repeat/);
  assert.match(surfaceProblems({ ...goodTiles, litter: { whole: 0.1, half: 0.95 } }, tileLimits).join(), /litter tile doesn't repeat/);
  assert.match(surfaceProblems({ ...goodTiles, grass: { whole: 0, half: 0 } }, tileLimits).join(), /grass tile .* misses it/);
  assert.equal(surfaceProblems(undefined, tileLimits).length, 10);
});

test('patches problems: GPU patches on their twin pass; off it, a check that misses its mistake, or no answer fail', () => {
  const limits = { limit: 0.002, seen: { share: 0.15, albedo: 0.15 } };
  const seen = { cells: 1024, share: 0.06, albedo: 0.07, mistaken: { share: 0.9, albedo: 0.6 } };
  const good = { points: 1024, gpu: 3e-4, mistaken: 0.6, seen };
  assert.deepEqual(patchesProblems(good, limits), []);
  assert.match(patchesProblems({ ...good, gpu: 0.4 }, limits).join(), /GPU vs world\/green\.js off/);
  assert.match(patchesProblems({ ...good, mistaken: 1e-4 }, limits).join(), /misses it/);
  assert.equal(patchesProblems(undefined, limits).length, 6);
  assert.match(patchesProblems({ ...good, gpu: NaN }, limits).join(), /GPU/);
});

test('patches problems: the green seen the same from near and far passes; changed by the camera, or a check that misses its mistake, fails', () => {
  const limits = { limit: 0.002, seen: { share: 0.15, albedo: 0.15 } };
  const seen = { cells: 1024, share: 0.06, albedo: 0.07, mistaken: { share: 0.9, albedo: 0.6 } };
  const good = { points: 1024, gpu: 3e-4, mistaken: 0.6, seen };
  assert.match(patchesProblems({ ...good, seen: { ...seen, share: 0.48 } }, limits).join(), /camera stands: the sand's share/);
  assert.match(patchesProblems({ ...good, seen: { ...seen, albedo: 0.5 } }, limits).join(), /camera stands: the albedo/);
  assert.match(patchesProblems({ ...good, seen: { ...seen, mistaken: { share: 0.9, albedo: 0.1 } } }, limits).join(), /albedo only .* misses it/);
  assert.match(patchesProblems({ ...good, seen: { ...seen, share: NaN } }, limits).join(), /sand's share/);
  assert.equal(patchesProblems({ ...good, seen: undefined }, limits).length, 4);
});

test("green-tiles problems: the tiles' averages on their twin and the green near the camera on its albedo pass; off them, lifted either way, a check that misses its mistakes, or no answer fail", () => {
  const limits = { layers: 0.01, lift: 0.015, between: 0.04 };
  const at = (lift) => ({ lift, at: 'the scrub, pixels 6 mm across' });
  const good = { points: 65536, footprints: 7, layers: { gpu: 0.002, mistaken: 0.19 }, lifts: { sharp: at(0.01), between: at(-0.03), mistaken: at(0.11) } };
  const lifts = (key, lift) => ({ ...good, lifts: { ...good.lifts, [key]: at(lift) } });
  assert.deepEqual(greenTilesProblems(good, limits), []);
  assert.match(greenTilesProblems({ ...good, layers: { gpu: 0.02, mistaken: 0.19 } }, limits).join(), /greenLayers off/);
  assert.match(greenTilesProblems({ ...good, layers: { gpu: 0.002, mistaken: 0.005 } }, limits).join(), /nothing between the covers .* misses it/);
  assert.match(greenTilesProblems(lifts('sharp', 0.039), limits).join(), /reads 3\.9% off its albedo at the scrub, pixels 6 mm across \(limit 1\.5%\)/);
  assert.match(greenTilesProblems(lifts('sharp', -0.02), limits).join(), /reads -2\.0% off/);
  assert.match(greenTilesProblems(lifts('between', 0.051), limits).join(), /sees a few leaves/);
  assert.match(greenTilesProblems(lifts('mistaken', 0.02), limits).join(), /half their share .* misses it/);
  assert.equal(greenTilesProblems(undefined, limits).length, 5);
  assert.match(greenTilesProblems(lifts('sharp', NaN), limits).join(), /near the camera/);
});

// ---------------------------------------------------------------- time check

test('time check: four views in a row visit every named time, never their own', () => {
  const names = Object.keys(sunPath.times);
  for (const hours of [sunPath.times.midday, sunPath.times.sunset, 9.5, 14]) {
    const targets = views.slice(0, 4).map((view) => timeChangeTarget(view.name, hours));
    for (const name of targets) assert.ok(Math.abs(sunPath.times[name] - hours) > 0.5, `${name} from ${hours} h`);
    const own = names.filter((n) => Math.abs(sunPath.times[n] - hours) <= 0.5);
    assert.deepEqual(new Set(targets), new Set(names.filter((n) => !own.includes(n))), `from ${hours} h`);
  }
});

test('time check: a full run of the views, each at its own time, covers every named time', () => {
  const own = (view) => sunPath.toHours(view.timeOfDay ?? config.defaults.timeOfDay);
  const targets = views.map((view) => timeChangeTarget(view.name, own(view)));
  views.forEach((view, i) => assert.ok(Math.abs(sunPath.times[targets[i]] - own(view)) > 0.5, `${view.name} to ${targets[i]}`));
  assert.deepEqual(new Set(targets), new Set(Object.keys(sunPath.times)));
});
