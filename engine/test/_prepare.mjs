// _prepare.mjs: make sure a checked-in project has its generated files before a test reads them. The repository
// ships projects as text (project.json + generators); `reelcode test` prepares them once up front, and this helper
// covers a direct `node --test` run. Concurrent test files share one lock per project. Not a test file.
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, rmSync, statSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadProject } from '../cli/lib/project.mjs';
import { missingPrepared, runPrepare } from '../cli/lib/prepare.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const nap = (ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);

function withLock(name, fn) {
  const lock = join(ROOT, 'projects', `.lock-${name}`);
  for (let waited = 0; ; waited += 250) {
    try { mkdirSync(lock); break; } catch {
      // a lock older than 15 minutes belongs to a run that died
      try { if (Date.now() - statSync(lock).mtimeMs > 15 * 60 * 1000) rmSync(lock, { recursive: true, force: true }); } catch { /* gone */ }
      if (waited > 20 * 60 * 1000) throw new Error(`timed out waiting for ${lock}`);
      nap(250);
    }
  }
  try { return fn(); } finally { rmSync(lock, { recursive: true, force: true }); }
}

const make = (name, ...args) => {
  const r = spawnSync(process.execPath, [join(ROOT, 'engine/cli/make.mjs'), `projects/${name}`, ...args], { cwd: ROOT, encoding: 'utf8', timeout: 900000 });
  if (r.status !== 0) throw new Error(`make projects/${name} ${args.join(' ')} failed:\n${r.stdout}${r.stderr}`);
};

/** Run project.prepare for projects/<name> when any generated file is missing. */
export function ensurePrepared(name) {
  if (!missingPrepared(loadProject(`projects/${name}`)).length) return;
  withLock(name, () => { if (missingPrepared(loadProject(`projects/${name}`)).length) make(name, '--only', 'audio', '--no-stills', '--quiet'); });
}

/** Make sure projects/<name>/audio holds a current beat grid and cues (make --only audio). */
export function ensureAudio(name) {
  if (existsSync(join(ROOT, 'projects', name, 'audio', 'beats.json'))) return;
  withLock(name, () => { if (!existsSync(join(ROOT, 'projects', name, 'audio', 'beats.json'))) make(name, '--only', 'audio', '--no-stills', '--quiet'); });
}

/** Run the prepare steps of a scaffolded test project in-process (a scaffold is private to one test run). */
export async function prepareScaffold(name) {
  return runPrepare(loadProject(`projects/${name}`));
}
