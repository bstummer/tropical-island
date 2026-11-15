// The folders of the site GitHub Pages serves (.github/workflows/pages.yml):
// main's game at the root, and every other branch's build at /<branch>/.
//
// CI runs `node tools/pages.js <the run's branch>` with the repository's
// branches on stdin, a line "<sha> <name>" each, and appends what it prints to
// GITHUB_OUTPUT: `previews`, the branches to build as a JSON array of
// { branch, sha, folder, artifact }, and `folder`, the run's own branch's folder
// with a trailing '/' ('' for main's root, or a branch left out). Each branch
// left out is a warning on stderr.

import { existsSync, readFileSync, realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

export const ROOT_BRANCH = 'main';

// What the site's root holds besides the folders: no folder may take a name of it.
const ROOT_FILES = ['index.html'];

// The folder a branch's build lands in: each '/' a folder deeper, and each run of
// anything but letters, digits, '_', '.' and '-' made a '-', so the path needs no
// escaping in a URL. A part can't start with a dot, as in git, so none climbs out
// ('..') or hides.
export function folderFor(branch) {
  return branch
    .split('/')
    .map((part) => part.replace(/[^\w.-]+/g, '-').replace(/^\./, '-'))
    .join('/');
}

// The name a build goes up as between the jobs: its folder and commit, as a run
// also holds the artifacts of the attempts before a re-run, which may be of
// other branches, or of this one at another commit. No folder holds a '~'.
export function artifactFor(folder, sha) {
  return `preview-${folder.replaceAll('/', '~')}-${sha}`;
}

// The branches that get a folder: every one but main, by name, each with its
// folder and artifact. Two whose folders would be the same (names that differ only where
// characters became '-'), or one whose folder would take a name of the root's
// files, aren't built over each other: the first by name keeps the folder, and
// the other is left out, with the reason.
export function previews(branches) {
  const byName = [...branches].sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  const owner = new Map(); // folder -> branch
  const built = [];
  const left = [];
  for (const { name, sha } of byName) {
    if (name === ROOT_BRANCH) continue;
    const folder = folderFor(name);
    const top = folder.split('/')[0];
    const clash = ROOT_FILES.includes(top) ? `the root's ${top}` : owner.has(folder) ? `the branch ${owner.get(folder)}'s` : null;
    if (clash) {
      left.push({ branch: name, reason: `its folder ${folder}/ would clash with ${clash}` });
      continue;
    }
    owner.set(folder, name);
    built.push({ branch: name, sha, folder, artifact: artifactFor(folder, sha) });
  }
  return { built, left };
}

// stdin's lines "<sha> <name>" as { name, sha }; git allows no spaces in a name.
export function parseBranches(text) {
  return text
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const [sha, name, ...rest] = line.split(/\s+/);
      if (!/^[\da-f]{40}$/.test(sha) || !name || rest.length) throw new Error(`not "<sha> <name>": ${line}`);
      return { name, sha };
    });
}

function main(args) {
  const [own] = args;
  if (!own) throw new Error('usage: node tools/pages.js <the run\'s branch> < branches');
  const { built, left } = previews(parseBranches(readFileSync(0, 'utf8')));
  for (const { branch, reason } of left) console.error(`::warning::The branch ${branch} gets no preview: ${reason}.`);
  const mine = built.find((p) => p.branch === own);
  console.log(`previews=${JSON.stringify(built)}`);
  console.log(`folder=${mine ? `${mine.folder}/` : ''}`);
}

const invokedPath = process.argv[1] && existsSync(process.argv[1]) ? realpathSync.native(process.argv[1]) : null;
if (invokedPath === realpathSync.native(fileURLToPath(import.meta.url))) main(process.argv.slice(2));
