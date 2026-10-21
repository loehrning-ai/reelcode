// Engine-maintainer fixes reported by template authors (docs/SPEC.md §3).
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { fitText, tryFit, quiet, drawText, logRest, counterText, resetLog, getLog, setNumberFormat } from '../text.js';
import { quant, loopSeqv, loopSeq, loopPulse, sp } from '../motion.js';
import { quant as gq, makeGrid } from '../beat.js';
import { cursorAt, drawCursor } from '../cursor.js';
import { lineReach } from '../chart.js';
import { compile } from '../runtime.js';
import { templateModules, lintFiles } from '../cli/lib/static.mjs';

function mockCtx() {
  return {
    font: '400 10px x', letterSpacing: '0px', fillStyle: '', textAlign: 'left', textBaseline: 'alphabetic',
    measureText(s) { const size = parseFloat(/([\d.]+)px/.exec(this.font)[1]); return { width: s.length * size * 0.6 }; },
    fillText() {}, m: { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 }, stack: [],
    save() { this.stack.push({ ...this.m }); }, restore() { this.m = this.stack.pop(); },
    translate(x, y) { const m = this.m; this.m = { ...m, e: m.e + m.a * x + m.c * y, f: m.f + m.b * x + m.d * y }; },
    scale(sx, sy) { const m = this.m; this.m = { ...m, a: m.a * sx, b: m.b * sx, c: m.c * sy, d: m.d * sy }; },
    getTransform() { const m = this.m; return { ...m, isIdentity: m.a === 1 && m.b === 0 && m.c === 0 && m.d === 1 && m.e === 0 && m.f === 0 }; },
    beginPath() {}, rect() {}, clip() {}, moveTo() {}, lineTo() {}, closePath() {}, stroke() {}, fill() {},
  };
}
const theme = {
  colors: { bg: '#000000', fg: '#FFFFFF', accent: '#FF0000', muted: '#777777', surface: '#111111' },
  fonts: { display: { family: 'D', weight: 800, tracking: 0 }, ui: { family: 'U', weight: 400, tracking: 0 } },
};

test('tryFit and quiet never log; fitText still logs an overflow', () => {
  const ctx = mockCtx(), box = { x: 0, y: 0, w: 50, h: 10 };
  resetLog('frame');
  const r = tryFit(ctx, theme, 'MUCH TOO LONG FOR THIS BOX', { box, max: 10, min: 9 });
  assert.equal(r.overflow, true);
  quiet(() => drawText(ctx, theme, 'hidden', 0, 0, { size: 10 }));
  assert.deepEqual(getLog().overflow, []);
  assert.deepEqual(getLog().texts, []);
  fitText(ctx, theme, 'MUCH TOO LONG FOR THIS BOX', { box, max: 10, min: 9 });
  assert.equal(getLog().overflow.length, 1);
});

test('drawText rest logs the resting slot, not the in-flight box', () => {
  const ctx = mockCtx();
  resetLog('frame');
  ctx.translate(0, 500);   // in flight: 500 px below
  drawText(ctx, theme, 'AB', 100, 0, { size: 10, align: 'c', rest: [100, -500] });
  ctx.translate(0, -500);
  logRest(ctx, theme, 'CD', 10, 50, { size: 10 });
  const [a, b] = getLog().texts;
  assert.deepEqual(a.box, { x: 94, y: -500 + 500 - 10 * 0.7, w: 12, h: 7 });
  assert.equal(b.box.x, 10); assert.equal(b.box.y, 43);
});

