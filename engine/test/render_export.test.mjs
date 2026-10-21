// render-export tests: segment cache + range splice (frame-exact vs a full render), reuse after a local edit,
// loop seam with the centred wrapped shutter, every export preset (ffprobe) and the transparent ProRes. About 4 min.
import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync, execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, rmSync, existsSync, cpSync, mkdtempSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { uniq, reName } from './_names.mjs';
import { tmpdir } from 'node:os';
import { segmentPlan, segmentsFor, renderFormat, preset, subframeTime } from '../cli/lib/video.mjs';
import { exportPresets, exportSize, EXPORT_PRESETS, PLATFORMS, isTransparent } from '../cli/lib/exporter.mjs';
import { framemd5File, ssim, probe, encoder } from '../cli/lib/ffmpeg.mjs';
import { loadProject } from '../cli/lib/project.mjs';
import { startServer } from '../cli/lib/server.mjs';
import { launch, openPage } from '../cli/lib/browser.mjs';
import { PROJECT_SCHEMA } from '../schema.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const SPL = uniq('_rxt-splice'), LOOP = uniq('_rxt-loop'), EXP = uniq('_rxt-exp'), ALP = uniq('_rxt-alpha'), TPL = ALP;
const pdir = (n) => join(ROOT, 'projects', n);
const run = (cmd, ...args) => spawnSync('node', [join(ROOT, 'engine', 'cli', `${cmd}.mjs`), ...args], { cwd: ROOT, encoding: 'utf8', timeout: 600000 });
const readJ = (f) => JSON.parse(readFileSync(f, 'utf8'));
const edit = (n, fn) => { const f = join(pdir(n), 'project.json'), p = readJ(f); fn(p); writeFileSync(f, JSON.stringify(p, null, 2)); };
const scaffold = (template, name, ...flags) => {
  rmSync(pdir(name), { recursive: true, force: true });
  const r = run('new', '--template', template, '--name', name, ...flags);
  assert.equal(r.status, 0, r.stderr);
};
const ffprobe = (f) => JSON.parse(execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'stream=codec_type,codec_name,width,height,pix_fmt:format=duration', '-of', 'json', f], { encoding: 'utf8' }));
after(() => { for (const n of [SPL, LOOP, EXP, ALP]) rmSync(pdir(n), { recursive: true, force: true }); rmSync(join(ROOT, 'templates', TPL), { recursive: true, force: true }); });

test('segment plan: fixed 1 s GOP-aligned segments; ranges map to the segments they touch', () => {
  assert.deepEqual(segmentPlan(95, 30).map((s) => [s.f0, s.f1]), [[0, 30], [30, 60], [60, 90], [90, 95]]);
  assert.deepEqual(segmentPlan(60, 60).map((s) => [s.f0, s.f1]), [[0, 60]]);
  const plan = segmentPlan(300, 30);
  assert.deepEqual(segmentsFor(plan, 45, 61).map((s) => s.index), [1, 2]);
  assert.deepEqual(segmentsFor(plan, 60, 90).map((s) => s.index), [2]);
});

test('export presets: ids match the schema; sizes per format; platform table', () => {
  assert.deepEqual([...EXPORT_PRESETS], PROJECT_SCHEMA.properties.exports.items.enum);
  assert.deepEqual(exportSize('720p', '9x16'), [720, 1280]); assert.deepEqual(exportSize('720p', '4x5'), [720, 900]);
  assert.deepEqual(exportSize('4k', '16x9'), [3840, 2160]); assert.deepEqual(exportSize('4k', '9x16'), [2160, 3840]);
  assert.deepEqual(exportSize('gif', '16x9'), [540, 304]);
  assert.deepEqual(PLATFORMS.tiktok.formats, ['9x16']); assert.deepEqual(PLATFORMS.reels.formats, ['9x16']);
  assert.deepEqual(PLATFORMS.youtube.formats, ['16x9']); assert.deepEqual(PLATFORMS.linkedin.formats, ['4x5', '1x1']);
  for (const p of Object.values(PLATFORMS)) assert.ok(p.lufs <= -9 && p.lufs >= -24 && p.tp <= 0 && p.maxSec > 0);
});

