// captions + text QA unit tests (pure parts): word timing, manual segments, burned-in layout and drawing
// (mock canvas), SRT/VTT sidecars, WCAG helpers, ink switch, and lint text-QA classification.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import * as T from '../text.js';
import { frame } from '../layout.js';
import { makeGrid } from '../beat.js';
import { wordTimes, segmentsFromLines, drawCaptions, layoutSegment, captionZone, activePage, CAPTION_STYLES } from '../captions.js';
import { writeSidecars, manualSegments, cuesOf, wrapChars, stamp, LINE_CHARS } from '../cli/lib/captions.mjs';
import { classify, summarize, mergeUnits, qaTimes, PHONE_MIN_PX } from '../cli/lib/textqa.mjs';

function mockCtx() {
  const calls = [];
  return {
    font: '400 10px x', letterSpacing: '0px', fillStyle: '', textAlign: 'left', textBaseline: 'alphabetic', calls,
    measureText(s) { const size = parseFloat(/([\d.]+)px/.exec(this.font)[1]); return { width: s.length * size * 0.6 }; },
    fillText(s, x, y) { calls.push(['fillText', s, this.m.e + x, this.m.f + y, this.fillStyle]); },
    m: { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 }, stack: [],
    save() { this.stack.push({ ...this.m }); }, restore() { this.m = this.stack.pop(); },
    translate(x, y) { const m = this.m; this.m = { ...m, e: m.e + m.a * x + m.c * y, f: m.f + m.b * x + m.d * y }; },
    scale(sx, sy) { const m = this.m; this.m = { ...m, a: m.a * sx, b: m.b * sx, c: m.c * sy, d: m.d * sy }; },
    getTransform() { const m = this.m; return { ...m, isIdentity: m.a === 1 && m.b === 0 && m.c === 0 && m.d === 1 && m.e === 0 && m.f === 0 }; },
    beginPath() {}, rect() {}, clip() {}, fill() { calls.push(['fill', this.fillStyle]); },
    roundRect(x, y, w, h) { calls.push(['roundRect', x, y, w, h]); },
  };
}
const theme = {
  colors: { bg: '#101113', fg: '#F2EFE8', accent: '#FF5A1F', muted: '#777777', surface: '#1C1D20' },
  fonts: { display: { family: 'D', weight: 800, tracking: 0 }, ui: { family: 'U', weight: 400, tracking: 0.02 } },
  mix: (a, b, p) => `rgb(${p},${p},${p})`,
};
const within = (b, z, tol = 0.5) => b.x >= z.x - tol && b.y >= z.y - tol && b.x + b.w <= z.x + z.w + tol && b.y + b.h <= z.y + z.h + tol;

test('wordTimes: proportional to characters, contiguous, covering the segment', () => {
  const w = wordTimes('a bbb cc', 1, 2.1);
  assert.deepEqual(w.map((x) => x.w), ['a', 'bbb', 'cc']);
  assert.equal(w[0].start, 1); assert.ok(Math.abs(w[2].end - 2.1) < 1e-9);
  for (let i = 1; i < w.length; i++) assert.ok(Math.abs(w[i].start - w[i - 1].end) < 1e-12);
  // weights 2, 4, 3 of 9
  assert.ok(Math.abs((w[1].end - w[1].start) / 1.1 - 4 / 9) < 1e-9);
});

