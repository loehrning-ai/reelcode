import test from 'node:test';
import assert from 'node:assert/strict';
import { FORMATS, frame, split, grid, place, contains, pickBy, aspectFit, inset } from '../layout.js';

test('safe lies inside full for every format', () => {
  for (const fmt of Object.keys(FORMATS)) {
    const F = frame(fmt);
    assert.ok(contains(F.full, F.safe, 0));
    assert.equal(F.u, Math.min(F.w, F.h) / 1080);
  }
  assert.throws(() => frame('5x4'), /unknown format/);
});
test("split long stacks in 9x16 and 1x1, side by side in 16x9", () => {
  const v = split(frame('9x16').safe, [1, 1], { axis: 'long' });
  assert.equal(v[0].x, v[1].x); assert.ok(v[1].y > v[0].y);
  const s = split(frame('1x1').safe, [1, 1], { axis: 'long' });
  assert.ok(s[1].y > s[0].y);
  const h = split(frame('16x9').safe, [1, 2], { axis: 'long', gap: 10 });
  assert.equal(h[0].y, h[1].y); assert.ok(h[1].x > h[0].x);
  assert.ok(Math.abs(h[1].w - 2 * h[0].w) < 1e-9);
  assert.ok(Math.abs(h[0].w + h[1].w + 10 - frame('16x9').safe.w) < 1e-9);
});
test('grid returns n boxes with no overlap', () => {
  const F = frame('16x9');
  const cells = grid(F.safe, 7, { cols: { v: 1, s: 2, h: 3 }, gap: 12 });
  assert.equal(cells.length, 7);
  for (let i = 0; i < cells.length; i++) for (let j = i + 1; j < cells.length; j++) {
    const a = cells[i], b = cells[j];
    const overlap = a.x < b.x + b.w - 1e-9 && b.x < a.x + a.w - 1e-9 && a.y < b.y + b.h - 1e-9 && b.y < a.y + a.h - 1e-9;
    assert.ok(!overlap, `cells ${i} and ${j} overlap`);
  }
  assert.ok(Math.abs(cells[1].x - cells[0].x - (cells[0].w + 12)) < 1e-9);
  const sq = grid(F.safe, 4, { cols: 2, aspect: 1 });
  for (const c of sq) assert.ok(Math.abs(c.w - c.h) < 1e-9);
});
test('place anchors', () => {
  const b = { x: 0, y: 0, w: 100, h: 50 };
  assert.deepEqual({ ...place(b, { w: 10, h: 10 }, 'c') }, { x: 45, y: 20, w: 10, h: 10 });
  assert.deepEqual({ ...place(b, { w: 10, h: 10 }, 'nw') }, { x: 0, y: 0, w: 10, h: 10 });
  assert.deepEqual({ ...place(b, { w: 10, h: 10 }, 'se', 5) }, { x: 85, y: 35, w: 10, h: 10 });
  assert.throws(() => place(b, { w: 1, h: 1 }, 'zz'));
  assert.deepEqual({ ...inset(b, { l: 10 }) }, { x: 10, y: 0, w: 90, h: 50 });
  const af = aspectFit(b, 1);
  assert.equal(af.w, 50); assert.equal(af.x, 25);
});
test('pick fallback v -> s -> h', () => {
  assert.equal(frame('16x9').pick({ v: 1, s: 2, h: 3 }), 3);
  assert.equal(frame('16x9').pick({ v: 1, s: 2 }), 1);
  assert.equal(frame('16x9').pick({ s: 2 }), 2);
  assert.equal(frame('1x1').pick({ h: 3 }), 3);
  assert.equal(pickBy('v', 7), 7);
});
