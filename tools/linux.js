// Runs a command in a Linux container like CI's runner (tools/linux.Dockerfile),
// with the repo mounted, for machines whose own Chromium lacks what CI has:
// on Windows, WebGPU has no SwiftShader adapter, so SwiftShader captures that
// compare with CI's come from here.
//
//   node tools/linux.js npm run verify -- --gl swiftshader
//   node tools/linux.js node tools/screenshot.js --gl swiftshader --views beach
//
// Needs Docker. The image is built on first use (and again when the Dockerfile
// changes). node_modules and Playwright's browsers live in Docker volumes, as
// the host's are for another OS; `npm ci` runs there whenever package-lock.json
// changed.
import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const DOCKERFILE = join(ROOT, 'tools', 'linux.Dockerfile');
const hash = (file) => createHash('sha256').update(readFileSync(file)).digest('hex').slice(0, 12);
const IMAGE = `tropical-island-linux:${hash(DOCKERFILE)}`;
const VOLUMES = ['-v', 'tropical-island-node-modules:/repo/node_modules', '-v', 'tropical-island-browsers:/root/.cache/ms-playwright'];

function docker(args, options = {}) {
  const result = spawnSync('docker', args, { stdio: 'inherit', ...options });
  if (result.error) throw new Error(`docker: ${result.error.message}. Is Docker running?`);
  return result.status ?? 1;
}

function run(command) {
  return docker(['run', '--rm', '--init', '--shm-size=2g', '-v', `${ROOT}:/repo`, ...VOLUMES, '-e', 'CI', IMAGE, 'bash', '-c', command]);
}

function main(args) {
  if (!args.length) {
    console.log('usage: node tools/linux.js <command> [args...]');
    return 2;
  }
  const images = execFileSync('docker', ['images', '-q', IMAGE]).toString().trim();
  if (!images && docker(['build', '-t', IMAGE, '-f', DOCKERFILE, join(ROOT, 'tools')]) !== 0) return 1;

  const lock = hash(join(ROOT, 'package-lock.json'));
  const stamp = 'node_modules/.linux-lock';
  const install = `[ "$(cat ${stamp} 2>/dev/null)" = "${lock}" ] || { npm ci --no-audit --no-fund && echo ${lock} > ${stamp}; }`;
  const quoted = args.map((a) => (/^[\w@%+=:,./-]+$/.test(a) ? a : `'${a.replace(/'/g, `'\\''`)}'`)).join(' ');
  return run(`${install} && ${quoted}`);
}

process.exitCode = main(process.argv.slice(2));
