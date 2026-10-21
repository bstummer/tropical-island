import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

// npm test runs `node --test`, which runs every file matching Node's default
// test patterns anywhere outside node_modules: *.test.js, *-test.js,
// *_test.js, test-*.js, test.js, and any .js under a folder named test. A
// module named like one (src/plants/alpha-test.js) would run as a test.
const RUNS_AS_TEST = /(^|\/)(test|test-[^/]*|[^/]*[._-]test)\.[cm]?js$|(^|\/)test\/.*\.[cm]?js$/;

function files(dir, skip) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (!entry.isDirectory()) return [relative(ROOT, path).replaceAll('\\', '/')];
    return skip.has(entry.name) ? [] : files(path, skip);
  });
}

test('only tests/ holds files that node --test runs', () => {
  const misnamed = files(ROOT, new Set(['node_modules', '.git', 'tests'])).filter((f) => RUNS_AS_TEST.test(f));
  assert.deepEqual(misnamed, []);
});

test('the pattern matches what node --test runs, and not other names', () => {
  for (const name of ['a.test.js', 'src/plants/alpha-test.js', 'b_test.mjs', 'test-c.js', 'tools/test.js', 'src/test/d.js']) {
    assert.match(name, RUNS_AS_TEST, name);
  }
  for (const name of ['src/contest.js', 'tools/testing.js', 'src/latest.js', 'tools/check-build.js', 'src/tested/x.glsl']) {
    assert.doesNotMatch(name, RUNS_AS_TEST, name);
  }
});
