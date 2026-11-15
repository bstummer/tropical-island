import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { folderFor, parseBranches, previews, ROOT_BRANCH } from '../tools/pages.js';

const TOOL = join(dirname(fileURLToPath(import.meta.url)), '..', 'tools', 'pages.js');
const sha = (n) => String(n).repeat(40).slice(0, 40);

// Names git allows, the awkward ones among them.
const NAMES = ['stage-7', 'ci/pages-previews', 'feature/water/foam', 'fix#12', 'a%b', 'café+crème', 'v1.2_rc-3', 'x!/y.z', 'a.b-c.d', 'we\'re-(done)', 'a=b&c;d,e$f'];

test('a branch keeps its name as its folder where that is safe in a URL, and a "/" goes a folder deeper', () => {
  assert.equal(folderFor('stage-7'), 'stage-7');
  assert.equal(folderFor('ci/pages-previews'), 'ci/pages-previews');
  assert.equal(folderFor('feature/water/foam'), 'feature/water/foam');
  assert.equal(folderFor('v1.2_rc-3'), 'v1.2_rc-3');
  assert.equal(folderFor('fix#12'), 'fix-12');
  assert.equal(folderFor('café+crème'), 'caf-cr-me');
});

test('every folder is a path of parts that need no escaping, and none is empty or starts with a dot', () => {
  for (const name of [...NAMES, '.hidden', 'a/..x', '../up']) {
    const parts = folderFor(name).split('/');
    assert.equal(parts.length, name.split('/').length, name);
    for (const part of parts) {
      assert.match(part, /^[\w-][\w.-]*$/, `${name}: ${part}`);
      assert.equal(encodeURIComponent(part), part, `${name}: ${part}`);
    }
  }
});

test('main gets no folder: it is the root', () => {
  const { built, left } = previews([{ name: ROOT_BRANCH, sha: sha(1) }, { name: 'stage-7', sha: sha(2) }]);
  assert.deepEqual(built, [{ branch: 'stage-7', sha: sha(2), folder: 'stage-7' }]);
  assert.deepEqual(left, []);
});

test('every other branch gets a folder of its own, in order of name, whatever order they come in', () => {
  const branches = NAMES.map((name, i) => ({ name, sha: sha(i) }));
  const { built, left } = previews(branches.toReversed());
  assert.deepEqual(left, []);
  assert.deepEqual(built.map((p) => p.branch), [...NAMES].sort());
  assert.equal(new Set(built.map((p) => p.folder)).size, NAMES.length);
  for (const p of built) assert.equal(p.sha, branches.find((b) => b.name === p.branch).sha);
});

test('of two branches whose folders would be the same, the first by name keeps it and the other is left out', () => {
  const { built, left } = previews([{ name: 'a%b', sha: sha(1) }, { name: 'a#b', sha: sha(2) }, { name: 'a-b/c', sha: sha(3) }]);
  assert.deepEqual(built.map((p) => [p.branch, p.folder]), [['a#b', 'a-b'], ['a-b/c', 'a-b/c']]);
  assert.deepEqual(left, [{ branch: 'a%b', reason: "its folder a-b/ would clash with the branch a#b's" }]);
});

test("no folder takes the name of the root's own file", () => {
  const { built, left } = previews([{ name: 'index.html', sha: sha(1) }, { name: 'index.html/x', sha: sha(2) }, { name: 'index', sha: sha(3) }]);
  assert.deepEqual(built.map((p) => p.branch), ['index']);
  assert.deepEqual(left.map((l) => l.branch), ['index.html', 'index.html/x']);
  assert.match(left[0].reason, /the root's index\.html/);
});

test('the branches come in as lines "<sha> <name>"; anything else is an error', () => {
  assert.deepEqual(parseBranches(`${sha(1)} main\n${sha(2)} ci/x\n\n`), [{ name: 'main', sha: sha(1) }, { name: 'ci/x', sha: sha(2) }]);
  assert.deepEqual(parseBranches(''), []);
  assert.throws(() => parseBranches('main'), /not "<sha> <name>"/);
  assert.throws(() => parseBranches(`${sha(1)}`), /not "<sha> <name>"/);
  assert.throws(() => parseBranches(`${sha(1)} a b`), /not "<sha> <name>"/);
});

test("CI's run prints its outputs as GITHUB_OUTPUT takes them, and a warning per branch left out", () => {
  const input = [`${sha(1)} main`, `${sha(2)} stage-7`, `${sha(3)} ci/pages`, `${sha(4)} index.html`].join('\n');
  const run = (own) => spawnSync(process.execPath, [TOOL, own], { input, encoding: 'utf8' });

  const branch = run('ci/pages');
  assert.equal(branch.status, 0, branch.stderr);
  const previews = [{ branch: 'ci/pages', sha: sha(3), folder: 'ci/pages' }, { branch: 'stage-7', sha: sha(2), folder: 'stage-7' }];
  assert.equal(branch.stdout, `previews=${JSON.stringify(previews)}\nfolder=ci/pages/\n`);
  assert.match(branch.stderr, /^::warning::The branch index\.html gets no preview: .*\n$/);

  assert.match(run('main').stdout, /\nfolder=\n$/);
  assert.match(run('index.html').stdout, /\nfolder=\n$/);
  assert.notEqual(spawnSync(process.execPath, [TOOL], { input, encoding: 'utf8' }).status, 0);
});
