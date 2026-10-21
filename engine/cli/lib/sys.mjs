// sys.mjs: small process helpers shared by setup, doctor and test (run a command, find an executable, versions).
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { delimiter, join } from 'node:path';
import { STUDIO_ROOT } from './server.mjs';

/** spawnSync with sane defaults; never throws. -> {ok, code, out, err} */
export function sh(cmd, args = [], opts = {}) {
  const r = spawnSync(cmd, args, { cwd: STUDIO_ROOT, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024, ...opts });
  if (r.error) return { ok: false, code: -1, out: '', err: r.error.message };
  return { ok: r.status === 0, code: r.status, out: r.stdout || '', err: r.stderr || '' };
}

/** Like sh() but the child writes straight to this terminal (long installs). -> exit code */
export function shLive(cmd, args = [], opts = {}) {
  const r = spawnSync(cmd, args, { cwd: STUDIO_ROOT, stdio: 'inherit', ...opts });
  return r.error ? -1 : r.status;
}

/** Absolute path of an executable on PATH, or null. */
export function which(name) {
  for (const dir of (process.env.PATH || '').split(delimiter)) {
    if (!dir) continue;
    for (const ext of process.platform === 'win32' ? ['.exe', '.cmd', ''] : ['']) {
      const f = join(dir, name + ext);
      if (existsSync(f)) return f;
    }
  }
  return null;
}

/** "3.12.4" -> [3, 12, 4] */
export const versionOf = (s) => (String(s).match(/(\d+)\.(\d+)(?:\.(\d+))?/) || []).slice(1).map((x) => Number(x || 0));
export const atLeast = (v, min) => {
  for (let i = 0; i < min.length; i++) { if ((v[i] || 0) > min[i]) return true; if ((v[i] || 0) < min[i]) return false; }
  return true;
};

/** Pinned direct Python dependencies from requirements.in: [[name, version]] */
export function pinnedPython() {
  const f = join(STUDIO_ROOT, 'requirements.in');
  if (!existsSync(f)) return [];
  return readFileSync(f, 'utf8').split('\n').map((l) => l.trim()).filter((l) => l && !l.startsWith('#'))
    .map((l) => l.split('==').map((x) => x.trim()));
}

export const MIN_PYTHON = [3, 12];
export const MIN_NODE = [20, 0];

/** How to install a system package on this OS, for fix hints. */
export function installHint(pkg) {
  if (process.platform === 'darwin') return `brew install ${pkg}`;
  if (process.platform === 'linux') return `sudo apt-get install -y ${pkg}   (Debian/Ubuntu; use your distro's package manager otherwise)`;
  return `install ${pkg} and put it on PATH`;
}

export const color = {
  ok: (s) => (process.stdout.isTTY ? `\x1b[32m${s}\x1b[0m` : s),
  bad: (s) => (process.stdout.isTTY ? `\x1b[31m${s}\x1b[0m` : s),
  warn: (s) => (process.stdout.isTTY ? `\x1b[33m${s}\x1b[0m` : s),
  dim: (s) => (process.stdout.isTTY ? `\x1b[2m${s}\x1b[0m` : s),
};