test('segmentsFromLines / manualSegments: refs to seconds, open ends run to the next line or the film end', () => {
  const grid = makeGrid({ bpm: 120 }, 8);
  const lines = [{ text: 'One', at: 0 }, { text: ' Two ', at: 'b4', end: 'b6' }, { text: 'Three', at: 'bar2' }];
  const segs = segmentsFromLines(lines, grid, grid.duration);
  assert.deepEqual(segs, [{ text: 'One', start: 0, end: 2 }, { text: 'Two', start: 2, end: 3 }, { text: 'Three', start: 4, end: 8 }]);
  const tl = { bpm: 120, duration: 8, beatTimes: Array.from({ length: 16 }, (_, i) => i * 0.5) };
  assert.deepEqual(manualSegments(lines, tl), segs);
  assert.throws(() => segmentsFromLines([{ text: 'x', at: 'b20' }], grid, 8), /outside the film/);
  assert.throws(() => segmentsFromLines([{ text: 'a', at: 4 }, { text: 'b', at: 2 }], grid, 8), /time order/);
  assert.throws(() => segmentsFromLines([{ text: '', at: 0 }], grid, 8), /needs text/);
  assert.throws(() => manualSegments(lines, {}), /needs a timeline/);
});

test('captionZone: inside the safe area in every format; clear of the 9x16 rail and platform UI', () => {
  for (const fmt of ['9x16', '1x1', '4x5', '16x9']) {
    const F = frame(fmt), z = captionZone(F);
    assert.ok(z.x >= F.safe.x && z.x + z.w <= F.safe.x + F.safe.w + 1e-9, fmt);
    assert.equal(z.bottom, F.safe.y + F.safe.h, fmt);
  }
  assert.equal(captionZone(frame('9x16')).bottom, 1920 - 400);
  assert.ok(captionZone(frame('9x16')).x >= 150);
  assert.equal(captionZone(frame('4x5')).bottom, 1350 - 120);
});

test('layoutSegment: at most 2 lines per page, words inside the zone, readable size, pages in time order', () => {
  const ctx = mockCtx();
  const long = 'Every frame is a pure function of time so the same film renders in four formats from one timeline without drift';
  for (const fmt of ['9x16', '4x5', '16x9']) {
    const F = frame(fmt), z = captionZone(F);
    const api = { F, theme, T, captions: { style: 'clean' } };
    const L = layoutSegment(ctx, api, { text: long, start: 1, end: 7 });
    assert.ok(L.size >= T.readable(F), fmt);
    assert.ok(L.pages.length >= 2, `${fmt} pages`);
    let prevEnd = 1;
    for (const p of L.pages) {
      assert.ok(p.lines.length <= 2 && p.lines.length >= 1);
      assert.ok(Math.abs(p.start - prevEnd) < 1e-9); prevEnd = p.end;
      assert.ok(p.plate.y + p.plate.h <= z.bottom + 1e-6, `${fmt} plate above the UI zone`);
      for (const l of p.lines) for (const w of l.words) assert.ok(w.x >= z.x - 0.5 && w.x + w.width <= z.x + z.w + 0.5, `${fmt} word "${w.w}" inside`);
    }
    assert.ok(Math.abs(prevEnd - 7) < 1e-9);
    assert.equal(L.pages.flatMap((p) => p.lines.flatMap((l) => l.words.map((w) => w.w))).join(' '), long);
    const space = T.measure(ctx, theme, 'ui', ' ', L.size).w;
    for (const p of L.pages) for (const l of p.lines) for (let i = 1; i < l.words.length; i++) {
      const gap = l.words[i].x - (l.words[i - 1].x + l.words[i - 1].width);
      assert.ok(gap >= space * 0.99, `${fmt}: a space between "${l.words[i - 1].w}" and "${l.words[i].w}" (gap ${gap.toFixed(1)})`);
    }
  }
  assert.throws(() => layoutSegment(ctx, { F: frame('9x16'), theme, T, captions: { style: 'neon' } }, { text: 'x', start: 0, end: 1 }), /unknown style "neon" \(use clean, bold, plain\)/);
  assert.ok(CAPTION_STYLES.bold.k > CAPTION_STYLES.clean.k);
});

