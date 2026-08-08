/**
 * Fails if a data file the app loads is not on disk.
 *
 * The failure this exists to catch: the pipeline writes public/data, so the app
 * works locally forever, but a file never gets `git add`ed and CI deploys a
 * build that 404s at runtime. tsc cannot see it — these are fetched strings.
 *
 * Required paths are derived, not listed, so this cannot drift:
 *   - every 'data/...' string anywhere in manifest.json
 *   - every dataUrl('data/...') literal in src/
 */

import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const web = join(dirname(fileURLToPath(import.meta.url)), '..');
const pub = join(web, 'public');

const DATA_PATH = /^data\/[\w./-]+\.(?:json|geojson)$/;

/** Every string value anywhere in the manifest tree that names a data file. */
function fromManifest() {
  const found = new Set();
  const walk = (node) => {
    if (typeof node === 'string') {
      if (DATA_PATH.test(node)) found.add(node);
    } else if (node && typeof node === 'object') {
      Object.values(node).forEach(walk);
    }
  };
  walk(JSON.parse(readFileSync(join(pub, 'data/manifest.json'), 'utf8')));
  return found;
}

/** Paths fetched directly rather than via the manifest, e.g. road-base.json. */
function fromSource(dir = join(web, 'src'), found = new Set()) {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) fromSource(p, found);
    else if (/\.tsx?$/.test(e.name)) {
      const src = readFileSync(p, 'utf8');
      for (const m of src.matchAll(/dataUrl\(\s*'(data\/[^']+)'/g)) found.add(m[1]);
    }
  }
  return found;
}

const required = [...new Set([...fromManifest(), ...fromSource()])].sort();
const missing = required.filter((p) => !existsSync(join(pub, p)));

// On disk but not committed is the same outage once CI checks out a clean tree.
let untracked = [];
try {
  untracked = execFileSync('git', ['ls-files', '--others', '--exclude-standard', 'public/data'], {
    cwd: web,
    encoding: 'utf8',
  })
    .split('\n')
    .filter(Boolean);
} catch {
  // Not a git checkout (or git absent). The on-disk check above still ran.
}

if (missing.length || untracked.length) {
  for (const p of missing) console.error(`missing from disk:  ${p}`);
  for (const p of untracked) console.error(`not committed:      ${p}`);
  console.error(
    `\n${required.length} data files required. ` +
      `Run \`just poc-data\` to regenerate, then \`git add\` the results.`,
  );
  process.exit(1);
}

console.log(`data ok — ${required.length} files present and tracked`);
