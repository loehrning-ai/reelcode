// setup.mjs: everything a fresh clone needs besides `npm install`.
//   1. a Python venv in .venv/ with the pinned audio dependencies (uv when it is installed, else python3 -m venv + pip)
//   2. Playwright's Chromium (downloaded into the Playwright cache, not into the repository)
//   3. the shared procedural fixture photos (fixtures/media/, git-ignored)
// Then it runs doctor. Safe to run again: every step is skipped when it is already done.
//
// npx reelcode setup [--force] [--with-deps] [--skip-browser] [--skip-media] [--python /path/to/python3]
import { existsSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { parseArgs, runCli } from './lib/args.mjs';
import { STUDIO_ROOT } from './lib/server.mjs';
import { sh, shLive, which, versionOf, atLeast, MIN_PYTHON, MIN_NODE, color } from './lib/sys.mjs';
import { pythonPath } from './lib/pipeline.mjs';

const USAGE = 'npx reelcode setup [--force] [--with-deps] [--skip-browser] [--skip-media] [--python /path/to/python3]';
const SPEC = {
  force: { type: 'boolean', default: false }, 'with-deps': { type: 'boolean', default: false },
  'skip-browser': { type: 'boolean', default: false }, 'skip-media': { type: 'boolean', default: false },
  python: { type: 'string' },
};
const VENV = join(STUDIO_ROOT, '.venv');
const REQ = join(STUDIO_ROOT, 'requirements.txt');
const step = (n, msg) => console.log(`\n${color.ok(`[${n}/3]`)} ${msg}`);

/** The venv python can import every audio dependency. */
const venvWorks = (py) => existsSync(py) && sh(py, ['-I', '-c', 'import numpy, scipy, librosa, soundfile, numba']).ok;

/** A python3 >= 3.12 to build the venv from (without uv). */
function findPython(explicit) {
  const names = explicit ? [explicit] : ['python3.15', 'python3.14', 'python3.13', 'python3.12', 'python3', 'python'];
  for (const n of names) {
    const exe = n.includes('/') ? n : which(n);
    if (!exe) continue;
    const r = sh(exe, ['-c', 'import sys; print("%d.%d.%d" % sys.version_info[:3])']);
    if (r.ok && atLeast(versionOf(r.out), MIN_PYTHON)) return { exe, version: r.out.trim() };
  }
  return null;
}

function python(a) {
  const py = pythonPath();
  if (!a.force && venvWorks(py)) { console.log(`  venv ready: ${py.replace(STUDIO_ROOT + '/', '')}`); return; }
  if (a.force) rmSync(VENV, { recursive: true, force: true });
  const uv = which('uv');
  if (uv && !a.python) {
    console.log('  using uv');
    if (shLive(uv, ['venv', VENV, '--python', `${MIN_PYTHON.join('.')}`, '--allow-existing']) !== 0) throw new Error('uv venv failed');
    if (shLive(uv, ['pip', 'install', '--python', pythonPath(), '-r', REQ]) !== 0) throw new Error('uv pip install failed');
  } else {
    const found = findPython(a.python);
    if (!found) {
      throw new Error(`no Python >= ${MIN_PYTHON.join('.')} found. Install uv (https://docs.astral.sh/uv/) and rerun, ` +
        `or install Python ${MIN_PYTHON.join('.')}+ and pass --python /path/to/python3`);
    }
    console.log(`  using ${found.exe} (${found.version}) with venv + pip`);
    if (shLive(found.exe, ['-m', 'venv', VENV]) !== 0) {
      throw new Error(`python -m venv failed${process.platform === 'linux' ? ' (on Debian/Ubuntu: sudo apt-get install -y python3-venv)' : ''}`);
    }
    const py = pythonPath();
    if (shLive(py, ['-m', 'pip', 'install', '--disable-pip-version-check', '-q', '-r', REQ]) !== 0) throw new Error('pip install -r requirements.txt failed');
  }
  if (!venvWorks(pythonPath())) throw new Error('the venv was created but cannot import the audio dependencies; rerun with --force');
  console.log('  venv ready');
}

function browser(a) {
  const cli = join(STUDIO_ROOT, 'node_modules', 'playwright', 'cli.js');
  if (!existsSync(cli)) throw new Error('Playwright is not installed; run "npm install" in the repository first');
  const args = [cli, 'install', ...(a['with-deps'] ? ['--with-deps'] : []), 'chromium'];
  if (shLive(process.execPath, args) !== 0) {
    throw new Error(`Playwright could not install Chromium${process.platform === 'linux' && !a['with-deps']
      ? '; on Linux it may need system libraries: npx playwright install-deps chromium (needs sudo), then rerun setup' : ''}`);
  }
}

function media() {
  const r = sh(pythonPath(), ['-I', join(STUDIO_ROOT, 'fixtures', 'media', 'make_media.py')]);
  const last = r.out.trim().split('\n').pop() || '';
  let j = null;
  try { j = JSON.parse(last); } catch { /* not JSON */ }
  if (!r.ok || !j || !j.ok) throw new Error(`fixtures/media/make_media.py failed: ${(j && j.error) || r.err.trim().split('\n').pop() || last}`);
  console.log(`  ${j.cached ? 'already generated' : 'generated'}: fixtures/media/{ridge,harbor,canopy}.jpg, ridge.webm`);
}

runCli(USAGE, async () => {
  const a = parseArgs(process.argv.slice(2), SPEC, { positionals: [0, 0] });
  if (!atLeast(versionOf(process.versions.node), MIN_NODE)) throw new Error(`node ${process.versions.node} is too old; reelcode needs node ${MIN_NODE[0]}+`);
  step(1, 'Python venv with the pinned audio dependencies (numpy, scipy, librosa, soundfile, numba)');
  python(a);
  step(2, 'Playwright Chromium');
  if (a['skip-browser']) console.log('  skipped (--skip-browser)'); else browser(a);
  step(3, 'shared fixture media (procedural, no downloads)');
  if (a['skip-media']) console.log('  skipped (--skip-media)'); else media();
  console.log(`\n${color.ok('setup done.')} Checking the machine:\n`);
  const code = shLive(process.execPath, [join(STUDIO_ROOT, 'engine', 'cli', 'doctor.mjs')]);
  if (code === 0) console.log(`\nnext:\n  npx reelcode make example-showreel     # a 16 s kinetic-type reel, every format, with sound\n  npx reelcode new --list               # the templates`);
  return code;
});
