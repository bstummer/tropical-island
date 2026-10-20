import test from 'node:test';
import assert from 'node:assert/strict';
import { checkLimits, describeWarning, explainLaunchError, isSameFile, metricChanges, mismatchWarnings, parseArgs } from '../tools/screenshot.js';

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
  const warnings = checkLimits({ captureMs: 15001, drawCalls: 10, triangles: 5 }, { captureMs: 15000, drawCalls: 10 });
  assert.deepEqual(warnings, [{ metric: 'captureMs', value: 15001, limit: 15000 }]);
});

test('missing or non-numeric values and limits never warn', () => {
  assert.deepEqual(checkLimits({ captureMs: null, gpuMs: NaN }, { captureMs: 1, gpuMs: 1 }), []);
  assert.deepEqual(checkLimits({ captureMs: 99 }, {}), []);
});

test('compare lists the numbers that changed, as shown', () => {
  const before = { drawCalls: 3, triangles: 162208, overdraw: 1.891, shimmerPercent: 0.03, gpuMs: null };
  const after = { drawCalls: 5, triangles: 162210, overdraw: 1.8912, shimmerPercent: 0.03, gpuMs: 1.2 };
  assert.deepEqual(metricChanges(before, after), ['draw calls 3 → 5']); // the rest round the same, or is missing on one side
  assert.deepEqual(metricChanges({ textureMB: 10 }, { textureMB: 300 }), ['texture memory 10 MB → 300 MB']);
  assert.deepEqual(metricChanges(undefined, after), []);
});

test('warnings read as sentences with units', () => {
  assert.equal(describeWarning({ metric: 'captureMs', value: 16240, limit: 15000 }), 'capture time 16.2 s is over the limit of 15.0 s');
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
