// CLI smoke test for new.mjs and make.mjs (scaffold -> validate -> full draft make -> idempotent rerun). About 90 s.
import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync, execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, rmSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { uniq } from './_names.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const NAME = uniq('zz-cli-make'), DIR = join(ROOT, 'projects', NAME), PJ = join(DIR, 'project.json');
const run = (cmd, ...args) => spawnSync('node', [join(ROOT, 'engine', 'cli', `${cmd}.mjs`), ...args], { cwd: ROOT, encoding: 'utf8', timeout: 480000 });
const probe = (f) => execFileSync('ffprobe', ['-v', 'error', '-count_frames', '-show_entries', 'stream=codec_type,width,height,nb_read_frames', '-of', 'csv=p=0', f], { encoding: 'utf8' }).trim().split('\n');
const readJ = (f) => JSON.parse(readFileSync(f, 'utf8'));
after(() => rmSync(DIR, { recursive: true, force: true }));

test('new: --list, bad names and unknown templates', () => {
  const l = run('new', '--list');
  assert.equal(l.status, 0, l.stderr); assert.doesNotMatch(l.stdout, /^_/m); assert.match(l.stdout, /^data-story\s/m); assert.match(l.stdout, /internal test templates? hidden/);
  const la = run('new', '--list', '--all');
  assert.equal(la.status, 0, la.stderr); assert.match(la.stdout, /^_smoke\s/m);
  const bad = run('new', '--template', '_smoke', '--name', 'Bad_Name');
  assert.equal(bad.status, 1); assert.match(bad.stderr, /--name "Bad_Name" must match/);
  const unk = run('new', '--template', 'no-such-template', '--name', 'zz-x');
  assert.equal(unk.status, 1); assert.match(unk.stderr, /unknown template "no-such-template" \(available: .*data-story/); assert.doesNotMatch(unk.stderr, /_smoke/);
  assert.equal(run('new', '--template', '_smoke', '--name', 'zz-x', '--bogus').status, 1);
});

test('new: scaffolds from template.json, applies flags, refuses to overwrite without --force', () => {
  rmSync(DIR, { recursive: true, force: true });
  const r = run('new', '--template', '_smoke', '--name', NAME, '--title', 'CLI make test', '--formats', '1x1', '--style', 'punchy-pop');
  assert.equal(r.status, 0, r.stderr);
  for (const d of ['assets', 'audio', 'out']) assert.ok(existsSync(join(DIR, d)), d);
  const p = readJ(PJ);
  assert.equal(p.template, '_smoke'); assert.equal(p.title, 'CLI make test');
  assert.deepEqual(p.formats, ['1x1']); assert.equal(p.audio.style, 'punchy-pop');
  assert.deepEqual(p.content, readJ(join(ROOT, 'templates/_smoke/template.json')).example.content);
  assert.equal(run('new', '--template', '_smoke', '--name', NAME).status, 1);
  assert.equal(run('new', '--template', '_smoke', '--name', NAME, '--formats', '1x1', '--style', 'punchy-pop', '--force').status, 0);
});

test('make: an invalid project.json lists every problem with its path and exits 1', () => {
  const good = readFileSync(PJ, 'utf8'), p = JSON.parse(good);
  p.brand.colors.accent = 'orange'; p.formats = ['1x1', '5x4']; p.content.hook.lines = [];
  writeFileSync(PJ, JSON.stringify(p));
  try {
    const r = run('make', `projects/${NAME}`);
    assert.equal(r.status, 1);
    assert.match(r.stderr, /project\.json is invalid \(3 problems\)/);
    assert.match(r.stderr, /project\.brand\.colors\.accent: must match/);
    assert.match(r.stderr, /project\.formats\[1\]: must be one of/);
    assert.match(r.stderr, /content\.hook\.lines: must have at least 1/);
    assert.match(run('make', `projects/${NAME}`, '--only', 'sound').stderr, /--only must be one of video\|audio/);
  } finally { writeFileSync(PJ, good); }
});

test('make: draft end to end (music, beats, lint, cues, sfx, mix, render, mux, sheets, loop_check, manifest), then an idempotent rerun', () => {
  const r = run('make', `projects/${NAME}`, '--quality', 'draft', '--quiet');
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.match(r.stdout, /format\s+video\s+frames/);
  const out = join(DIR, 'out', '1x1');
  const [v, au] = probe(join(out, 'draft.mp4'));
  assert.equal(v, 'video,1080,1080,360'); assert.match(au, /^audio,/);
  assert.deepEqual(probe(join(out, 'draft_silent.mp4')), ['video,1080,1080,360']);
  assert.equal(probe(join(out, 'loop_check.mp4'))[0], 'video,1080,1080,1080');
  for (const s of ['contact', 'phone', 'strip', 'seam', 'poster']) assert.ok(existsSync(join(out, `${s}.png`)), s);
  for (const f of ['music.wav', 'beats.json', 'cues.json', 'cues_timed.json', 'sfx.wav', 'mix.wav']) assert.ok(existsSync(join(DIR, 'audio', f)), f);
  const beats = readJ(join(DIR, 'audio/beats.json'));
  assert.equal(beats.source, 'synth'); assert.equal(beats.style, 'punchy-pop'); assert.equal(beats.duration, 12);
  const m = readJ(join(DIR, 'out/manifest.json'));
  assert.equal(m.quality, 'draft'); assert.equal(m.lint, 'pass');
  assert.ok(Math.abs(m.formats['1x1'].lufs.I + 14) <= 0.5, `LUFS ${m.formats['1x1'].lufs.I}`);
  assert.ok(m.audio.mix.TP <= -1, `TP ${m.audio.mix.TP}`);
  assert.equal(m.formats['1x1'].frames, 360);
  assert.equal(Object.keys(m.formats['1x1'].files).length, 8);
  const before = readFileSync(join(DIR, 'out/manifest.json'), 'utf8');
  const again = run('make', `projects/${NAME}`, '--quality', 'draft', '--quiet');
  assert.equal(again.status, 0, again.stderr);
  assert.match(again.stdout, /1x1 .* cached/);
  assert.equal(readFileSync(join(DIR, 'out/manifest.json'), 'utf8'), before, 'rerun is byte-identical');
});

test('make --only video refuses a beats.json that no longer matches the project', () => {
  const p = readJ(PJ); p.bpm = 100; writeFileSync(PJ, JSON.stringify(p));
  const r = run('make', `projects/${NAME}`, '--only', 'video');
  assert.equal(r.status, 1); assert.match(r.stderr, /audio\/beats\.json is stale/);
});
