import test from 'node:test';
import assert from 'node:assert/strict';
import { createImage } from '../tools/image.js';
import { shBasis, shIrradiance } from '../src/sky/light.js';
import { coefficients, directions, texelCount, texels } from '../src/fixtures/maths-cases.js';
import {
  benchmarkProblems,
  blendMismatch,
  checkLimits,
  describeWarning,
  explainLaunchError,
  isSameFile,
  mathsMismatch,
  metricChanges,
  mismatchWarnings,
  parseArgs,
  resourceLeaks,
} from '../tools/screenshot.js';

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

test('resource leaks list what grew, and nothing for what shrank or stayed', () => {
  const MB = 1024 * 1024;
  const before = { objects: { Texture: 5, Buffer: 9, Framebuffer: 2 }, textureBytes: 10 * MB, renderTargetBytes: 50 * MB, bufferBytes: 2 * MB };
  assert.deepEqual(resourceLeaks(before, before), []);
  const after = { objects: { Texture: 7, Buffer: 8, Framebuffer: 2, Query: 1 }, textureBytes: 10.5 * MB, renderTargetBytes: 50 * MB, bufferBytes: 1 * MB };
  assert.deepEqual(resourceLeaks(before, after), ['+2 Texture', '+1 Query', '+512 KB textures']);
  assert.deepEqual(resourceLeaks(before, { ...before, renderTargetBytes: 66.5 * MB }), ['+16.5 MB render targets']);
});

test('a benchmark result must cover every view and say where it ran', () => {
  const summary = ['build      abc', 'gpu        Test GPU', 'browser    Test', 'screen     640×360', 'preset     high (MSAA 4)'].join('\n');
  const result = (view) => ({ view, frameMs: [16.7, 16.6], counts: { drawCalls: 4 } });
  assert.deepEqual(benchmarkProblems(summary, [result('beach'), result('overview')], ['beach', 'overview']), []);

  const texts = (problems) => problems.map((p) => p.text).join('\n');
  assert.match(texts(benchmarkProblems(summary, [result('beach')], ['beach', 'overview'])), /measured views beach, expected beach, overview/);
  assert.match(texts(benchmarkProblems(summary, [{ ...result('beach'), frameMs: [] }], ['beach'])), /no valid frame times for beach/);
  assert.match(texts(benchmarkProblems(summary, [{ ...result('beach'), counts: null }], ['beach'])), /no GPU counts for beach/);
  assert.match(texts(benchmarkProblems(summary.replace('gpu        Test GPU', 'gpu'), [result('beach')], ['beach'])), /no "gpu" line/);
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
function mathsAnswers({ skyView = 0.001, aerial = 0.002 } = {}) {
  const values = new Array(4 * texelCount).fill(0);
  const unit = (d) => d.map((v) => v / Math.hypot(...d));
  directions.forEach((d, j) => {
    shBasis(unit(d)).forEach((b, k) => (values[4 * (texels.basis + 9 * j + k)] = b));
    values.splice(4 * (texels.irradiance + j), 3, ...shIrradiance(coefficients, unit(d)));
  });
  values[4 * texels.skyView] = skyView;
  values[4 * texels.aerial] = aerial;
  return values;
}

test('maths mismatch: answers that agree with sky/light.js come out near zero', () => {
  const m = mathsMismatch(mathsAnswers());
  assert.ok(m.basis < 1e-12 && m.irradiance < 1e-12, JSON.stringify(m));
  assert.equal(m.skyView, 0.001);
  assert.equal(m.aerial, 0.002);
});

test('maths mismatch: a wrong basis value or irradiance shows', () => {
  const values = mathsAnswers();
  values[4 * (texels.basis + 2)] += 0.3;
  values[4 * texels.irradiance + 1] *= 1.01;
  const m = mathsMismatch(values);
  assert.ok(Math.abs(m.basis - 0.3) < 1e-9);
  assert.ok(m.irradiance > 0.005, `irradiance ${m.irradiance}`);
});
