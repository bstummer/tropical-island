// Verifies that dist/ is a single, self-contained HTML file, and that src/
// only gets time and randomness through core/clock.js and core/random.js.
// Usage: node tools/check-build.js   (exits non-zero on any failure)
// The individual checks are exported for tests/check-build.test.js; vite.config.js
// uses checkOutputFiles() to fail any build that would emit more than index.html.
import { existsSync, readFileSync, readdirSync, realpathSync } from 'node:fs';
import { gzipSync } from 'node:zlib';
import { fileURLToPath } from 'node:url';
import { dirname, join, relative } from 'node:path';
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

// Sources of non-determinism that must go through clock.js / random.js instead.
export const SOURCE_RULES = [
  { id: 'math-random', name: 'Math.random', re: /\bMath\.random\b/g },
  { id: 'date', name: 'Date.now / new Date()', re: /\bDate\.now\b|\bnew\s+Date\b/g },
  { id: 'performance-now', name: 'performance.now', re: /\bperformance\.now\b/g, except: ['core/clock.js'] },
  { id: 'three-clock', name: 'three.js Clock/Timer', re: /\bnew\s+(THREE\.)?(Clock|Timer)\b/g },
  { id: 'three-random', name: 'three.js MathUtils random', re: /\b(randInt|randFloat|randFloatSpread|seededRandom)\b/g },
];

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

// Raw size against the budget: warn above it, fail above twice it.
export function checkSize(bytes, budget) {
  if (bytes > 2 * budget) return { level: 'fail', message: `size ${mb(bytes)} exceeds twice the budget (${mb(2 * budget)})` };
  if (bytes > budget) return { level: 'warn', message: `size ${mb(bytes)} exceeds the budget (${mb(budget)})` };
  return { level: 'ok', message: '' };
}

// Determinism lint over every .js file under srcDir. Comments are ignored.
export function checkSources(srcDir) {
  const failures = [];
  for (const name of readdirSync(srcDir, { recursive: true })) {
    if (!/\.(js|mjs)$/.test(name)) continue;
    const path = relative(srcDir, join(srcDir, name)).replaceAll('\\', '/');
    // Blank out comments (keeping offsets) so docs may mention the forbidden APIs.
    const code = readFileSync(join(srcDir, name), 'utf8').replace(/\/\*[\s\S]*?\*\/|\/\/[^\n]*/g, (c) => c.replace(/[^\n]/g, ' '));
    for (const rule of SOURCE_RULES) {
      if (rule.except?.includes(path)) continue;
      for (const match of code.matchAll(rule.re)) {
        failures.push({ rule: rule.id, message: `${rule.name} in src/${path} (${position(code, match.index)}); use ctx.clock / ctx.rng` });
      }
    }
  }
  return failures;
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
