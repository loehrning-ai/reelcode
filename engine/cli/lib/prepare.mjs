// prepare.mjs: project.prepare, the generator steps make runs before anything else.
//
// A project ships as text: project.json plus the scripts that build its assets (procedural photos, a sectioned
// score, UI captures of a local app). Each step names the files it creates and runs only when one of them is
// missing, so a second make costs nothing. Steps run in order, from the repository root.
//
//   {"run": "fixtures/media/make_media.py", "args": ["--out", "{project}/assets"], "creates": ["assets/ridge.jpg"]}
//   {"capture": "fixture:mock-product", "args": ["--apply-brand"], "creates": ["assets/assets.json"]}
//   {"run": "templates/data-story/score.py", "args": ["{plan}", "--out", "assets/score.flac"],
//    "creates": ["assets/score.flac"], "plan": {"audio": {"music": "synth"}}}
//
// "plan" first runs `make --only audio` on a temporary copy of the project with those audio settings, so a score
// generator can read the film's own timeline (out/timeline.json, audio/cues.json) through {plan}. The copy's
// assets/ is a link to the project's own, so whatever the generator writes under {plan}/assets/ lands in the project.
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { join, relative, resolve, sep } from 'node:path';
import { STUDIO_ROOT } from './server.mjs';
import { PYTHON } from './pipeline.mjs';

const rel = (p) => relative(STUDIO_ROOT, p) || '.';

function exec(cmd, args) {
  return new Promise((ok, fail) => {
    const p = spawn(cmd, args, { cwd: STUDIO_ROOT, stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '', err = '';
    p.stdout.on('data', (d) => { out += d; });
    p.stderr.on('data', (d) => { err += d; });
    p.on('error', (e) => fail(new Error(`could not run ${cmd}: ${e.message}`)));
    p.on('close', (code) => ok({ code: code === null ? 1 : code, out, err }));
  });
}

/** The last stdout line when it is a JSON object with ok:false (the generators' failure report), else null. */
function reportedFailure(out) {
  const last = out.trim().split('\n').pop() || '';
  try { const j = JSON.parse(last); return j && j.ok === false ? (j.error || 'ok:false') : null; } catch { return null; }
}

const expand = (args, vars) => (args || []).map((a) => String(a).replace(/\{(project|plan)\}/g, (_, k) => vars[k] ?? `{${k}}`));

/** Resolve a step's script: "./x.py" is project-relative, anything else repository-relative; never outside the repo. */
function scriptPath(P, run) {
  const file = run.startsWith('./') ? resolve(P.dir, run) : resolve(STUDIO_ROOT, run);
  if (!file.startsWith(STUDIO_ROOT + sep)) throw new Error(`prepare: ${run} is outside the repository`);
  if (!existsSync(file)) throw new Error(`prepare: script not found: ${rel(file)}`);
  return file;
}

/** make --only audio on a throwaway copy of the project with `plan.audio` applied; returns its folder. */
async function planCopy(P, plan, log) {
  const dir = join(STUDIO_ROOT, 'projects', `_plan-${P.name}`.slice(0, 64));
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  const project = JSON.parse(readFileSync(join(P.dir, 'project.json'), 'utf8'));
  delete project.prepare;
  project.audio = { ...(project.audio || {}), ...((plan && plan.audio) || {}) };
  for (const k of ['musicStart', 'fit']) if (project.audio.music === 'synth') delete project.audio[k];
  writeFileSync(join(dir, 'project.json'), JSON.stringify(project, null, 2) + '\n');
  // the copy shares the real assets/ folder, so a generator writing {plan}/assets/... writes into the project
  mkdirSync(join(P.dir, 'assets'), { recursive: true });
  symlinkSync(join(P.dir, 'assets'), join(dir, 'assets'), 'dir');
  log(`prepare: planning pass (make --only audio) on ${rel(dir)}`);
  const r = await exec(process.execPath, [join(STUDIO_ROOT, 'engine', 'cli', 'make.mjs'), rel(dir), '--only', 'audio', '--no-stills', '--quiet']);
  if (r.code !== 0) {
    rmSync(dir, { recursive: true, force: true });
    throw new Error(`prepare: planning pass failed:\n${(r.err || r.out).trim()}`);
  }
  return dir;
}

/**
 * Run every step of P.base.prepare whose outputs are missing (all of them with force).
 * Returns [{step, ran, why}] for the log.
 */
export async function runPrepare(P, { force = false, log = () => {} } = {}) {
  const steps = Array.isArray(P.project.prepare) ? P.project.prepare : [];
  const done = [];
  for (const [i, step] of steps.entries()) {
    const label = step.run || `capture ${step.capture}`;
    if (!!step.run === !!step.capture) throw new Error(`prepare[${i}]: give exactly one of run or capture`);
    const missing = (step.creates || []).filter((f) => !existsSync(resolve(P.dir, f)));
    if (!force && !missing.length) { done.push({ step: label, ran: false }); continue; }
    let planDir = null;
    try {
      if (step.plan) planDir = await planCopy(P, step.plan, log);
      const vars = { project: rel(P.dir), plan: planDir ? rel(planDir) : undefined };
      const args = expand(step.args, vars);
      log(`prepare: ${label}${missing.length ? ` (missing ${missing.slice(0, 3).join(', ')}${missing.length > 3 ? ', ...' : ''})` : ' (--force)'}`);
      let r;
      if (step.run) {
        if (!existsSync(PYTHON)) throw new Error('prepare: the Python venv is missing; run "npx reelcode setup"');
        r = await exec(PYTHON, ['-I', scriptPath(P, step.run), ...args]);
      } else {
        r = await exec(process.execPath, [join(STUDIO_ROOT, 'engine', 'cli', 'capture.mjs'), step.capture, rel(P.dir), ...args]);
      }
      const why = r.code !== 0 ? (r.err || r.out).trim().split('\n').slice(-4).join(' | ') : reportedFailure(r.out);
      if (why) throw new Error(`prepare: ${label} failed: ${why}`);
      const still = (step.creates || []).filter((f) => !existsSync(resolve(P.dir, f)));
      if (still.length) throw new Error(`prepare: ${label} did not create ${still.join(', ')}`);
      done.push({ step: label, ran: true });
    } finally {
      if (planDir) rmSync(planDir, { recursive: true, force: true });
    }
  }
  return done;
}

/** Files named by prepare steps that do not exist yet (lint and render point at make when this is non-empty). */
export function missingPrepared(P) {
  const steps = Array.isArray(P.project.prepare) ? P.project.prepare : [];
  return steps.flatMap((s) => (s.creates || []).filter((f) => !existsSync(resolve(P.dir, f))));
}