test('range render: segments re-rendered for --from/--to splice into the full film frame-exactly', () => {
  scaffold('_smoke', SPL, '--formats', '1x1', '--duration', '10');
  const full = run('render', `projects/${SPL}`, '--quiet');
  assert.equal(full.status, 0, full.stderr);
  assert.match(full.stdout, /300 frames, 30fps.*0\/10 segments cached/);
  const silent = join(pdir(SPL), 'out/1x1/draft_silent.mp4'), cdir = join(pdir(SPL), 'out/.cache/1x1');
  return framemd5File(silent).then(async (m0) => {
    assert.equal(m0.length, 300);
    // drop the cached segments of the range and the film itself: only those segments may be rendered again
    const keys = readJ(join(cdir, 'index.json')).films.draft.keys;
    for (const k of keys.slice(3, 5)) rmSync(join(cdir, 'seg', `${k}.mp4`));
    rmSync(silent);
    const r = run('render', `projects/${SPL}`, '--from', '3.4', '--to', 's4.5');
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stdout, /draft_range\.mp4 \(60 frames, 30fps, 3\.00s-5\.00s, 2 rendered \+ 0 cached segments\)/);
    assert.match(r.stdout, new RegExp(`spliced into projects/${reName(SPL)}/out/1x1/draft_silent\\.mp4`));
    assert.deepEqual(await framemd5File(silent), m0, 'spliced film decodes to exactly the frames of the full render');
    assert.deepEqual(await framemd5File(join(pdir(SPL), 'out/1x1/draft_range.mp4')), m0.slice(90, 150));
    const bad = run('render', `projects/${SPL}`, '--from', '5', '--to', '4');
    assert.equal(bad.status, 1); assert.match(bad.stderr, /must be before --to/);
  });
});

test('reuse: after an edit to one scene only the changed segments render; result equals a cold render', async () => {
  edit(SPL, (p) => { p.content.cta.text = 'Ship the cut'; });
  const r = run('render', `projects/${SPL}`, '--quiet');
  assert.equal(r.status, 0, r.stderr);
  const m = /(\d+)\/10 segments cached/.exec(r.stdout);
  assert.ok(m && Number(m[1]) > 0 && Number(m[1]) < 10, r.stdout);
  const P = loadProject(`projects/${SPL}`), srv = await startServer(), browser = await launch();
  const tmp = mkdtempSync(join(tmpdir(), 'rx-cold-'));
  try {
    const cold = await renderFormat({ P, format: '1x1', q: preset('draft'), base: srv.base, browser, out: join(tmp, 'cold.mp4'), cacheDir: join(tmp, 'cache') });
    assert.equal(cold.cached, 0);
    assert.deepEqual(await framemd5File(join(pdir(SPL), 'out/1x1/draft_silent.mp4')), await framemd5File(cold.out));
  } finally { await browser.close(); await srv.close(); rmSync(tmp, { recursive: true, force: true }); }
});