test('counterText: locale, compact, currency; setNumberFormat changes the default', () => {
  assert.equal(counterText(1234.5, 1, { fmt: 'int', decimals: 1, locale: 'de-DE' }), '1.234,5');
  assert.equal(counterText(1200000, 1, { fmt: 'compact', decimals: 1 }), '1.2M');
  assert.equal(counterText(1234, 1, { fmt: 'currency', currency: 'EUR', locale: 'de-DE' }), '1.234 €');
  assert.equal(counterText(1234, 1, { fmt: 'money' }), '$1,234', 'legacy money unchanged');
  assert.equal(counterText(1234, 1, { fmt: 'money', currency: 'GBP' }), '£1,234');
  try {
    setNumberFormat({ locale: 'de-CH', currency: 'CHF' });
    assert.match(counterText(12345, 1, { fmt: 'int' }), /^12['’]345$/);
    assert.match(counterText(5, 1, { fmt: 'currency' }), /CHF/);
  } finally { setNumberFormat({ locale: 'en-US', currency: 'USD' }); }
  assert.throws(() => setNumberFormat({ currency: 'euro' }), /ISO 4217/);
});

test('quant rounds marker beats to the 1/16 grid', () => {
  assert.equal(quant((3 - 0.5) / 7), 0.25);
  assert.equal(quant(0.375), 0.5);
  assert.equal(gq(1.13, 4), 1.25);
  assert.equal(quant(1.3, 8), 1.25);
});

test('loopSeqv: position and velocity match across the loop seam', () => {
  const T = 4, keys = [[0.2, [0, 100]], [1.5, [300, -50], 'soft'], [2.8, [-120, 20]]];
  const h = 1e-4;
  const a = loopSeqv(0, T, keys), b = loopSeqv(T, T, keys);
  a.forEach((v, i) => assert.ok(Math.abs(v - b[i]) < 1e-9));
  const va = loopSeqv(h, T, keys).map((v, i) => (v - loopSeqv(-h, T, keys)[i]) / (2 * h));
  const near = loopSeqv(T - h, T, keys), after = loopSeqv(T + h, T, keys);
  const vb = after.map((v, i) => (v - near[i]) / (2 * h));
  va.forEach((v, i) => assert.ok(Math.abs(v - vb[i]) < 1e-3, `velocity ${v} vs ${vb[i]}`));
  // settled values land on the keys
  assert.ok(Math.abs(loopSeq(1.45, T, [[0.2, 0], [1.5, 300], [2.8, -120]]) - 0) < 1);
  assert.ok(Math.abs(loopSeqv(2.75, T, keys)[0] - 300) < 2);
  assert.ok(loopPulse(0.01, T, T - 0.02, 0.08) > 0, 'a hit at the end shows at the start');
});

test('cursorAt loop: periodic and always visible; drawCursor draws without visible/enter', () => {
  const plan = [{ at: 0, to: [0, 0] }, { at: 2, to: [100, 50] }, { at: 3.5, click: true }];
  const p0 = cursorAt(plan, 0, undefined, { loop: 8 }, 0.5), p8 = cursorAt(plan, 8, undefined, { loop: 8 }, 0.5);
  assert.ok(Math.abs(p0.x - p8.x) < 1e-9 && Math.abs(p0.y - p8.y) < 1e-9);
  assert.equal(p0.visible, true); assert.equal(p0.enter, 1);
  assert.ok(cursorAt(plan, 3.6, undefined, { loop: 8 }, 0.5).press > 0);
  let drew = 0;
  const ctx = { ...mockCtx(), fill() { drew++; } };
  drawCursor(ctx, theme, { x: 1, y: 2 }, 1);
  assert.equal(drew, 1);
  drawCursor(ctx, theme, { x: 1, y: 2, visible: false }, 1);
  assert.equal(drew, 1);
});

test('lineReach inverts the x-based draw-on (format independent)', () => {
  const series = [[0, 1], [1, 5], [2, 2], [4, 9]];
  assert.equal(lineReach(series, 0, { at: 1, beats: 4 }, 0.5), 1);
  assert.equal(lineReach(series, 3, { at: 1, beats: 4 }, 0.5), 5);
  const mid = lineReach(series, 2, { at: 0, beats: 4 }, 0.5);
  assert.ok(Math.abs(mid - 2) < 1e-6, `x=2 of 0..4 is halfway through an eased draw (${mid})`);
  const sprung = lineReach(series, 2, { at: 0, spring: 'stiff' }, 0.5);
  assert.ok(Math.abs(sp(sprung * 0.5, 'stiff') - 0.5) < 1e-6);
});

test('compile: build().poster is used unless project.poster is set', () => {
  const grid = makeGrid({ bpm: 120 }, 8), sc = (id, beats) => ({ id, beats, draw() {} });
  const built = { scenes: [sc('a', 8), sc('b', 8)], poster: 'b5' };
  assert.equal(compile(built, grid, {}).poster, 2.5);
  assert.equal(compile(built, grid, { poster: 10 }).poster, 5);
  assert.equal(compile({ scenes: [sc('a', 8), sc('b', 8)] }, grid, {}).poster, 7);
});

test('lint scans every .js module in a template folder', () => {
  const dir = mkdtempSync(join(tmpdir(), 'tpl-'));
  try {
    writeFileSync(join(dir, 'scene.js'), "import './lib/helper.js';\nexport default { id: 'x', build() {} };\n");
    mkdirSync(join(dir, 'lib'));
    writeFileSync(join(dir, 'lib', 'helper.js'), 'export const r = () => Math.random();\n');
    writeFileSync(join(dir, 'check.mjs'), 'console.log(Date.now());\n');
    const mods = templateModules(dir);
    assert.deepEqual(mods.map((p) => p.slice(dir.length + 1)), ['lib/helper.js', 'scene.js']);
    const errs = lintFiles(mods.map((path) => ({ path, scene: true })), dir);
    assert.deepEqual(errs.map((e) => [e.file, e.line]), [['lib/helper.js', 1]]);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
