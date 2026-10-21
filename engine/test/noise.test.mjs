import test from 'node:test';
import assert from 'node:assert/strict';
import { rng, hash, noise1, noise2, jitter } from '../noise.js';

test('same seed -> same sequence, different seeds differ, values in [0,1)', () => {
  const a = rng(7), b = rng(7), c = rng(8);
  const sa = Array.from({ length: 1000 }, a), sb = Array.from({ length: 1000 }, b), sc = Array.from({ length: 1000 }, c);
  assert.deepEqual(sa, sb);
  assert.notDeepEqual(sa, sc);
  for (const v of [...sa, ...sc]) assert.ok(v >= 0 && v < 1);
  for (let i = 0; i < 1000; i++) { const h = hash(i, 3); assert.ok(h >= 0 && h < 1); }
  assert.equal(hash(5, 1), hash(5, 1)); assert.notEqual(hash(5, 1), hash(5, 2));
});
test('noise1/noise2 are continuous and bounded', () => {
  for (let x = -5; x < 5; x += 0.0137) {
    const v = noise1(3, x);
    assert.ok(v >= 0 && v < 1);
    assert.ok(Math.abs(noise1(3, x + 1e-4) - v) < 1e-2);
    const w = noise2(3, x, x * 0.7);
    assert.ok(w >= 0 && w < 1);
    assert.ok(Math.abs(noise2(3, x + 1e-4, x * 0.7) - w) < 1e-2);
    assert.ok(Math.abs(noise2(3, x, x * 0.7 + 1e-4) - w) < 1e-2);
  }
  assert.ok(Math.abs(jitter(1, 2.5, 10, 3)) <= 10);
});