test('loop seam: frame 0 blends sub-frames wrapped from the end (SSIM >= 0.999), no jump at the seam', async () => {
  scaffold('morph-loop', LOOP, '--formats', '1x1');
  const fps = 12, sub = 4, rate = fps * sub;
  const r = run('render', `projects/${LOOP}`, '--quality', 'final', '--fps', String(fps), '--sub', String(sub), '--quiet');
  assert.equal(r.status, 0, r.stderr);
  const film = join(pdir(LOOP), 'out/1x1/silent.mp4'), N = (await probe(film)).frames;
  const P = loadProject(`projects/${LOOP}`), srv = await startServer(), browser = await launch();
  const tmp = mkdtempSync(join(tmpdir(), 'rx-seam-'));
  try {
    const s = await openPage({ browser, base: srv.base, project: P.name, format: '1x1', quiet: true });
    const D = s.info.duration;
    assert.equal(s.info.loop, true);
    // expected frame 0, built independently: sub-frames at +-0.5/rate and +-1.5/rate around t=0, the negative ones taken from the end
    const blend = async (times, out) => {
      const enc = encoder({ out, fps, sub, crf: 16, preset: 'slow', gop: fps });
      for (const t of times) { await s.seek(t); await enc.write(await s.shot()); }
      await enc.end();
    };
    const wrapped = [D - 1.5 / rate, D - 0.5 / rate, 0.5 / rate, 1.5 / rate];
    assert.deepEqual([0, 1, 2, 3].map((i) => +subframeTime(i, rate, sub, D, true).toFixed(9)), wrapped.map((t) => +t.toFixed(9)));
    await blend(wrapped, join(tmp, 'wrapped.mp4'));
    await blend([0, 1 / rate, 2 / rate, 3 / rate], join(tmp, 'forward.mp4')); // v1 forward shutter
    await s.close();
    const seam = await ssim({ a: film, b: join(tmp, 'wrapped.mp4'), frameA: 0, frameB: 0 });
    const v1 = await ssim({ a: film, b: join(tmp, 'forward.mp4'), frameA: 0, frameB: 0 });
    assert.ok(seam >= 0.999, `frame 0 vs wrapped blend SSIM ${seam}`);
    assert.ok(v1 < seam, `forward shutter (${v1}) must differ from the wrapped frame 0 (${seam})`);
    // the step across the seam is no larger than ordinary motion inside the film
    const across = await ssim({ a: film, b: film, frameA: N - 1, frameB: 0 });
    const inside = [];
    for (let k = 1; k < N; k += Math.floor(N / 12)) inside.push(await ssim({ a: film, b: film, frameA: k - 1, frameB: k }));
    assert.ok(across >= Math.min(...inside), `seam step SSIM ${across} vs in-film minimum ${Math.min(...inside)}`);
  } finally { await browser.close(); await srv.close(); rmSync(tmp, { recursive: true, force: true }); }
});

