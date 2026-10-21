// pipeline.mjs: helpers for make.mjs: audio CLIs (the reelcode venv python), child CLIs, hashing, stamps, table.
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, readdirSync, statSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, relative, dirname } from 'node:path';
import { STUDIO_ROOT } from './server.mjs';

/**
 * The Python that runs engine/audio/*.py: $REELCODE_PYTHON when set, else the venv that `reelcode setup` creates
 * in .venv/ (bin/python on macOS and Linux, Scripts/python.exe on Windows).
 */
export function pythonPath(env = process.env) {
  if (env.REELCODE_PYTHON) return env.REELCODE_PYTHON;
  const posix = join(STUDIO_ROOT, '.venv', 'bin', 'python');
  const win = join(STUDIO_ROOT, '.venv', 'Scripts', 'python.exe');
  return existsSync(posix) || !existsSync(win) ? posix : win;
}
export const PYTHON = pythonPath();
export const AUDIO_DIR = join(STUDIO_ROOT, 'engine', 'audio');
const rel = (p) => relative(STUDIO_ROOT, p) || p;

function collect(cmd, args, { timeout = 600000 } = {}) {
  return new Promise((ok, fail) => {
    const p = spawn(cmd, args, { cwd: STUDIO_ROOT, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '', stderr = '';
    const timer = setTimeout(() => { p.kill('SIGKILL'); }, timeout);
    p.stdout.on('data', (d) => { stdout += d; });
    p.stderr.on('data', (d) => { stderr += d; });
    p.on('error', (e) => { clearTimeout(timer); fail(new Error(`could not run ${cmd}: ${e.message}`)); });
    p.on('close', (code, signal) => { clearTimeout(timer); ok({ code: code === null ? 1 : code, signal, stdout, stderr }); });
  });
}

/** Run engine/audio/<script> with the venv python -I. Returns its one-line JSON summary; throws on exit 1 or ok:false. */
export async function py(script, args) {
  return pyFile(join(AUDIO_DIR, script), args, script);
}

/** Run any Python file with the venv python -I from the repository root; same contract as py(). */
export async function pyFile(file, args, label = rel(file)) {
  if (!existsSync(PYTHON)) throw new Error(`python venv missing: ${rel(PYTHON)}; run "npx reelcode setup" (or set REELCODE_PYTHON)`);
  const r = await collect(PYTHON, ['-I', file, ...args.map(String)]);
  const line = r.stdout.trim().split('\n').pop() || '';
  let j = null;
  try { j = JSON.parse(line); } catch { /* not JSON */ }
  if (r.code !== 0 || !j || j.ok === false) {
    const why = j && j.error ? j.error : (r.stderr.trim().split('\n').slice(-3).join(' | ') || line || `exit ${r.code}`);
    throw new Error(`${label} failed: ${why}`);
  }
  return j;
}

/** Run another reelcode CLI (engine/cli/<cmd>.mjs). Resolves {code, stdout, stderr}; never throws on exit 1. */
export const nodeCli = (cmd, args) => collect(process.execPath, [join(STUDIO_ROOT, 'engine', 'cli', `${cmd}.mjs`), ...args]);

export const sha256 = (buf) => createHash('sha256').update(buf).digest('hex');
export const sha256File = (p) => sha256(readFileSync(p));

/** Every file under dir (recursive, sorted, skipping dot files and __pycache__). */
export function listFiles(dir) {
  if (!existsSync(dir)) return [];
  const out = [];
  for (const name of readdirSync(dir).sort()) {
    if (name.startsWith('.') || name === '__pycache__') continue;
    const p = join(dir, name), st = statSync(p);
    if (st.isDirectory()) out.push(...listFiles(p)); else if (st.isFile()) out.push(p);
  }
  return out;
}

/** Content stamp over files (path + sha) and plain values. Stable across runs and machines. */
export function stamp(files, values = {}) {
  const h = createHash('sha256');
  for (const f of [...new Set(files)].sort()) h.update(`${rel(f)}\0${existsSync(f) ? sha256File(f) : '-'}\0`);
  h.update(JSON.stringify(values, Object.keys(values).sort()));
  return h.digest('hex');
}

export const readJSON = (p, fallback = null) => { try { return JSON.parse(readFileSync(p, 'utf8')); } catch { return fallback; } };

/** Write JSON with sorted keys (2-space indent) so reruns are byte-identical. */
export function writeJSON(p, value) {
  const sort = (v) => (Array.isArray(v) ? v.map(sort) : v && typeof v === 'object'
    ? Object.fromEntries(Object.keys(v).sort().map((k) => [k, sort(v[k])])) : v);
  mkdirSync(dirname(p), { recursive: true });
  writeFileSync(p, JSON.stringify(sort(value), null, 2) + '\n');
}

/** Plain-text table: rows are arrays of cells; the first row is the header. */
export function table(rows) {
  const w = rows[0].map((_, i) => Math.max(...rows.map((r) => String(r[i] ?? '').length)));
  const line = (r) => r.map((c, i) => String(c ?? '').padEnd(w[i])).join('  ').trimEnd();
  return [line(rows[0]), w.map((n) => '-'.repeat(n)).join('  '), ...rows.slice(1).map(line)].join('\n');
}
