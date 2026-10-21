import test from 'node:test';
import assert from 'node:assert/strict';
import { fitText, wrapText, counterText, measure, resetLog, getLog, drawText, kinetic } from '../text.js';

// Mock ctx: width = len * size * 0.6 (size parsed from ctx.font); no transforms.
function mockCtx() {
  const calls = [];
  return {
    font: '400 10px x', letterSpacing: '0px', fillStyle: '', textAlign: 'left', textBaseline: 'alphabetic', calls,
    measureText(s) { const size = parseFloat(/([\d.]+)px/.exec(this.font)[1]); return { width: s.length * size * 0.6 }; },
    fillText(s, x, y) { calls.push(['fillText', s, x, y]); },
    m: { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 }, stack: [],
    save() { this.stack.push({ ...this.m }); }, restore() { this.m = this.stack.pop(); },
    translate(x, y) { const m = this.m; this.m = { ...m, e: m.e + m.a * x + m.c * y, f: m.f + m.b * x + m.d * y }; },
    scale(sx, sy) { const m = this.m; this.m = { ...m, a: m.a * sx, b: m.b * sx, c: m.c * sy, d: m.d * sy }; },
    getTransform() { const m = this.m; return { ...m, isIdentity: m.a === 1 && m.b === 0 && m.c === 0 && m.d === 1 && m.e === 0 && m.f === 0 }; },
    beginPath() {}, rect() {}, clip() {},
  };
}
const theme = {
  colors: { bg: '#000000', fg: '#FFFFFF', accent: '#FF0000', muted: '#777777', surface: '#111111' },
  fonts: { display: { family: 'D', weight: 800, tracking: 0 }, ui: { family: 'U', weight: 400, tracking: 0 } },
};
const inside = (b, box) => b.x >= box.x - 1e-6 && b.y >= box.y - 1e-6 && b.x + b.w <= box.x + box.w + 1e-6 && b.y + b.h <= box.y + box.h + 1e-6;

test('fitText stays inside the box (single line and auto wrap)', () => {
  const ctx = mockCtx();
  const box = { x: 10, y: 20, w: 600, h: 300 };
  const one = fitText(ctx, theme, 'HELLO WORLD', { box, max: 400, min: 10 });
  assert.equal(one.overflow, false);
  assert.ok(inside(one.box, box));
  assert.ok(Math.abs(one.lines[0].w - 600) < 2, 'width-limited fit fills the width');
  const auto = fitText(ctx, theme, 'the quick brown fox jumps over the lazy dog', { box, lines: 'auto', max: 200, min: 10, leading: 1.1, align: 'c', valign: 'c' });
  assert.equal(auto.overflow, false);
  assert.ok(auto.lines.length > 1);
  assert.ok(inside(auto.box, box));
  for (const l of auto.lines) assert.ok(l.w <= box.w + 1e-6);
});
test('fitText reports overflow at min (and logs it)', () => {
  const ctx = mockCtx();
  resetLog('frame');
  const r = fitText(ctx, theme, 'SUPERCALIFRAGILISTIC', { box: { x: 0, y: 0, w: 100, h: 100 }, max: 80, min: 40 });
  assert.equal(r.overflow, true);
  assert.equal(r.size, 40);
  assert.equal(getLog().overflow.length, 1);
  resetLog('frame');
  assert.equal(getLog().overflow.length, 0);
});
test('wrapText never exceeds width except for one unbreakable word', () => {
  const ctx = mockCtx();
  const lines = wrapText(ctx, theme, 'aa bbb cccc dd eeeeeeeeeeeeeeeeeeee f\nnew para', { role: 'ui', size: 10, width: 60 });
  for (const l of lines) {
    const w = measure(ctx, theme, 'ui', l, 10).w;
    assert.ok(w <= 60 || !l.includes(' '), `line "${l}" is ${w}px`);
  }
  assert.ok(lines.includes('new para'));
  assert.ok(lines.includes('eeeeeeeeeeeeeeeeeeee'));
});
test('counterText formats', () => {
  assert.equal(counterText(1234567, 1), '1,234,567');
  assert.equal(counterText(100, 0.5), '50');
  assert.equal(counterText(42.5, 1, { fmt: 'pct', decimals: 1 }), '42.5%');
  assert.equal(counterText(1999, 1, { fmt: 'money' }), '$1,999');
  assert.equal(counterText(12500, 1, { fmt: 'k', decimals: 1 }), '12.5k');
  assert.equal(counterText(3, 1, { fmt: 'x' }), '3×');
  assert.equal(counterText(60, 1, { suffix: 'fps' }), '60fps');
  assert.equal(counterText(10, 0.5, { from: 20 }), '15');
  assert.throws(() => counterText(1, 1, { fmt: 'nope' }));
});
test('drawText logs its box and rejects hex colours; kinetic has no fade', () => {
  const ctx = mockCtx();
  resetLog('frame');
  drawText(ctx, theme, 'HI', 100, 200, { role: 'display', size: 50 });
  const t = getLog().texts[0];
  assert.equal(t.s, 'HI'); assert.equal(t.box.x, 100); assert.equal(t.box.w, 60); assert.equal(t.box.y + t.box.h, 200);
  ctx.save(); ctx.translate(10, 0); ctx.scale(2, 2);
  drawText(ctx, theme, 'HI', 0, 0, { role: 'display', size: 50 });
  ctx.restore();
  const t2 = getLog().texts[1];
  assert.equal(t2.box.x, 10); assert.equal(t2.box.w, 120); assert.equal(t2.size, 100, 'logged size includes the transform scale');
  assert.throws(() => drawText(ctx, theme, 'X', 0, 0, { size: 10, color: '#FF0000' }), /not a theme key/);
  const fit = fitText(ctx, theme, 'A B', { box: { x: 0, y: 0, w: 100, h: 100 }, max: 50 });
  const f = { ctx, theme, grid: { spb: 0.5 }, since: () => 1 };
  assert.throws(() => kinetic(f, fit, { from: 'fade' }), /no fades/);
});