test('exports: make builds every preset that fits each format (ffprobe-valid), skips the rest, reuses stamps', async () => {
  scaffold('_smoke', EXP, '--formats', '9x16,16x9,1x1', '--duration', '10');
  edit(EXP, (p) => { p.exports = ['720p', 'webm', 'gif', 'tiktok', 'reels', 'youtube', 'linkedin', 'prores-alpha']; });
  const r = run('make', `projects/${EXP}`, '--no-stills');
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.match(r.stderr, /\[1x1\] export tiktok: not for 1x1 \(needs 9x16\)/);
  assert.match(r.stderr, /warning: export prores-alpha skipped \(needs transparent: true/);
  const want = { '9x16': ['720p', 'webm', 'gif', 'tiktok', 'reels'], '16x9': ['720p', 'webm', 'gif', 'youtube'], '1x1': ['720p', 'webm', 'gif', 'linkedin'] };
  const m = readJ(join(pdir(EXP), 'out/manifest.json'));
  for (const [fmt, ids] of Object.entries(want)) {
    assert.deepEqual(m.exports.filter((e) => e.format === fmt).map((e) => e.preset).sort(), [...ids].sort(), fmt);
    for (const id of ids) {
      const f = join(pdir(EXP), 'out', fmt, 'export', `${id}.${{ webm: 'webm', gif: 'gif' }[id] || 'mp4'}`);
      const j = ffprobe(f), v = j.streams.find((x) => x.codec_type === 'video'), a = j.streams.find((x) => x.codec_type === 'audio');
      assert.equal(v.codec_name, { webm: 'vp9', gif: 'gif' }[id] || 'h264', `${fmt} ${id}`);
      assert.deepEqual([v.width, v.height], exportSize(id, fmt), `${fmt} ${id} size`);
      assert.ok(Math.abs(Number(j.format.duration) - 10) < 0.15, `${fmt} ${id} duration ${j.format.duration}`);
      if (id !== 'gif') assert.ok(a, `${fmt} ${id} has audio`);
    }
  }
  const again = run('make', `projects/${EXP}`, '--no-stills', '--formats', '1x1');
  assert.equal(again.status, 0, again.stderr);
  assert.match(again.stderr, /export webm up to date/);
  // 4k: a real re-render at deviceScaleFactor 2 (not an upscale): 2x size, and it downsamples onto the 1x frame
  const P = loadProject(`projects/${EXP}`), dir = P.outDir('1x1');
  const done = await exportPresets({ P, format: '1x1', video: join(dir, 'draft.mp4'), silent: join(dir, 'draft_silent.mp4'), quality: 'draft', presets: ['4k'], outDir: dir });
  assert.deepEqual(done.map((d) => [d.preset, d.width, d.height, d.codec]), [['4k', 2160, 2160, 'h264']]);
  const k4 = join(dir, 'export/4k.mp4');
  assert.ok(ffprobe(k4).streams.some((x) => x.codec_type === 'audio'));
  const tmp = mkdtempSync(join(tmpdir(), 'rx-4k-'));
  try {
    execFileSync('ffmpeg', ['-loglevel', 'error', '-i', k4, '-vf', 'scale=1080:1080:flags=area', '-c:v', 'libx264', '-crf', '10', join(tmp, 'down.mp4')]);
    const sim = await ssim({ a: join(tmp, 'down.mp4'), b: join(dir, 'draft_silent.mp4'), frameA: 150, frameB: 150 });
    assert.ok(sim > 0.97, `4k downsampled vs 1x SSIM ${sim}`);
  } finally { rmSync(tmp, { recursive: true, force: true }); }
});

test('prores-alpha: transparent template renders ProRes 4444 with a real alpha channel', async () => {
  const tdir = join(ROOT, 'templates', TPL);
  rmSync(tdir, { recursive: true, force: true });
  cpSync(join(ROOT, 'templates', '_smoke'), tdir, { recursive: true });
  const tj = readJ(join(tdir, 'template.json')); tj.id = TPL; tj.transparent = true;
  writeFileSync(join(tdir, 'template.json'), JSON.stringify(tj, null, 2));
  scaffold(TPL, ALP, '--formats', '1x1', '--duration', '10');
  const r = run('render', `projects/${ALP}`, '--quiet');
  assert.equal(r.status, 0, r.stderr);
  const P = loadProject(`projects/${ALP}`), dir = P.outDir('1x1');
  assert.ok(isTransparent(P));
  const done = await exportPresets({ P, format: '1x1', video: null, silent: join(dir, 'draft_silent.mp4'), quality: 'draft', presets: ['prores-alpha'], outDir: dir });
  assert.equal(done.length, 1);
  const f = join(dir, 'export/prores-alpha.mov'), j = ffprobe(f), v = j.streams.find((x) => x.codec_type === 'video');
  assert.equal(v.codec_name, 'prores'); assert.match(v.pix_fmt, /^yuva444p1[02]le$/); assert.deepEqual([v.width, v.height], [1080, 1080]);
  // frame 150 (mid chart scene): background pixels are fully transparent, drawn pixels opaque
  const raw = execFileSync('ffmpeg', ['-loglevel', 'error', '-i', f, '-vf', "select='eq(n\\,150)'", '-frames:v', '1', '-f', 'rawvideo', '-pix_fmt', 'rgba', '-'], { maxBuffer: 64 << 20 });
  let clear = 0, solid = 0;
  for (let i = 3; i < raw.length; i += 4) { if (raw[i] === 0) clear++; else if (raw[i] === 255) solid++; }
  const n = raw.length / 4;
  assert.ok(clear / n > 0.4, `transparent share ${clear / n}`);
  assert.ok(solid / n > 0.02, `opaque share ${solid / n}`);
  assert.ok(existsSync(f));
});
