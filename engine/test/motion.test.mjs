import test from 'node:test';
import assert from 'node:assert/strict';
import * as M from '../motion.js';

test('spring endpoints', () => {
  assert.equal(M.spring(0), 0);
  assert.ok(Math.abs(M.spring(5) - 1) < 1e-4);
  assert.equal(M.spring(-1), 0);
});
test('seq hits every key value after settling', () => {
  const keys = [[0, 0], [1, 10], [3, -4, 'snap'], [5, 7, 'soft']];
  assert.ok(Math.abs(M.seq(0.5, keys)) < 1e-9);
  assert.ok(Math.abs(M.seq(2.9, keys) - 10) < 1e-2);
  assert.ok(Math.abs(M.seq(4.9, keys) + 4) < 1e-2);
  assert.ok(Math.abs(M.seq(9, keys) - 7) < 1e-2);
  assert.deepEqual(M.seqv(9, [[0, [0, 0]], [1, [3, 4]]]).map((v) => +v.toFixed(3)), [3, 4]);
});
test('pulse returns to 0', () => {
  assert.equal(M.pulse(0, 0.5), 0);
  assert.ok(M.pulse(0.55, 0.5) > 0.1);
  assert.ok(Math.abs(M.pulse(3, 0.5)) < 1e-3);
});
test('settle(med) < 1s and satisfies its definition', () => {
  const s = M.settle('med');
  assert.ok(s > 0 && s < 1, `settle=${s}`);
  for (let t = s; t < s + 3; t += 0.001) assert.ok(Math.abs(M.sp(t, 'med') - 1) < 0.002);
  assert.ok(Math.abs(M.sp(s - 0.01, 'med') - 1) >= 0.0015 || s < 0.02);
});
test('stagger endpoints', () => {
  assert.equal(M.stagger(0, 5, 2), 0);
  assert.equal(M.stagger(4, 5, 2), 2);
  assert.equal(M.stagger(0, 1, 2), 0);
});
test('spring presets and overrides', () => {
  assert.deepEqual(M.springOf('snap'), [0.21, 0.66]);
  M.setSprings({ med: [0.5, 0.7] });
  assert.deepEqual(M.springOf('med'), [0.5, 0.7]);
  M.setSprings();
  assert.deepEqual(M.springOf('med'), [0.36, 0.86]);
  assert.throws(() => M.springOf('wobbly'), /unknown spring/);
  assert.throws(() => M.setSprings({ med: [300, 30] }), /response seconds/);
});
test('all three damping regimes start at rest, stay continuous and settle on 1', () => {
  for (const damping of [0.3, 0.7, 1, 1.6]) {
    const f = (t) => M.spring(t, 0.4, damping);
    assert.ok(Math.abs(f(1e-6)) < 1e-6, `starts at 0 (damping ${damping})`);
    assert.ok(Math.abs((f(2e-4) - f(1e-4)) / 1e-4) < 0.05, `starts at rest (damping ${damping})`);
    for (let t = 0.001; t < 3; t += 0.001) assert.ok(Math.abs(f(t) - f(t - 0.001)) < 0.08, `continuous at ${t}`);
    assert.ok(Math.abs(f(30) - 1) < 1e-6, `settles (damping ${damping})`);
  }
  // critical and over-damped springs never pass the target; under-damped ones do
  const peak = (d) => Math.max(...Array.from({ length: 3000 }, (_, i) => M.spring(i / 1000, 0.4, d)));
  assert.ok(peak(1) <= 1 + 1e-12 && peak(1.6) <= 1 + 1e-12);
  assert.ok(peak(0.5) > 1.1);
  // the closed form matches a fine numerical integration of the same equation
  const w = 2 * Math.PI / 0.4, z = 0.6, dt = 1e-5;
  let x = 0, v = 0;
  for (let t = 0; t < 0.5 - 1e-12; t += dt) { const a = w * w * (1 - x) - 2 * z * w * v; v += a * dt; x += v * dt; }
  assert.ok(Math.abs(x - M.spring(0.5, 0.4, 0.6)) < 1e-3, `integrated ${x} vs closed form ${M.spring(0.5, 0.4, 0.6)}`);
});
test('drop lands then squashes, never moves backwards before landing', () => {
  assert.deepEqual(M.drop(0), { p: 0, sq: 0 });
  let prev = 0, landed = false;
  for (let t = 0.001; t < 2; t += 0.001) {
    const d = M.drop(t);
    if (!landed) assert.ok(d.p >= prev - 1e-9);
    if (d.p === 1) landed = true;
    prev = d.p;
  }
  assert.ok(landed);
});