test('drawCaptions: pure in t, accent pill on the spoken word, words logged inside the safe area, hold and gaps', () => {
  const F = frame('9x16');
  const segments = [{ text: 'Make it move', start: 1, end: 2.2 }, { text: 'Then ship it', start: 4, end: 5 }];
  const api = Object.freeze({ F, theme, T, grid: makeGrid({ bpm: 120 }, 8), captions: { enabled: true, style: 'clean' }, segments });
  const run = (t) => { const ctx = mockCtx(); T.resetLog('frame'); drawCaptions(ctx, api, t); return { calls: ctx.calls, log: T.getLog().texts }; };
  assert.deepEqual(run(0.5).calls, [], 'nothing before the first segment');
  assert.deepEqual(run(3).calls, [], 'gap after the 0.4 s hold');
  assert.ok(run(2.4).calls.length > 0, 'held 0.4 s after the end');
  const a = run(1.9), b = run(1.9);
  assert.deepEqual(a, b, 'deterministic');
  // every word in fg, then (clipped to the pill) the spoken word again in the colour that reads on the accent
  const texts = a.calls.filter((c) => c[0] === 'fillText').map((c) => c[1]);
  assert.deepEqual(texts, ['Make', 'it', 'move', 'move']);
  assert.ok(a.calls.some((c) => c[0] === 'fill' && c[1] === theme.colors.accent), 'accent pill drawn');
  const moves = a.calls.filter((c) => c[0] === 'fillText' && c[1] === 'move');
  assert.equal(moves[1][4], theme.colors.bg, 'the spoken word over the pill takes the colour that reads on the accent');
  const makeCall = a.calls.find((c) => c[0] === 'fillText' && c[1] === 'Make');
  assert.equal(makeCall[4], theme.colors.fg);
  assert.deepEqual(a.log.map((x) => [x.s, x.color]), [['Make', theme.colors.fg], ['it', theme.colors.fg], ['move', theme.colors.bg]], 'each word logged once, in the colour that covers it');
  for (const x of a.log) assert.ok(within(x.box, F.safe), `"${x.s}" inside the safe area`);
  for (const x of a.log) assert.ok(x.size >= T.readable(F));
  // the active word follows the estimated word times
  const first = run(1.02).calls.filter((c) => c[0] === 'fillText');
  assert.ok(first.some((c) => c[1] === 'Make' && c[4] !== theme.colors.fg), '"Make" is highlighting at its start');
  assert.ok(first.filter((c) => c[1] === 'move').every((c) => c[4] === theme.colors.fg));
  // segments with no layout-affecting change reuse the memo; an empty list draws nothing
  assert.doesNotThrow(() => drawCaptions(mockCtx(), { ...api, segments: [] }, 1));
  assert.throws(() => drawCaptions(mockCtx(), { ...api, segments: [{ text: 'x', start: 2, end: 1 }] }, 1.5), /start < end/);
});

test('drawCaptions: an accent that cannot carry AA text gets an underline bar instead of a pill', () => {
  const F = frame('4x5');
  const th = { ...theme, colors: { ...theme.colors, bg: '#FFFFFF', fg: '#202020', accent: '#3D7FFF' } };
  assert.ok(T.contrastRatio('#202020', '#3D7FFF') < 4.5 && T.contrastRatio('#FFFFFF', '#3D7FFF') < 4.5);
  const api = { F, theme: th, T, captions: { style: 'clean' }, segments: [{ text: 'Make it move', start: 0, end: 1.2 }] };
  const ctx = mockCtx(); T.resetLog('frame'); drawCaptions(ctx, api, 1.1);
  const words = ctx.calls.filter((c) => c[0] === 'fillText');
  assert.deepEqual(words.map((c) => c[4]), ['#202020', '#202020', '#202020'], 'every word stays fg');
  const rects = ctx.calls.filter((c) => c[0] === 'roundRect'), bar = rects[rects.length - 1];
  const move = words[2];
  assert.ok(bar[2] > move[3], 'bar sits below the baseline'); assert.ok(bar[4] < 0.2 * 44, 'a thin bar');
  const plate = rects[0];
  assert.ok(bar[2] + bar[4] <= plate[2] + plate[4] + 1e-6, 'bar inside the plate');
});

