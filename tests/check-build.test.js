import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { blankComments, checkBuild, checkHtml, checkModules, checkOutputFiles, checkSize, checkSources, HTML_RULES } from '../tools/check-build.js';

const here = dirname(fileURLToPath(import.meta.url));
const fixtures = join(here, 'fixtures', 'check-build');
const read = (kind, name) => readFileSync(join(fixtures, kind, name), 'utf8');
const ids = (failures) => [...new Set(failures.map((f) => f.rule))].sort();

function tempDir(t, files) {
  const dir = mkdtempSync(join(tmpdir(), 'tropical-check-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  for (const [name, content] of Object.entries(files)) {
    mkdirSync(dirname(join(dir, name)), { recursive: true });
    writeFileSync(join(dir, name), content);
  }
  return dir;
}

// ---------------------------------------------------------------- HTML fixtures

for (const name of readdirSync(join(fixtures, 'pass'))) {
  test(`passes: ${name}`, () => {
    const { failures } = checkHtml(read('pass', name));
    assert.deepEqual(failures, []);
  });
}

// Each fail fixture is named after the one rule it must trip, and trips nothing else.
const failFixtures = readdirSync(join(fixtures, 'fail'));
for (const name of failFixtures) {
  test(`fails: ${name}`, () => {
    const { failures } = checkHtml(read('fail', name));
    assert.deepEqual(ids(failures), [name.replace(/\.html$/, '')]);
    for (const f of failures) assert.match(f.message, /line \d+, col \d+: .*>>>.+<<</);
  });
}

test('every HTML rule has a fail fixture', () => {
  const covered = failFixtures.map((n) => n.replace(/\.html$/, '')).sort();
  assert.deepEqual(covered, HTML_RULES.map((r) => r.id).sort());
});

test('allowed namespaces are counted, not failed', () => {
  const { failures, allowed } = checkHtml(read('pass', 'xml-namespaces.html'));
  assert.deepEqual(failures, []);
  assert.equal(allowed.get('http://www.w3.org/1999/xhtml'), 1);
  assert.equal(allowed.get('http://www.w3.org/2000/svg'), 1);
});

test('lookalike namespace URLs are not allowed', () => {
  const { failures } = checkHtml(read('fail', 'url.html'));
  assert.equal(failures.length, 3);
  assert.ok(failures.some((f) => f.message.includes('www.w3.org.example.net')));
  assert.ok(failures.some((f) => f.message.includes('xhtml/extra')));
});

// ---------------------------------------------------------------- build output files
// vite.config.js rejects any bundle but index.html; checkBuild applies the same rule to dist/.

test('a bundle of only index.html passes', () => {
  assert.deepEqual(checkOutputFiles(['index.html']), []);
});

test('a bundle with extra files fails', () => {
  assert.deepEqual(ids(checkOutputFiles(['index.html', 'assets/app.js'])), ['output-files']);
  assert.deepEqual(ids(checkOutputFiles(['index.html', 'style.css'])), ['output-files']);
});

test('a bundle without index.html fails', () => {
  assert.deepEqual(ids(checkOutputFiles(['main.html'])), ['output-files']);
  assert.deepEqual(ids(checkOutputFiles([])), ['output-files']);
});

test('a bundle made of index.html and src/ alone passes, and of anything else fails', () => {
  const root = 'C:/game';
  const ours = ['C:/game/index.html', 'C:/game/index.html?html-proxy&inline-css&index=0.css', 'C:/game/src/main.js', 'C:/game/src/fixtures/basic.wgsl?raw'];
  assert.deepEqual(checkModules(ours, root), []);
  assert.deepEqual(checkModules(ours, 'C:\\game\\'), [], 'a root with backslashes and a trailing one');
  const others = ['C:/game/node_modules/three/build/three.module.js', '\0vite/preload-helper.js', 'C:/game/tools/png.js', 'C:/game/src-old/x.js', 'C:/game/other.html', 'C:/elsewhere/src/x.js'];
  for (const id of others) {
    const failures = checkModules([...ours, id], root);
    assert.deepEqual(ids(failures), ['bundled-modules'], id);
    assert.ok(failures[0].message.includes(JSON.stringify(id)), id);
  }
});

test('the unbuilt source template fails the HTML checks', () => {
  const template = readFileSync(join(here, '..', 'index.html'), 'utf8');
  assert.deepEqual(ids(checkHtml(template).failures), ['script-src']);
});

// ---------------------------------------------------------------- size budget

test('size: ok up to the budget, warn above it, fail above twice it', () => {
  assert.equal(checkSize(100, 100).level, 'ok');
  assert.equal(checkSize(101, 100).level, 'warn');
  assert.equal(checkSize(200, 100).level, 'warn');
  assert.equal(checkSize(201, 100).level, 'fail');
});

// ---------------------------------------------------------------- source lint

test('source lint flags forbidden time and randomness APIs', (t) => {
  const dir = tempDir(t, {
    'a.js': 'export const x = Math.random();\n',
    'b.js': 'export const now = () => Date.now() + new Date().getTime();\n',
    'c.js': 'export const t = performance.now();\n',
  });
  assert.deepEqual(ids(checkSources(dir)), ['date', 'math-random', 'performance-now']);
  assert.equal(checkSources(dir).filter((f) => f.rule === 'date').length, 2);
});

test('source lint allows performance.now only in core/clock.js', (t) => {
  const dir = tempDir(t, {
    'core/clock.js': 'export const t = () => performance.now();\n',
    'core/other.js': 'export const t = () => performance.now();\n',
  });
  const failures = checkSources(dir);
  assert.equal(failures.length, 1);
  assert.match(failures[0].message, /src\/core\/other\.js/);
});

test('source lint ignores comments and non-JS files', (t) => {
  const dir = tempDir(t, {
    'doc.js': '// Never call Math.random() or Date.now() here.\n/* performance.now() is for clock.js */\nexport {};\n',
    'shader.wgsl': 'float r = Math.random();',
  });
  assert.deepEqual(checkSources(dir), []);
});

test('source lint sees code after comment markers inside strings and regexes', (t) => {
  // A naive stripper reads each marker as the start of a comment: up to the next `*/`, or the line's end.
  const dir = tempDir(t, {
    'glob.js': "const plants = import.meta.glob('./plants/*.js');\nexport const a = Math.random();\n/* the end */\n",
    'url.js': 'const link = "see //example"; export const b = Date.now();\n',
    'regex.js': 'const slashes = /a\\/*b/;\nexport const c = performance.now(); // */\n',
    'template.js': "const path = `src/*`;\nimport { Vector3 } from 'three';\n/* the end */\n",
  });
  assert.deepEqual(ids(checkSources(dir)), ['date', 'math-random', 'own-imports', 'performance-now']);
});

test('source lint lets src/ import only its own files', (t) => {
  const dir = tempDir(t, {
    'world/ok.js': [
      "import { Vector3, Matrix4 as M } from '../maths/index.js';",
      "import shader from './rock.wgsl';",
      "import {\n  a,\n  b,\n} from './x.js';",
      "export { c } from '../core/c.js';",
      'export const later = () => import(`./lazy.js`);',
      `import { "x" as y } from './quoted.js';`,
      "const plants = import.meta.glob(['./plants/*.js', '!./plants/old.js'], { import: 'default', query: '?raw' });",
      "const tiles = import.meta.glob('./tiles/*.js', { 'import': 'default' });",
      "const words = ['import', 'export', 'from'];",
      "loader.import('anything'); const list = Array.from('abc');",
      `import z from "./it's.js";`,
      "const sets = import.meta.glob(['./[ab]/*.js', './c/[0-9]*.js']);",
      "// import { WebGLRenderer } from 'three';",
    ].join('\n'),
    'others.js': "import { three } from './three.js';\nimport { a } from './threejs-like.js';\nexport * from './x.js';\n",
    'maths.js': "import { Vector3 } from 'three';\n",
    'namespace.js': "import * as THREE from 'three';\n",
    'addons.js': "import { OrbitControls } from 'three/addons/controls/OrbitControls.js';\n",
    'bare.js': "import 'three';\nimport fs from 'node:fs';\n",
    'reexport.js': "export * from 'three';\n",
    'tight.js': "import{WebGLRenderer}from'three';\nexport*from\"gsap\";\n",
    'dynamic.js': "export const load = () => import('three');\nexport const later = async () => await import( `three/webgpu` );\n",
    'path.js': "import { Mesh } from '../node_modules/three/build/three.module.js';\nimport { Scene } from '/node_modules/three/src/Three.js';\n",
    'world/out.js': "import { config } from '../../tools/config.js';\nimport { b } from './../../src/b.js';\n",
    'typed.ts': "import { WebGLRenderer } from 'three';\n",
    'quoted.js': `import { "Vector3" as V } from 'three';\nexport { "default" as T } from 'three';\n`,
    'glob.js': [
      "export const maths = import.meta.glob('../node_modules/three/src/math/*.js', { eager: true });",
      "export const plants = import.meta.glob(['./plants/*.js', '../outside/*.js']);",
    ].join('\n'),
    'slashes.js': "import { config } from './\\..\\..\\tools/config.js';\n",
    // Imports inside braces before a later `from`, which a clause can't swallow.
    'nested.js': [
      "export class Loader { static three = import('three') }",
      'export const load = (x) => { return import(`three/webgpu`) }',
      "export const g = { m: import.meta.glob('../outside/*.js') }",
      "export { b } from './b.js';",
    ].join('\n'),
    'names.js': `export * as "ns" from 'three';\nimport { "}" as x } from 'three';\nimport y from "it's/three.js";\n`,
    'generic.ts': "const g = import.meta.glob<string>('../x/*.js');\nconst h = import.meta.glob<Record<string, string>>('../y/*.js');\n",
    'classes.js': "export const a = import.meta.glob(['../../tools/[a-z]*.js']);\nexport const b = import.meta.glob(['./[ab]/*.js', '../../tools/*.js']);\n",
  });
  const failures = checkSources(dir);
  assert.deepEqual(ids(failures), ['own-imports']);
  assert.deepEqual(
    failures.map((f) => f.message.match(/src\/(\S+)/)[1]).sort(),
    [
      ...['addons.js', 'bare.js', 'bare.js', 'classes.js', 'classes.js', 'dynamic.js', 'dynamic.js', 'generic.ts', 'generic.ts', 'glob.js', 'glob.js'],
      ...['maths.js', 'names.js', 'names.js', 'names.js'],
      ...['namespace.js', 'nested.js', 'nested.js', 'nested.js', 'path.js', 'path.js', 'quoted.js', 'quoted.js', 'reexport.js', 'slashes.js'],
      ...['tight.js', 'tight.js', 'typed.ts', 'world/out.js', 'world/out.js'],
    ],
  );
});

test('blankComments keeps offsets and leaves divisions alone', () => {
  const code = 'const a = b / 2; // half\nconst c = (d) / e /* ratio */ + 1;\n';
  const blanked = blankComments(code);
  assert.equal(blanked.length, code.length);
  assert.equal(blanked, 'const a = b / 2;        \nconst c = (d) / e             + 1;\n');
});

test('the real src/ passes the source lint', () => {
  assert.deepEqual(checkSources(join(here, '..', 'src')), []);
});

// ---------------------------------------------------------------- everything together

test('checkBuild combines every check', (t) => {
  const good = tempDir(t, { 'index.html': read('pass', 'minimal.html') });
  const src = tempDir(t, { 'ok.js': 'export {};\n' });
  const report = checkBuild({ distDir: good, srcDir: src, budget: 1024 * 1024 });
  assert.deepEqual(report.failures, []);
  assert.deepEqual(report.warnings, []);
  assert.ok(report.raw > 0 && report.gzip > 0 && report.gzip < report.raw);

  const bad = tempDir(t, { 'index.html': read('fail', 'fetch.html'), 'assets/app.js': '' });
  const badSrc = tempDir(t, { 'x.js': 'Math.random();\n' });
  const failed = checkBuild({ distDir: bad, srcDir: badSrc, budget: 10 });
  assert.deepEqual(ids(failed.failures), ['fetch', 'math-random', 'output-files', 'size']);
});
