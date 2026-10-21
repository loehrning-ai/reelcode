// v2 CLI tests: new (underscore names, --brand, --page), lint/render/stills/make on renditions (variant x cutdown)
// in 4x5, the stills sheet rules, the bespoke page, v2 features through make (voice-over, captions, exports, range
// render) and capture --brand-preset. About 3 min.
import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync, execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, rmSync, existsSync, mkdirSync, readdirSync, cpSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { uniq, reName } from './_names.mjs';
import { ensurePrepared, prepareScaffold } from './_prepare.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const NAME = uniq('_zz-v2cli'), DIR = join(ROOT, 'projects', NAME), PJ = join(DIR, 'project.json');
const PAGE = uniq('_zz-v2page'), PDIR = join(ROOT, 'projects', PAGE);
const CAP = uniq('_zz-v2cap'), CDIR = join(ROOT, 'projects', CAP), PRESET = uniq('zz-unit-cap');
const run = (cmd, ...args) => spawnSync('node', [join(ROOT, 'engine', 'cli', `${cmd}.mjs`), ...args], { cwd: ROOT, encoding: 'utf8', timeout: 480000 });
const probe = (f) => execFileSync('ffprobe', ['-v', 'error', '-count_frames', '-show_entries', 'stream=codec_type,width,height,nb_read_frames', '-of', 'csv=p=0', f], { encoding: 'utf8' }).trim().split('\n');
const readJ = (f) => JSON.parse(readFileSync(f, 'utf8'));
const pngSize = (f) => { const b = readFileSync(f); return [b.readUInt32BE(16), b.readUInt32BE(20)]; };
const TEMPLATES = readdirSync(join(ROOT, 'templates'), { withFileTypes: true }).filter((d) => d.isDirectory() && existsSync(join(ROOT, 'templates', d.name, 'template.json'))).map((d) => d.name);
const T45 = (t) => uniq(`_zz45-${t.replace(/^_/, 'x')}`);
const ASSETS_FROM = { 'product-launch': 'example-launch', '_smoke-ui': '_smoke-ui' };
after(() => {
  for (const d of [DIR, PDIR, CDIR, join(ROOT, 'brands', PRESET), ...TEMPLATES.map((t) => join(ROOT, 'projects', T45(t)))]) rmSync(d, { recursive: true, force: true });
  rmSync(join(ROOT, 'brands', `${PRESET}.json`), { force: true });
});

test('new: leading underscore names, --brand @preset, --formats 4x5, bad refs and flag combinations', () => {
  rmSync(DIR, { recursive: true, force: true });
  const r = run('new', '--template', '_smoke', '--name', NAME, '--formats', '4x5', '--brand', '@studio');
  assert.equal(r.status, 0, r.stderr);
  const p = readJ(PJ);
  assert.equal(p.brand, '@studio'); assert.deepEqual(p.formats, ['4x5']);
  assert.match(run('new', '--template', '_smoke', '--name', '__x').stderr, /must match/);
  assert.match(run('new', '--template', '_smoke', '--name', '_zz-x', '--brand', 'studio').stderr, /--brand must be a preset ref/);
  assert.match(run('new', '--template', '_smoke', '--name', '_zz-x', '--brand', '@no-such-brand').stderr, /brand preset "@no-such-brand" not found/);
  assert.match(run('new', '--template', '_smoke', '--page', '--name', '_zz-x').stderr, /use --template or --page, not both/);
  assert.ok(!existsSync(join(ROOT, 'projects', '_zz-x')));
});

test('4x5: every template example lays out in 4x5 (lint --fast: safe area, fit, readability, cadence)', async () => {
  assert.ok(TEMPLATES.length >= 7);
  for (const t of TEMPLATES) {
    const name = T45(t), dir = join(ROOT, 'projects', name);
    rmSync(dir, { recursive: true, force: true });
    const n = run('new', '--template', t, '--name', name, '--formats', '4x5');
    assert.equal(n.status, 0, `${t}: ${n.stderr}`);
    if (ASSETS_FROM[t]) ensurePrepared(ASSETS_FROM[t]);
    if (ASSETS_FROM[t]) cpSync(join(ROOT, 'projects', ASSETS_FROM[t], 'assets'), join(dir, 'assets'), { recursive: true });
    await prepareScaffold(name);
    const l = run('lint', `projects/${name}`, '--fast');
    assert.equal(l.status, 0, `${t}: ${l.stdout}${l.stderr}`);
    assert.deepEqual(readJ(join(dir, 'out/lint.json')).errors, [], t);
  }
});

