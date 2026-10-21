// Engine maintenance round 2: fixes reported while building the logo-sting, lower-third and social-ad templates
// (docs/SPEC.md). Pure / fast tests; the CLI paths are covered by the existing CLI suites.
import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { PYTHON } from '../cli/lib/pipeline.mjs';
import { mkdtempSync, writeFileSync, readFileSync, rmSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { compile, deriveCues } from '../runtime.js';
import { makeGrid } from '../beat.js';
import { resolveProject, validate, PROJECT_SCHEMA } from '../schema.js';
import * as T from '../text.js';
import * as media from '../media.js';
import { justifyFits } from '../blocks.js';
import { placeLines } from '../cli/lib/voiceover.mjs';
import { isTransparent } from '../cli/lib/exporter.mjs';
import { musicStage, checkBeatsFresh, audioSettings } from '../cli/lib/audio.mjs';
import { overlaps } from '../cli/lib/textqa.mjs';
import { tile } from '../cli/lib/ffmpeg.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const TMP = mkdtempSync(join(tmpdir(), 'maint2-'));
after(() => rmSync(TMP, { recursive: true, force: true }));
const grid = makeGrid({ bpm: 120 }, 8); // 16 beats, 0.5 s per beat
const sc = (id, beats, extra = {}) => ({ id, beats, draw() {}, ...extra });

test('sfx dur: a scene sets whoosh/swish/riser length (time ref: beats or "s"), passed to cues.json in seconds', () => {
  const tl = compile({ scenes: [sc('a', 16, { sfx: [{ at: 2, sfx: 'riser', dur: 2 }, { at: 4, sfx: 'whoosh', dur: 's0.4' }, { at: 6, sfx: 'pop' }] })] }, grid, {});
  assert.deepEqual(tl.cues.cues.map((c) => [c.sfx, c.dur]), [['riser', 1], ['whoosh', 0.4], ['pop', undefined]]);
  assert.throws(() => compile({ scenes: [sc('a', 16, { sfx: [{ at: 0, sfx: 'thump', dur: 1 }] })] }, grid, {}), /fixed length; dur applies to whoosh, swish, riser/);
  assert.throws(() => compile({ scenes: [sc('a', 16, { sfx: [{ at: 4, sfx: 'riser', dur: 40 }] })] }, grid, {}), /use 0\.05-8 s/);
});

test('cues.py: a default riser into an early hit starts at t=0 (not cut off before the film); explicit dur and loops untouched', () => {
  const beats = join(TMP, 'beats.json'), cues = join(TMP, 'cues.json'), out = join(TMP, 'timed.json');
  writeFileSync(beats, JSON.stringify({ bpm: 120, beats: Array.from({ length: 16 }, (_, i) => i * 0.5) }));
  const run = (doc) => {
    writeFileSync(cues, JSON.stringify(doc));
    const r = spawnSync(PYTHON, ['-I', join(ROOT, 'engine/audio/cues.py'), '--cues', cues, '--beats', beats, '--out', out], { encoding: 'utf8' });
    assert.equal(r.status, 0, r.stderr);
    return JSON.parse(readFileSync(out, 'utf8')).cues;
  };
  const base = { bpm: 120, totalBeats: 16, loop: false };
  const [early] = run({ ...base, cues: [{ beat: 3, sfx: 'riser', gain_db: -7, pan: 0, id: 'sting:0' }] });
  assert.equal(early.dur, 1.5); assert.equal(early.t, 0, 'riser into beat 3 (1.5 s) starts on the first sample');
  const [late] = run({ ...base, cues: [{ beat: 12, sfx: 'riser', gain_db: -7, pan: 0, id: 'x:0' }] });
  assert.equal(late.dur, 2, 'one bar when there is room');
  const [given] = run({ ...base, cues: [{ beat: 3, sfx: 'riser', dur: 2, gain_db: -7, pan: 0, id: 'x:0' }] });
  assert.equal(given.dur, 2); assert.equal(given.t, -0.5);
  const [looped] = run({ ...base, loop: true, cues: [{ beat: 3, sfx: 'riser', gain_db: -7, pan: 0, id: 'x:0' }] });
  assert.equal(looped.dur, 2, 'a loop wraps the pre-roll onto the end instead');
});

test('events/sfx as functions of the real scene length; static fill-scene drops are reported', () => {
  const seen = [];
  const fill = sc('end', 'fill', {
    events: (beats) => { seen.push(beats); return [0, beats - 1]; },
    sfx: (beats) => [{ at: beats - 1, sfx: 'thump' }],
  });
  const tl = compile({ scenes: [sc('a', 10), fill] }, grid, {});
  assert.deepEqual(seen, [6]);
  assert.deepEqual(tl.cues.cues.map((c) => c.beat), [15]);
  assert.deepEqual(tl.warnings, []);
  const stat = compile({ scenes: [sc('a', 10), sc('b', 'fill', { events: [1, 7], sfx: [{ at: 7, sfx: 'pop' }] })] }, grid, {});
  assert.equal(stat.warnings.length, 1); assert.match(stat.warnings[0], /fill scene "b" gets 6 beats; dropped 1 event\(s\) and 1 sfx/);
  assert.throws(() => compile({ scenes: [sc('a', 16, { events: () => 3 })] }, grid, {}), /events must be an array/);
});

test('voice-over: {scene, at} anchors follow the scene; a cutdown that drops the scene drops the line', () => {
  const g = makeGrid({ bpm: 120 }, 8);
  const scenes = [{ id: 'hook', startBeat: 0, beats: 4 }, { id: 'cta', startBeat: 8, beats: 8 }];
  const r = placeLines([{ text: 'a', at: { scene: 'cta', at: 0.5 } }, { text: 'b', at: { scene: 'hook' } }], [0.4, 0.4], g, 8, { scenes });
  assert.deepEqual(r.items.map((x) => x.beat), [8.5, 10.5], 'second line pushed after the first (warning)');
  assert.match(r.warnings[0], /line 2 at beat 0 overlaps line 1/);
  const cut = placeLines([{ text: 'a', at: { scene: 'board' } }, { text: 'b', at: { scene: 'cta', at: 1 } }], [0.4, 0.4], g, 8, { scenes, drop: true });
  assert.deepEqual(cut.dropped, [0]); assert.match(cut.warnings[0], /anchored to scene "board", which is not in this cutdown/);
  assert.equal(cut.items[0].beat, 9);
  assert.throws(() => placeLines([{ text: 'a', at: { scene: 'board' } }], [0.4], g, 8, { scenes }), /not in this film/);
  assert.throws(() => placeLines([{ text: 'a', at: { scene: 'hook', at: 9 } }], [0.4], g, 8, { scenes }), /outside scene "hook"/);
  const line = (at) => validate({ text: 'x', at }, PROJECT_SCHEMA.properties.audio.properties.voiceover.properties.lines.items).errors;
  assert.deepEqual(line({ scene: 'cta', at: 'b1' }), []); assert.deepEqual(line('bar2'), []);
  assert.ok(line({ at: 1 }).length && line({ scene: 'cta', x: 1 }).length);
});

test('variants may override exports and transparent; isTransparent follows the rendition', () => {
  const t = { id: 'x', transparent: true, defaults: { exports: ['prores-alpha'] } };
  const p = { template: 'x', title: 'T', formats: ['1x1'], content: {}, transparent: true,
    brand: { colors: { bg: '#000000', fg: '#FFFFFF', accent: '#FF0000' }, fonts: { display: { family: 'A' }, ui: { family: 'B' } } },
    variants: [{ id: 'demo', overrides: { exports: [], transparent: false } }] };
  const main = resolveProject(p, t), demo = resolveProject(p, t, '1x1', { variant: 'demo' });
  assert.deepEqual(main.errors, []); assert.deepEqual(demo.errors, []);
  assert.deepEqual(demo.base.exports, []); assert.deepEqual(main.base.exports, ['prores-alpha']);
  assert.equal(isTransparent({ template: t, project: p, base: main.base }), true);
  assert.equal(isTransparent({ template: t, project: p, base: demo.base }), false);
  assert.equal(isTransparent({ template: t, project: { ...p, transparent: undefined }, base: {} }), true, 'template default');
});

test('audio.music "none": exact nominal grid, no music file; a stale grid is refused', async () => {
  const dir = join(TMP, 'none');
  const P = { base: { bpm: 120, duration: 4, audio: { music: 'none' } }, dir, rel: (x) => x };
  const S = audioSettings(P), A = { dir, beats: join(dir, 'beats.json'), music: join(dir, 'music.wav'), track48: join(dir, 'track_48k.wav') };
  const r = await musicStage(P, A, S, () => {});
  assert.equal(r.source, 'none'); assert.equal(r.file, null);
  const b = JSON.parse(readFileSync(A.beats, 'utf8'));
  assert.equal(b.source, 'none'); assert.equal(b.duration, 4); assert.equal(b.beats.length, 8); assert.deepEqual(b.downbeats, [0, 2]);
  assert.match(checkBeatsFresh(A, S), /none, 120 bpm/);
  assert.throws(() => checkBeatsFresh(A, { ...S, music: 'synth' }), /stale/);
  assert.equal(existsSync(A.music), false);
  assert.deepEqual(validate({ music: 'none' }, PROJECT_SCHEMA.properties.audio).errors, []);
});

test('text.readableOn / plateOn (the templates\' ink.js, now in the engine): AA + margin, theme-derived', () => {
  const mix = (a, b, p) => { const h = (k) => T.parseColor(T.paint(th, k)); const x = h(a), y = h(b); return `rgb(${x.map((v, i) => Math.round(v + (y[i] - v) * p)).join(',')})`; };
  const th = { colors: { bg: '#101010', fg: '#F5EFE6', accent: '#FF9F43', muted: '#5A5A5A', surface: '#1C1C1C' } };
  th.mix = mix;
  assert.equal(T.readableOn(th, 'fg', 'bg', 40), 'fg');
  const m = T.readableOn(th, 'muted', 'bg', 30);
  assert.match(m, /^rgb\(/); assert.ok(T.contrastRatio(m, th.colors.bg) >= 4.8);
  const pl = T.plateOn(th, 'accent', 30);
  assert.equal(pl.text, 'bg'); assert.ok(T.contrastRatio(T.paint(th, pl.fill), th.colors.bg) >= 4.8);
  // every template ink.js delegates to it with (api, ...)
  for (const t of ['data-story', 'explainer', 'morph-loop', 'product-launch', 'showreel'])
    assert.match(readFileSync(join(ROOT, 'templates', t, 'ink.js'), 'utf8'), /api\.T\.readableOn/);
});

function mockCtx() {
  return {
    font: '400 10px x', letterSpacing: '0px', fillStyle: '', calls: [],
    measureText(s) { const size = parseFloat(/([\d.]+)px/.exec(this.font)[1]); return { width: s.length * size * 0.6, actualBoundingBoxAscent: size * 0.7 }; },
    fillText(s) { this.calls.push(s); }, save() {}, restore() {}, translate() {}, scale() {}, getTransform: () => ({ isIdentity: true }),
    beginPath() {}, rect() {}, clip() {},
  };
}
const th = { colors: { bg: '#000000', fg: '#FFFFFF', accent: '#FF0000', muted: '#777777', surface: '#111111' },
  fonts: { display: { family: 'D', weight: 800, tracking: 0 }, ui: { family: 'U', weight: 400, tracking: 0 } } };

test('skipInk / paintedInk: one text can be left out of a frame (occlusion test), kinetic units attribute their glyphs', () => {
  const ctx = mockCtx();
  T.resetLog('frame');
  T.drawText(ctx, th, 'A', 0, 50, { size: 20 });
  T.drawText(ctx, th, 'B', 0, 90, { size: 20 });
  T.drawText(ctx, th, 'C', 0, 90, { size: 20, log: false });
  assert.deepEqual(ctx.calls, ['A', 'B', 'C']); assert.ok(T.paintedInk(0) && T.paintedInk(1));
  ctx.calls = []; T.resetLog('frame'); T.skipInk(1);
  try { T.drawText(ctx, th, 'A', 0, 50, { size: 20 }); T.drawText(ctx, th, 'B', 0, 90, { size: 20 }); } finally { T.skipInk(-1); }
  assert.deepEqual(ctx.calls, ['A']);
  const k = mockCtx(); T.resetLog('frame');
  const fit = { role: 'display', size: 20, cap: 14, weight: undefined, overflow: false, lines: [{ s: 'GO NOW', x: 0, y: 40, w: 72 }] };
  T.kinetic({ ctx: k, theme: th, since: () => 10, grid: { spb: 0.5 } }, fit, { by: 'word' });
  assert.equal(T.getLog().texts.length, 2); assert.ok(T.paintedInk(0) && T.paintedInk(1), 'kinetic glyphs belong to their slots');
});

test('textqa overlaps: an occluded text (no glyphs show) is not an overlap', () => {
  const s = (str, extra = {}) => ({ t: 1, state: 'rest', s: str, size: 40, box: { x: 0, y: 0, w: 200, h: 30 }, ...extra });
  assert.equal(overlaps([s('UNDER'), s('PANEL')]).length, 1);
  assert.equal(overlaps([s('UNDER', { occluded: true }), s('PANEL')]).length, 0);
});

test('justifyFits: every line of a stack is equally wide (no per-line cap); a one-line block keeps the cap', () => {
  const api = { ctx: mockCtx(), theme: th, F: { orient: 'v', h: 1920, u: 1 } };
  const ws = (lines, box) => justifyFits(api, lines, box).map((f) => Math.round(f.box.w));
  const two = ws(['SHIP', 'IT'], { x: 0, y: 0, w: 900, h: 1300 });
  assert.equal(two[0], two[1]); assert.equal(two[0], 900);
  const four = ws(['ONE', 'TIMELINE', 'FOUR', 'FORMATS'], { x: 0, y: 0, w: 900, h: 600 });
  assert.ok(four.every((w) => w === four[0]) && four[0] < 900, `${four}`);
  const one = justifyFits(api, ['IT'], { x: 0, y: 0, w: 900, h: 1000 })[0];
  assert.ok(one.cap <= 1000 * 0.42 + 1 && one.box.w < 900, `${one.cap} ${one.box.w}`);
});

test('media: plateLayout / drawPlate / plateCues are exported; drawMedia logs its box for lint', () => {
  assert.equal(typeof media.plateLayout, 'function'); assert.equal(typeof media.drawPlate, 'function'); assert.equal(typeof media.plateCues, 'function');
  assert.deepEqual(media.plateCues(1, 3, 8).sfx.map((m) => m.sfx), ['swish', 'pop', 'swish']);
  T.resetLog('frame');
  T.logMedia({ getTransform: () => ({ isIdentity: true }) }, { x: 0, y: 0, w: 10, h: 20 });
  assert.deepEqual(T.getLog().media, [{ kind: 'media', box: { x: 0, y: 0, w: 10, h: 20 } }]);
});

test('tile: unused grid slots get a grey checkerboard, never black', async () => {
  const frames = [];
  for (let i = 0; i < 4; i++) {
    const f = join(TMP, `f${i}.png`);
    spawnSync('ffmpeg', ['-y', '-loglevel', 'error', '-f', 'lavfi', '-i', 'color=c=red:s=64x64:d=1', '-frames:v', '1', f]);
    frames.push(f);
  }
  const out = join(TMP, 'sheet.png');
  const r = await tile({ frames, cols: 3, out });
  assert.deepEqual([r.cols, r.rows], [3, 2]);
  const raw = spawnSync('ffmpeg', ['-loglevel', 'error', '-i', out, '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-'], { maxBuffer: 1 << 24 }).stdout;
  const px = (x, y) => [...raw.subarray((y * 192 + x) * 3, (y * 192 + x) * 3 + 3)];
  const [r0, g0, b0] = px(10, 10);
  assert.ok(r0 > 240 && g0 < 16 && b0 < 16, 'frames keep their pixels');
  for (const [x, y] of [[64 + 3, 64 + 3], [128 + 30, 64 + 30], [128 + 3, 64 + 10]]) {
    const [rr, gg, bb] = px(x, y);
    assert.ok(rr === gg && gg === bb && rr >= 100, `slot pixel ${x},${y} is grey (${rr},${gg},${bb})`);
  }
});
