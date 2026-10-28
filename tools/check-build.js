// Verifies that dist/ is a single, self-contained HTML file, that src/ only
// gets time and randomness through core/clock.js and core/random.js, and that
// it imports and includes nothing from outside src/.
// Usage: node tools/check-build.js   (exits non-zero on any failure)
// The individual checks are exported for tests/check-build.test.js; vite.config.js
// uses checkOutputFiles() to fail any build that would emit more than index.html.
import { existsSync, readFileSync, readdirSync, realpathSync } from 'node:fs';
import { gzipSync } from 'node:zlib';
import { fileURLToPath } from 'node:url';
import { dirname, join, posix, relative } from 'node:path';
import { build as buildConfig } from '../src/config.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

// Exact URLs libraries embed as identifiers, never fetched (XML namespaces).
export const URL_ALLOWLIST = new Set([
  'http://www.w3.org/1999/xhtml',
  'http://www.w3.org/2000/svg',
  'http://www.w3.org/1999/xlink',
  'http://www.w3.org/XML/1998/namespace',
  'http://www.w3.org/2000/xmlns/',
]);

export const HTML_RULES = [
  { id: 'script-src', name: '<script src>', re: /<script\b[^>]*\bsrc\s*=/gi },
  { id: 'link-href', name: '<link href>', re: /<link\b[^>]*\bhref\s*=/gi },
  { id: 'url', name: 'http(s) URL', re: /https?:\/\/[^\s"'`<>)\\]*/gi, allow: (m) => URL_ALLOWLIST.has(m) },
  { id: 'fetch', name: 'fetch()', re: /\bfetch\s*\(/g },
  { id: 'xhr', name: 'XMLHttpRequest', re: /\bXMLHttpRequest\b/g },
  { id: 'websocket', name: 'WebSocket', re: /\bWebSocket\b/g },
  { id: 'eventsource', name: 'EventSource', re: /\bEventSource\b/g },
  { id: 'sendbeacon', name: 'sendBeacon', re: /\bsendBeacon\b/g },
  { id: 'importscripts', name: 'importScripts', re: /\bimportScripts\b/g },
  // A single-file build has nothing to import at runtime; any import() could load a URL.
  { id: 'dynamic-import', name: 'dynamic import()', re: /(?<![\w$.])import\s*\(/g },
];

// Where a shader's `#include "/…"` starts: vite-plugin-glsl's `root` (vite.config.js).
export const SHADER_ROOT = '/src/shaders';

const SCRIPTS = /\.(js|mjs|cjs|jsx|ts|tsx|mts|cts)$/; // what Vite compiles
const SHADERS = /\.(wgsl|glsl|vert|frag|vs|fs)$/; // what vite-plugin-glsl compiles

// Sources of non-determinism that must go through clock.js / random.js instead,
// and imports and shader includes from outside src/.
export const SOURCE_RULES = [
  { id: 'math-random', name: 'Math.random', files: SCRIPTS, re: /\bMath\.random\b/g },
  { id: 'date', name: 'Date.now / new Date()', files: SCRIPTS, re: /\bDate\.now\b|\bnew\s+Date\b/g },
  { id: 'performance-now', name: 'performance.now', files: SCRIPTS, re: /\bperformance\.now\b/g, except: ['core/clock.js'] },
  // The game has no runtime dependencies (CLAUDE.md §2). Every module a file
  // names is matched: whatever comes before `from '...'` (so no import or
  // export clause can hide one), `import '...'`, `import('...')`, and the
  // patterns of `import.meta.glob(...)`; an `import` or `from` after a dot or
  // a quote is a method or a word, not one. A module passes only by a
  // relative path, with forward slashes, to files in src/. A regex reads text,
  // not JavaScript, so contrived code (a specifier split by a line
  // continuation, say) gets past it: the build's checkModules() is the
  // guarantee, this the early warning with a file and a line.
  {
    id: 'own-imports',
    name: 'an import from outside src/',
    files: SCRIPTS,
    re: /(?<![.'"`\w$])from\s*(?<q1>['"])(?<from>(?:(?!\k<q1>)[^\n])*)\k<q1>|(?<![.'"`\w$])import\s*(?:\(\s*)?(?<q2>['"`])(?<bare>(?:(?!\k<q2>)[^\n])*)\k<q2>|(?<![.'"`\w$])import\.meta\.glob\s*(?:<(?:[^<>()]|<[^<>()]*>)*>)?\s*\(\s*(?<glob>\[(?:\s*(?:'[^'\n]*'|"[^"\n]*"|`[^`\n]*`)\s*,?)*\s*\]|(?<q3>['"`])(?:(?!\k<q3>)[^\n])*\k<q3>)/g,
    allow: ({ groups: { from, bare, glob } }, path) => {
      if (glob === undefined) return insideSrc(from ?? bare, path);
      return [...glob.matchAll(/(['"`])((?:(?!\1)[^\n])*)\1/g)].every(([, , pattern]) => insideSrc(pattern.replace(/^!/, ''), path));
    },
    hint: 'import only src/ files, by relative path: the game has no dependencies',
  },
  // vite-plugin-glsl inlines an included chunk without the bundler seeing it,
  // so checkModules() can't: this is the only check. The plugin's pattern,
  // and like the plugin it ignores an #include in a comment.
  {
    id: 'own-includes',
    name: 'a shader #include from outside src/',
    files: SHADERS,
    re: /#include\s+(?<chunk>[^\s<>]+)/gi,
    allow: ({ groups: { chunk } }, path) => includeInsideSrc(chunk, path),
    hint: 'include only shaders in src/',
  },
];

// Whether `specifier`, imported by src/`path`, is a file in src/.
function insideSrc(specifier, path) {
  if (!/^\.\.?\//.test(specifier) || specifier.includes('\\')) return false;
  return !posix.normalize(posix.join(posix.dirname(path), specifier)).startsWith('../');
}

// Whether the chunk a shader in src/`path` includes is a file in src/, found as
// vite-plugin-glsl finds it (paths from the project, at /): from SHADER_ROOT if
// it starts with a slash, else from the shader's folder. vite.config.js makes a
// leading `chunks/` start with a slash in the shaders it compiles, not in the
// chunks they include, so both readings must stay in src/. (src/ itself is
// outside: the plugin adds .glsl to a name without an extension, src.glsl.)
function includeInsideSrc(chunk, path) {
  const name = chunk.replace(/^["']|["']?;?$/g, '');
  if (/[\\:]/.test(name)) return false; // a backslash or a drive, which resolve() reads on Windows
  const found = [name.startsWith('/') ? posix.join(SHADER_ROOT, name) : posix.resolve('/src', posix.dirname(path), name)];
  if (name.startsWith('chunks/')) found.push(posix.join(SHADER_ROOT, name));
  return found.every((file) => file.startsWith('/src/'));
}

// Content rules for the built HTML.
// Returns { failures: [{ rule, message }], allowed: Map<url, count> }.
export function checkHtml(html) {
  const failures = [];
  const allowed = new Map();
  for (const rule of HTML_RULES) {
    for (const match of html.matchAll(rule.re)) {
      if (rule.allow?.(match[0])) {
        allowed.set(match[0], (allowed.get(match[0]) ?? 0) + 1);
        continue;
      }
      const message = `${rule.name} at ${position(html, match.index)}: ${context(html, match.index, match[0].length)}`;
      failures.push({ rule: rule.id, message });
    }
  }
  return { failures, allowed };
}

// The build must emit exactly one file: index.html. Used on the bundle (vite.config.js)
// and on the dist/ listing (checkBuild).
export function checkOutputFiles(fileNames) {
  if (fileNames.length === 1 && fileNames[0] === 'index.html') return [];
  return [{ rule: 'output-files', message: `the build must emit exactly one file (index.html), got: ${fileNames.join(', ') || 'nothing'}` }];
}

// Every module the build bundles (ids as the bundler gives them, under the
// project's `root`) is index.html or a file in src/: no runtime dependencies
// (CLAUDE.md §2), however a module got in. The source lint (own-imports) says
// so early, from the text; this is the bundler's own answer. Used on the
// bundle (vite.config.js).
export function checkModules(ids, root) {
  const base = root.replaceAll('\\', '/').replace(/\/$/, '');
  const ours = (id) => {
    const path = id.split('?')[0].replaceAll('\\', '/');
    return path === `${base}/index.html` || path.startsWith(`${base}/src/`);
  };
  const outside = ids.filter((id) => !ours(id));
  if (!outside.length) return [];
  return [{ rule: 'bundled-modules', message: `the build bundles modules from outside src/: ${outside.map((id) => JSON.stringify(id)).join(', ')}` }];
}

// Raw size against the budget: warn above it, fail above twice it.
export function checkSize(bytes, budget) {
  if (bytes > 2 * budget) return { level: 'fail', message: `size ${mb(bytes)} exceeds twice the budget (${mb(2 * budget)})` };
  if (bytes > budget) return { level: 'warn', message: `size ${mb(bytes)} exceeds the budget (${mb(budget)})` };
  return { level: 'ok', message: '' };
}

// Source lint (SOURCE_RULES) over every script and shader under srcDir (the
// extensions Vite and vite-plugin-glsl would compile). Comments are ignored.
export function checkSources(srcDir) {
  const failures = [];
  for (const name of readdirSync(srcDir, { recursive: true })) {
    const rules = SOURCE_RULES.filter((rule) => rule.files.test(name));
    if (!rules.length) continue;
    const path = relative(srcDir, join(srcDir, name)).replaceAll('\\', '/');
    // Without comments, so docs may mention the forbidden APIs (WGSL's are JavaScript's).
    const code = blankComments(readFileSync(join(srcDir, name), 'utf8'));
    for (const rule of rules) {
      if (rule.except?.includes(path)) continue;
      for (const match of code.matchAll(rule.re)) {
        if (rule.allow?.(match, path)) continue;
        failures.push({ rule: rule.id, message: `${rule.name} in src/${path} (${position(code, match.index)}); ${rule.hint ?? 'use ctx.clock / ctx.rng'}` });
      }
    }
  }
  return failures;
}

// JS source with every comment blanked out, keeping line and column offsets.
// Strings, template literals and regex literals are skipped, so a `/*` or `//`
// inside one (a glob like './plants/*.js', say) doesn't hide the code after it.
// The code in a template's `${…}` is read as code, templates in it too.
// A `/` starts a regex where a value can't end before it, the usual heuristic.
export function blankComments(code) {
  const out = code.split('');
  const blank = (from, to) => {
    for (let k = from; k < to; k++) if (out[k] !== '\n') out[k] = ' ';
  };
  const braces = []; // per `${` still open, the braces opened in it and not yet closed
  let last = ''; // the last significant character of code, to tell a regex from a division
  for (let i = 0; i < code.length; ) {
    const c = code[i];
    const next = code[i + 1];
    if (c === '/' && next === '/') {
      const end = code.indexOf('\n', i);
      blank(i, end === -1 ? code.length : end);
      i = end === -1 ? code.length : end;
    } else if (c === '/' && next === '*') {
      const end = code.indexOf('*/', i + 2);
      blank(i, end === -1 ? code.length : end + 2);
      i = end === -1 ? code.length : end + 2;
    } else if (c === '"' || c === "'") {
      i = skipQuoted(code, i, c);
      last = c;
    } else if (c === '`' || (c === '}' && braces.at(-1) === 0)) {
      // A template literal, or the rest of one after a `${…}`.
      if (c === '}') braces.pop();
      i = skipTemplate(code, i);
      if (code.startsWith('${', i - 2)) braces.push(0);
      last = code[i - 1]; // a regex may start a `${…}`, not follow a template
    } else if (c === '/' && (last === '' || /[(,=:[!&|?{};+\-*%<>~^]/.test(last) || /\b(return|typeof|case|in|of|delete|void|new)\s*$/.test(code.slice(Math.max(0, i - 8), i)))) {
      i = skipRegex(code, i);
      last = '/';
    } else {
      if (c === '{' && braces.length) braces[braces.length - 1]++;
      if (c === '}' && braces.length) braces[braces.length - 1]--;
      if (!/\s/.test(c)) last = c;
      i++;
    }
  }
  return out.join('');
}

// Index just past the string opened by `quote` at i, which ends with its line
// at the latest (as JavaScript's do): a quote misread can't swallow the file.
function skipQuoted(code, i, quote) {
  for (i++; i < code.length && code[i] !== quote && code[i] !== '\n'; i++) {
    if (code[i] === '\\') i += code.startsWith('\r\n', i + 1) ? 2 : 1; // a line continuation is one escape, CRLF too
  }
  return i + 1;
}

// Index just past the part of a template literal from i (its opening backtick,
// or the `}` that closes a `${…}` in it) to its closing backtick or next `${`.
function skipTemplate(code, i) {
  for (i++; i < code.length; i++) {
    if (code[i] === '\\') i++;
    else if (code[i] === '`') return i + 1;
    else if (code[i] === '$' && code[i + 1] === '{') return i + 2;
  }
  return i;
}

// Index just past the regex literal starting at i (its flags included).
function skipRegex(code, i) {
  let inClass = false;
  for (i++; i < code.length && code[i] !== '\n'; i++) {
    if (code[i] === '\\') i++;
    else if (code[i] === '[') inClass = true;
    else if (code[i] === ']') inClass = false;
    else if (code[i] === '/' && !inClass) break;
  }
  for (i++; /\w/.test(code[i] ?? ''); i++);
  return i;
}

// Runs every check on a build directory. distDir/index.html must exist.
export function checkBuild({ distDir, srcDir, budget }) {
  const html = readFileSync(join(distDir, 'index.html'), 'utf8');
  const { failures: htmlFailures, allowed } = checkHtml(html);
  const raw = Buffer.byteLength(html);
  const gzip = gzipSync(html, { level: 9 }).length;
  const size = checkSize(raw, budget);
  const distFiles = readdirSync(distDir, { recursive: true }).map((f) => f.replaceAll('\\', '/'));
  const failures = [...checkOutputFiles(distFiles), ...htmlFailures, ...checkSources(srcDir)];
  if (size.level === 'fail') failures.push({ rule: 'size', message: size.message });
  const warnings = size.level === 'warn' ? [size.message] : [];
  return { failures, warnings, allowed, raw, gzip };
}

function position(text, index) {
  const before = text.slice(0, index);
  const line = before.split('\n').length;
  return `line ${line}, col ${index - before.lastIndexOf('\n')}`;
}

function context(text, index, length, radius = 60) {
  const start = Math.max(0, index - radius);
  const end = Math.min(text.length, index + length + radius);
  const show = (s) => s.replace(/\s+/g, ' ');
  return `…${show(text.slice(start, index))}>>>${text.slice(index, index + length)}<<<${show(text.slice(index + length, end))}…`;
}

function mb(bytes) {
  return bytes >= 1024 * 1024 ? `${(bytes / 1024 / 1024).toFixed(2)} MB` : `${(bytes / 1024).toFixed(1)} KB`;
}

// ---------------------------------------------------------------- CLI

function main() {
  const distDir = join(ROOT, 'dist');
  if (!existsSync(join(distDir, 'index.html'))) {
    console.error('check-build: dist/index.html not found. Run `npm run build` first.');
    return 1;
  }
  const budget = buildConfig.sizeBudgetBytes;
  const { failures, warnings, allowed, raw, gzip } = checkBuild({ distDir, srcDir: join(ROOT, 'src'), budget });

  console.log('check-build: dist/index.html');
  console.log(`  size        ${mb(raw)} raw, ${mb(gzip)} gzip (budget ${mb(budget)} raw)`);
  for (const [url, count] of allowed) console.log(`  allowed     ${url} (x${count})`);
  for (const w of warnings) console.log(`  WARN        ${w}`);
  for (const f of failures) console.log(`  FAIL        ${f.message}`);
  console.log(failures.length ? `check-build: FAILED (${failures.length})` : 'check-build: OK');
  return failures.length ? 1 : 0;
}

// Run only when executed directly, not when imported by tests.
const invokedPath = process.argv[1] && existsSync(process.argv[1]) ? realpathSync.native(process.argv[1]) : null;
if (invokedPath === realpathSync.native(fileURLToPath(import.meta.url))) process.exitCode = main();
