import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

// npm test runs `node --test`, which runs every file matching Node's default
// test patterns anywhere outside node_modules: *.test.js, *-test.js,
// *_test.js, test-*.js, test.js, and any .js under a folder named test; .cjs
// and .mjs too, and .ts, .cts and .mts where Node strips types (by default
// since 22.18), and on Windows whatever the case. A module named like one
// (src/plants/alpha-test.js) would run as a test.
const RUNS_AS_TEST = /(^|\/)(test|test-[^/]*|[^/]*[._-]test)\.[cm]?[jt]s$|(^|\/)test\/.*\.[cm]?[jt]s$/i;

// Files under root that node --test would run, but those in the top-level
// tests/, where they belong (node --test leaves out node_modules, and .git has none).
function misnamed(root, dir = root) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = relative(root, join(dir, entry.name)).replaceAll('\\', '/');
    if (!entry.isDirectory()) return RUNS_AS_TEST.test(path) ? [path] : [];
    return entry.name === 'node_modules' || entry.name === '.git' || path === 'tests' ? [] : misnamed(root, join(dir, entry.name));
  });
}

test('only tests/ holds files that node --test runs', () => {
  assert.deepEqual(misnamed(ROOT), []);
});

test('the pattern matches what node --test runs, and not other names', () => {
  const runs = ['a.test.js', 'src/plants/alpha-test.js', 'b_test.mjs', 'test-c.js', 'tools/test.js', 'src/test/d.js', 'src/tests/e.test.cjs'];
  for (const name of [...runs, 'f.test.ts', 'g-test.mts', 'h_test.cts', 'test-i.ts', 'test.ts', 'src/test/j.ts', 'src/Test.js', 'k.TEST.js']) {
    assert.match(name, RUNS_AS_TEST, name);
  }
  for (const name of ['src/contest.js', 'tools/testing.js', 'src/latest.js', 'tools/check-build.js', 'src/tested/x.wgsl', 'src/tests/x.js', 'a.spec.js', 'b.test.jsx', 'c.test.tsx', 'types.d.ts']) {
    assert.doesNotMatch(name, RUNS_AS_TEST, name);
  }
});

test('misnamed files are found in any folder but the top-level tests/ and node_modules', (t) => {
  const root = mkdtempSync(join(tmpdir(), 'tropical-layout-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const names = ['tests/a.test.js', 'tests/deep/b.test.js', 'src/tests/c.test.js', 'src/plants/tests/d-test.ts', 'tools/test/e.js'];
  for (const name of [...names, 'node_modules/f.test.js', 'src/node_modules/g.test.js', '.git/h.test.js', 'src/i.js']) {
    mkdirSync(dirname(join(root, name)), { recursive: true });
    writeFileSync(join(root, name), '');
  }
  assert.deepEqual(misnamed(root).sort(), ['src/plants/tests/d-test.ts', 'src/tests/c.test.js', 'tools/test/e.js']);
});
