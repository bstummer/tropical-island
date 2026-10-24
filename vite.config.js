import { execFileSync } from 'node:child_process';
import { defineConfig } from 'vite';
import glsl from 'vite-plugin-glsl';
import { viteSingleFile } from 'vite-plugin-singlefile';
import { checkOutputFiles } from './tools/check-build.js';

const SHADER_ID = /\.wgsl(\?.*)?$/;

// The commit the game is built from, shown in the benchmark summary
// (src/core/benchmark.js) so numbers from other machines name their build.
function buildId() {
  const git = (...args) => execFileSync('git', args, { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim();
  try {
    return `${git('rev-parse', '--short', 'HEAD')}${git('status', '--porcelain') ? '-dirty' : ''}`;
  } catch {
    return 'unknown';
  }
}

// Lets any shader write `#include "chunks/noise.wgsl"` no matter which folder it
// lives in: the include is rewritten to a root import, which vite-plugin-glsl
// resolves against `root` (src/shaders). Chunks themselves include sibling
// chunks by relative path (`#include "noise.wgsl"`), because the plugin reads
// nested chunks from disk without running this transform.
function shaderChunkPaths() {
  return {
    name: 'shader-chunk-paths',
    enforce: 'pre',
    transform: {
      filter: { id: SHADER_ID },
      handler: (code) => code.replace(/(#include\s+["']?)chunks\//g, '$1/chunks/'),
    },
  };
}

// Dev only: shader modules accept their own updates and announce the swap, so
// main.js can patch live materials in place instead of reloading the page
// (the camera stays where it is). Edits to #included chunks propagate too,
// because vite-plugin-glsl registers them as watch dependencies.
function shaderHotSwap() {
  return {
    name: 'shader-hot-swap',
    apply: 'serve',
    transform: {
      filter: { id: SHADER_ID },
      handler(code) {
        if (!/^export default /m.test(code)) return null;
        return (
          code.replace(/^export default /m, 'const __shader = ') +
          '\nexport default __shader;\n' +
          'if (import.meta.hot) {\n' +
          '  import.meta.hot.accept((next) => {\n' +
          '    if (next) window.dispatchEvent(new CustomEvent("shader-hot-swap", { detail: { prev: __shader, next: next.default } }));\n' +
          '  });\n' +
          '}\n'
        );
      },
    },
  };
}

// The build must emit index.html and nothing else. Runs after
// vite-plugin-singlefile has dropped the inlined chunks, and fails the build
// before anything is written.
function singleFileOutput() {
  return {
    name: 'single-file-output',
    apply: 'build',
    enforce: 'post',
    generateBundle: {
      order: 'post',
      handler(_options, bundle) {
        const failures = checkOutputFiles(Object.keys(bundle));
        if (failures.length) this.error(failures.map((f) => f.message).join('\n'));
      },
    },
  };
}

export default defineConfig({
  base: './',
  publicDir: false, // dist/ holds index.html only
  define: { __BUILD__: JSON.stringify(buildId()) },
  plugins: [
    shaderChunkPaths(),
    // Chunks share helpers (two chunks may both include noise.wgsl), and WGSL
    // rejects a function defined twice, so each chunk lands in a shader once.
    glsl({ root: '/src/shaders', watch: true, minify: false, removeDuplicatedImports: true }),
    shaderHotSwap(),
    viteSingleFile({ removeViteModuleLoader: true }),
    singleFileOutput(),
  ],
  build: {
    target: 'es2022',
    outDir: 'dist',
    emptyOutDir: true,
    assetsInlineLimit: Number.MAX_SAFE_INTEGER,
    cssCodeSplit: false,
    sourcemap: false,
    // The modulepreload polyfill uses fetch(); a single inline file never preloads anything.
    modulePreload: { polyfill: false },
    // tools/check-build.js reports raw and gzip size against the budget instead.
    reportCompressedSize: false,
    chunkSizeWarningLimit: 8192,
    // Keep license comments (three.js's MIT notice), which minifying would drop.
    rolldownOptions: { output: { comments: { legal: true } } },
  },
});
