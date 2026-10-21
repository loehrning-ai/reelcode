import test from 'node:test';
import assert from 'node:assert/strict';
import { makeGrid, parseAt, totalBeatsFor } from '../beat.js';

const synth = { bpm: 120, beats: Array.from({ length: 32 }, (_, i) => i * 0.5), downbeats: Array.from({ length: 8 }, (_, i) => i * 2), duration: 16 };

test('nominal grid equals a synth beats.json', () => {
  const a = makeGrid({ bpm: 120 }, 16), b = makeGrid(synth, 16);
  assert.equal(a.totalBeats, 32); assert.equal(a.duration, 16); assert.equal(b.duration, 16);
  for (let n = 0; n < 40; n += 0.25) assert.ok(Math.abs(a.beat(n) - b.beat(n)) < 1e-9);
  for (let t = 0; t < 16; t += 0.37) assert.ok(Math.abs(a.at(t) - b.at(t)) < 1e-9);
  assert.equal(a.bar(2), 4);
});
test('fractional interpolation and extrapolation on a measured grid', () => {
  const g = makeGrid({ bpm: 120, beats: [0.1, 0.6, 1.2, 1.7] }, 2);
  assert.ok(Math.abs(g.beat(1.5) - 0.9) < 1e-9);
  assert.ok(Math.abs(g.beat(4) - 2.2) < 1e-9);
  assert.ok(Math.abs(g.beat(-1) + 0.4) < 1e-9);
  for (const n of [0.3, 1.5, 2.9, 5]) assert.ok(Math.abs(g.at(g.beat(n)) - n) < 1e-9);
});
test('parseAt', () => {
  const g = makeGrid({ bpm: 120 }, 16);
  assert.equal(parseAt(3, g), 3);
  assert.equal(parseAt('b3.5', g), 3.5);
  assert.equal(parseAt('bar2', g), 8);
  assert.equal(parseAt('s1.0', g), 2);
  assert.throws(() => parseAt('3s', g), /bad time ref/);
  assert.throws(() => parseAt('s1'), /needs a grid/);
});
test('snap to 1/4 beat and bar snapping of durations', () => {
  const g = makeGrid({ bpm: 120 }, 16);
  assert.equal(g.snap(0.37), 0.375);
  assert.equal(g.snap(0.37, 1), 0.5);
  assert.equal(totalBeatsFor(15, 120), 32);
  assert.equal(totalBeatsFor(12, 120), 24);
  assert.throws(() => makeGrid({}, 4), /positive bpm/);
});