test('activePage: a long segment pages by its word times', () => {
  const ctx = mockCtx(), F = frame('9x16');
  const api = { F, theme, T, captions: {} };
  const seg = { text: 'one two three four five six seven eight nine ten eleven twelve thirteen fourteen fifteen sixteen', start: 0, end: 8 };
  const L = [layoutSegment(ctx, api, seg)];
  assert.ok(L[0].pages.length >= 2);
  const p2 = L[0].pages[1];
  assert.equal(activePage(L, [seg], p2.start + 0.01).page, p2);
  assert.equal(activePage(L, [seg], 0).page, L[0].pages[0]);
  assert.equal(activePage(L, [seg], 8.5), null);
});

test('sidecars: SRT + VTT, <= 2 lines of <= 42 chars, timed, escaped, byte-identical on rerun', () => {
  const dir = mkdtempSync(join(tmpdir(), 'cap-'));
  try {
    const segs = [{ text: 'Short one.', start: 0.5, end: 1.25 },
      { text: 'A much longer caption line that will not fit on two lines of forty-two characters, so it splits <here> & there.', start: 2, end: 9.0004 }];
    const { srt, vtt } = writeSidecars(segs, dir);
    const s1 = readFileSync(srt, 'utf8'), v1 = readFileSync(vtt, 'utf8');
    assert.match(s1, /^1\n00:00:00,500 --> 00:00:01,250\nShort one\.\n\n2\n00:00:02,000 --> /);
    assert.match(v1, /^WEBVTT\n\n00:00:00\.500 --> 00:00:01\.250\nShort one\.\n/);
    assert.match(v1, /&lt;here&gt; &amp; there\./);
    assert.match(s1, /<here> & there\./);
    const cues = cuesOf(segs);
    assert.ok(cues.length >= 3);
    for (const c of cues) { assert.ok(c.lines.length <= 2); for (const l of c.lines) assert.ok(l.length <= LINE_CHARS); assert.ok(c.end > c.start); }
    assert.equal(cues[cues.length - 1].end, 9000);
    for (let i = 1; i < cues.length; i++) assert.ok(cues[i].start >= cues[i - 1].end);
    writeSidecars(segs, dir);
    assert.equal(readFileSync(srt, 'utf8'), s1); assert.equal(readFileSync(vtt, 'utf8'), v1);
    assert.ok(!/\r/.test(s1 + v1));
    assert.throws(() => writeSidecars([{ text: 'x', start: 2, end: 1 }], dir), /start < end/);
    assert.equal(stamp(3723004, ','), '01:02:03,004');
    assert.deepEqual(wrapChars('aaaa bbbb cccc', 9), ['aaaa bbbb', 'cccc']);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('text.js: WCAG contrast helpers, logged colour/rest flags, ink switch', () => {
  assert.equal(+T.contrastRatio('#000000', '#FFFFFF').toFixed(2), 21);
  assert.equal(+T.contrastRatio('#777777', '#FFFFFF').toFixed(2), 4.48);
  assert.equal(T.contrastRatio('rgb(255,255,255)', [0, 0, 0]), T.contrastRatio('#fff', '#000'));
  assert.equal(T.parseColor('nope'), null);
  assert.equal(T.contrastNeed(47.9), 4.5); assert.equal(T.contrastNeed(48), 3);
  assert.equal(T.bestOn(theme, '#FFE600'), 'bg'); assert.equal(T.bestOn(theme, '#202080'), 'fg');
  const ctx = mockCtx();
  T.resetLog('frame');
  T.drawText(ctx, theme, 'HI', 10, 50, { size: 40, color: 'accent' });
  T.drawText(ctx, theme, 'YO', 10, 90, { size: 40, rest: [10, 100] });
  T.logRest(ctx, theme, 'Z', 0, 40, { size: 40, color: 'fg' });
  const log = T.getLog().texts;
  assert.equal(log[0].color, '#FF5A1F'); assert.ok(!log[0].rest);
  assert.ok(log[1].rest); assert.equal(log[2].color, '#F2EFE8'); assert.ok(log[2].rest);
  assert.equal(T.setInk(false), true);
  try {
    const c2 = mockCtx(); T.resetLog('frame');
    T.drawText(c2, theme, 'HIDDEN', 10, 50, { size: 40 });
    assert.equal(c2.calls.length, 0, 'no glyphs with ink off');
    assert.equal(T.getLog().texts.length, 1, 'still logged');
  } finally { T.setInk(true); }
  assert.equal(T.inkOn(), true);
});

test('textqa: classify contrast (4.5 / 3 at 48 px), safe area, canvas clipping, bleed, 9x16 phone floor', () => {
  const base = { state: 'rest', s: 'Hi', size: 40, box: { x: 200, y: 600, w: 300, h: 30 }, contrast: 7, median: 9, fg: '#FFFFFF', bg: '#000000', bleed: false };
  assert.deepEqual(classify(base, '9x16'), []);
  assert.deepEqual(classify({ ...base, contrast: 4.2 }, '9x16').map((i) => i.kind), ['contrast']);
  assert.deepEqual(classify({ ...base, contrast: 4.2, size: 60 }, '9x16'), [], 'large text needs 3');
  assert.deepEqual(classify({ ...base, contrast: 2.9, size: 60 }, '9x16').map((i) => i.need), [3]);
  assert.deepEqual(classify({ ...base, box: { x: 20, y: 600, w: 300, h: 30 } }, '9x16').map((i) => i.kind), ['safe']);
  assert.deepEqual(classify({ ...base, box: { x: 900, y: 600, w: 300, h: 30 } }, '9x16').map((i) => i.kind), ['clipped']);
  assert.deepEqual(classify({ ...base, bleed: true, box: { x: 900, y: 600, w: 300, h: 30 } }, '9x16'), []);
  assert.deepEqual(classify({ ...base, size: PHONE_MIN_PX - 1 }, '9x16').map((i) => i.kind), ['tiny']);
  assert.deepEqual(classify({ ...base, size: PHONE_MIN_PX - 1 }, '16x9'), [], 'phone floor is 9x16 only');
  assert.deepEqual(classify({ ...base, state: 'moving', contrast: 1 }, '9x16'), [], 'only text at rest');
  assert.match(classify({ ...base, invisible: true, contrast: 1, median: 1.1 }, '9x16')[0].msg, /^invisible/);
});

test('textqa: summarize keeps the worst time per text, counts states, merges per-letter boxes into a line', () => {
  const s = (t, ch, x, contrast) => ({ state: 'rest', t, scene: 'a', s: ch, size: 30, box: { x, y: 600, w: 20, h: 30 }, contrast, median: 5, fg: '#FFFFFF', bg: '#888888' });
  const q = summarize([s(1, 'A', 200, 3), s(2, 'A', 200, 2), s(2, 'B', 220, 2.5), { state: 'moving' }, { state: 'hidden' }, s(3, 'C', 300, 9)], '9x16');
  assert.equal(q.moving, 1); assert.equal(q.hidden, 1); assert.equal(q.checked, 3);
  assert.equal(q.issues.length, 1);
  assert.equal(q.issues[0].text, 'AB'); assert.equal(q.issues[0].t, 2); assert.equal(q.issues[0].contrast, 2);
  assert.deepEqual(q.issues[0].box, { x: 200, y: 600, w: 40, h: 30 });
  assert.equal(mergeUnits([]).length, 0);
  assert.deepEqual(qaTimes({ duration: 2, beatTimes: [0, 0.5, 1, 1.5] }), [0, 0.5, 1, 1.5, +(2 - 1 / 30).toFixed(6)]);
});