test('renditions: lint, render and stills select a variant/cutdown and write to out/<variant>/<cutdown>/', () => {
  const p = readJ(PJ);
  p.variants = [{ id: 'de', overrides: { content: { hook: { lines: ['EINE ZEITLEISTE', 'VIER FORMATE'], accent: 'VIER' } }, brand: { extends: '@tallyport' } } }];
  p.cutdowns = [{ id: 'c6', duration: 6 }, { id: 'c8', duration: 8, keep: ['hook', 'metric', 'cta'] }];
  writeFileSync(PJ, JSON.stringify(p, null, 2));
  const l = run('lint', `projects/${NAME}`, '--fast', '--variant', 'de', '--cutdown', 'c6');
  assert.equal(l.status, 0, l.stdout + l.stderr);
  assert.deepEqual(readJ(join(DIR, 'out/de/c6/lint.json')).errors, []);
  const bad = run('lint', `projects/${NAME}`, '--fast', '--cutdown', 'c7');
  assert.equal(bad.status, 1); assert.match(bad.stdout, /cutdown "c7" is not in project.cutdowns \(full, c6, c8\)/);

  const r = run('render', `projects/${NAME}`, '--cutdown', 'c6', '--quiet');
  assert.equal(r.status, 0, r.stderr);
  assert.deepEqual(probe(join(DIR, 'out/main/c6/4x5/draft_silent.mp4')), ['video,1080,1350,180']);
  const range = run('render', `projects/${NAME}`, '--from', '0', '--to', '1');
  assert.equal(range.status, 0, range.stderr); assert.match(range.stdout, /draft_range\.mp4/);

  // stills: a pre-existing _frames folder (shared) must survive; private temp folders are cleaned up
  const fdir = join(DIR, 'out/main/c8/4x5');
  mkdirSync(join(fdir, '_frames'), { recursive: true }); writeFileSync(join(fdir, '_frames', 'keep.txt'), 'x');
  const s = run('stills', `projects/${NAME}`, '--cutdown', 'c8', '--sheet', 'contact,strip', '--tag', 'r1');
  assert.equal(s.status, 0, s.stderr);
  assert.match(s.stdout, /contact\.png \(16 frames, .* one per beat/);
  assert.match(s.stdout, /strip\.png \(12 frames, .* 12 frames across/);
  assert.deepEqual(pngSize(join(fdir, 'contact.png')), [6 * 270, 3 * 338]);
  assert.deepEqual(pngSize(join(fdir, 'strip.png')), [12 * 128, 160]);
  assert.ok(existsSync(join(fdir, 'strip_r1.png')));
  assert.ok(existsSync(join(fdir, '_frames', 'keep.txt')), 'shared _frames folder untouched');
  assert.deepEqual(readdirSync(fdir).filter((f) => f.startsWith('_frames-') || f.startsWith('_tile-')), []);
});

test('make: one rendition end to end with voice-over, captions (burned in + sidecars) and an export; renditions.json', () => {
  const p = readJ(PJ);
  // a supplied recording (the "file" engine, every OS): 2 s of tone stands in for speech, timed by a sidecar
  mkdirSync(join(DIR, 'assets'), { recursive: true });
  execFileSync('ffmpeg', ['-v', 'error', '-y', '-f', 'lavfi', '-i', 'sine=frequency=220:duration=2,adelay=2000|2000,apad=whole_dur=6', '-ac', '1', '-ar', '48000', join(DIR, 'assets/vo.wav')]);
  writeFileSync(join(DIR, 'assets/vo.segments.json'), JSON.stringify({ segments: [{ text: 'Eine Zeitleiste.', start: 2, end: 4 }] }));
  p.audio = { voiceover: { engine: 'file', file: 'assets/vo.wav' } };
  p.captions = { enabled: true, style: 'clean' };
  p.exports = ['720p'];
  writeFileSync(PJ, JSON.stringify(p, null, 2));
  const r = run('make', `projects/${NAME}`, '--variant', 'de', '--cutdown', 'c6', '--no-stills');
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.match(r.stderr, new RegExp(`voiceover: 1 lines -> projects/${reName(NAME)}/audio/de/c6/voice\\.wav`));
  assert.match(r.stderr, new RegExp(`captions: projects/${reName(NAME)}/out/de/c6/captions\\.srt`));
  assert.match(r.stderr, /export 720p: .*720p\.mp4/);
  assert.doesNotMatch(r.stderr, /skipped \(not implemented/);
  const m = readJ(join(DIR, 'out/de/c6/manifest.json'));
  assert.equal(m.variant, 'de'); assert.equal(m.cutdown, 'c6'); assert.equal(m.skipped, undefined);
  assert.deepEqual(m.exports.map((e) => `${e.format}:${e.preset}`), ['4x5:720p']);
  assert.equal(m.audio.voice.segments, 1); assert.equal(m.audio.voice.duck_db, -9);
  const vo = readJ(join(DIR, 'audio/de/c6/voiceover.json'));
  assert.equal(vo.segments[0].text, 'Eine Zeitleiste.'); assert.ok(vo.segments[0].start >= 1.9 && vo.segments[0].end <= 6);
  assert.match(readFileSync(join(DIR, 'out/de/c6/captions.srt'), 'utf8'), /^1\n00:00:0\d,\d{3} --> 00:00:0\d,\d{3}\nEine Zeitleiste\./);
  const lint = readJ(join(DIR, 'out/de/c6/lint.json'));
  assert.ok(lint.textqa, 'lint ran text QA'); assert.deepEqual(lint.errors, []);
  assert.equal(m.formats['4x5'].frames, 180); assert.equal(m.formats['4x5'].width, 1080); assert.equal(m.formats['4x5'].height, 1350);
  assert.ok(Math.abs(m.formats['4x5'].lufs.I + 14) <= 0.5);
  assert.equal(readJ(join(DIR, 'audio/de/c6/beats.json')).duration, 6);
  assert.deepEqual(readJ(join(DIR, 'out/de/c6/timeline.json')).cut.kept, ['hook', 'click', 'cta']);
  assert.deepEqual(probe(join(DIR, 'out/de/c6/4x5/draft.mp4'))[0], 'video,1080,1350,180');
  assert.deepEqual(readJ(join(DIR, 'out/renditions.json')).renditions.map((x) => `${x.variant}/${x.cutdown}`), ['de/c6']);
  assert.ok(!existsSync(join(DIR, 'out/4x5')), 'no legacy paths for a project with renditions');
});

test('make: a per-format duration override is rejected with a pointer to cutdowns', () => {
  const p = readJ(PJ); p.overrides = { '4x5': { duration: 4 } };
  writeFileSync(PJ, JSON.stringify(p, null, 2));
  const r = run('make', `projects/${NAME}`);
  assert.equal(r.status, 1);
  assert.match(r.stderr, /project\.overrides\.4x5\.duration: may not be overridden per format .*use cutdowns/);
});

test('bespoke page: new --page scaffolds a page that lints (with determinism) and renders like a template film', () => {
  rmSync(PDIR, { recursive: true, force: true });
  const n = run('new', '--page', '--name', PAGE, '--formats', '4x5,16x9');
  assert.equal(n.status, 0, n.stderr);
  assert.equal(readJ(join(PDIR, 'project.json')).page, 'page.html');
  const l = run('lint', `projects/${PAGE}`, '--format', '4x5');
  assert.equal(l.status, 0, l.stdout + l.stderr);
  assert.ok(readJ(join(PDIR, 'out/lint.json')).info.hashes >= 3);
  const r = run('render', `projects/${PAGE}`, '--formats', '16x9', '--quiet');
  assert.equal(r.status, 0, r.stderr);
  assert.deepEqual(probe(join(PDIR, 'out/16x9/draft_silent.mp4')), ['video,1920,1080,240']);
  // a banned API in page code fails the static lint
  writeFileSync(join(PDIR, 'page.html'), readFileSync(join(PDIR, 'page.html'), 'utf8').replace('const clamp', 'const jitter = Math.random();\nconst clamp'));
  const bad = run('lint', `projects/${PAGE}`, '--fast', '--format', '4x5');
  assert.equal(bad.status, 1); assert.match(bad.stdout, new RegExp(`static projects/${reName(PAGE)}/page\\.html:\\d+: Math\\.random is banned`));
});

test('capture --brand-preset writes brands/<id>.json + logo and --apply-brand points the project at it', { timeout: 180000 }, () => {
  rmSync(CDIR, { recursive: true, force: true });
  assert.equal(run('new', '--template', '_smoke', '--name', CAP, '--formats', '1x1').status, 0);
  const r = spawnSync('node', [join(ROOT, 'engine/cli/capture.mjs'), 'fixture:mock-product', `projects/${CAP}`, '--states', 'home', '--no-crops', '--no-full', '--apply-brand', '--brand-preset', PRESET], { cwd: ROOT, encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
  assert.equal(JSON.parse(r.stdout.trim().split('\n').pop()).brandPreset, `brands/${PRESET}.json`);
  const preset = readJ(join(ROOT, 'brands', `${PRESET}.json`));
  assert.equal(preset.id, PRESET); assert.equal(preset.colors.accent, '#3D5AFE');
  assert.equal(preset.logo, `brands/${PRESET}/logo.svg`); assert.ok(existsSync(join(ROOT, preset.logo)));
  assert.equal(readJ(join(CDIR, 'project.json')).brand, `@${PRESET}`);
  const l = run('lint', `projects/${CAP}`, '--fast');
  assert.equal(l.status, 0, l.stdout + l.stderr);
});
