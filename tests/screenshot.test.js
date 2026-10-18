import test from 'node:test';
import assert from 'node:assert/strict';
import { explainLaunchError, mismatchWarnings, parseArgs } from '../tools/screenshot.js';

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
