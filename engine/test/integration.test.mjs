// integration.test.mjs: v2 integration glue (unit level): caption lane for templates, text-overlap QA, schema v2 extras.
import test from 'node:test';
import assert from 'node:assert/strict';
import { frame } from '../layout.js';
import { captionTop, captionZone } from '../captions.js';
import { overlaps, summarize } from '../cli/lib/textqa.mjs';
import { resolveProject } from '../schema.js';

test('captionTop: null when captions are off; a lane above the caption zone bottom, taller for the bold style', () => {
  for (const fmt of ['9x16', '1x1', '4x5', '16x9']) {
    const F = frame(fmt);
    assert.equal(captionTop(F, null), null); assert.equal(captionTop(F, { enabled: false }), null);
    const clean = captionTop(F, { enabled: true }), bold = captionTop(F, { enabled: true, style: 'bold' });
    const bottom = captionZone(F).bottom;
    assert.ok(clean < bottom && clean > F.safe.y + F.safe.h / 2, `${fmt}: ${clean} vs bottom ${bottom}`);
    assert.ok(bold < clean, `${fmt}: bold lane is taller`);
  }
  assert.throws(() => captionTop(frame('9x16'), { enabled: true, style: 'fancy' }), /unknown style "fancy"/);
});

test('textqa overlaps: two different texts at rest overlapping are reported; lines, neighbours and redraws are not', () => {
  const r = (s, box, extra = {}) => ({ t: 1, scene: 'a', s, size: 40, state: 'rest', contrast: 9, median: 9, box, ...extra });
  const lower = r('Window seat', { x: 72, y: 1300, w: 400, h: 60 });
  const cap = r('Captions', { x: 300, y: 1320, w: 300, h: 50 });
  assert.equal(overlaps([lower, cap]).length, 1);
  assert.equal(overlaps([lower, r('next line', { x: 72, y: 1355, w: 400, h: 60 })]).length, 0, 'leading overlap of a few px is not an overlap');
  assert.equal(overlaps([lower, r('Window seat', { x: 72.5, y: 1300.5, w: 400, h: 60 })]).length, 0, 'same text drawn twice');
  assert.equal(overlaps([lower, { ...cap, t: 2 }]).length, 0, 'different times');
  assert.equal(overlaps([lower, { ...cap, state: 'moving' }]).length, 0, 'in flight');
  const sum = summarize([lower, cap, { ...lower, t: 2 }, { ...cap, t: 2 }], '9x16');
  const ov = sum.issues.filter((i) => i.kind === 'overlap');
  assert.equal(ov.length, 1); assert.equal(ov[0].count, 2); assert.match(ov[0].msg, /overlaps "Captions"/);
});

test('schema v2 extras: transparent may not be overridden per format; clips entries are typed', () => {
  const tpl = { id: 't', defaults: {} };
  const base = { template: 't', title: 'x', formats: ['9x16'], content: {}, brand: { colors: { bg: '#000000', fg: '#FFFFFF', accent: '#FF0000' }, fonts: { display: { family: 'A' }, ui: { family: 'B' } } } };
  assert.deepEqual(resolveProject({ ...base, transparent: true }, tpl, '9x16').errors, []);
  assert.match(resolveProject({ ...base, overrides: { '9x16': { transparent: true } } }, tpl, '9x16').errors.join('\n'), /overrides\.9x16\.transparent: may not be overridden/);
  assert.match(resolveProject({ ...base, clips: { a: { src: 'assets/a.webm', fps: 500 } } }, tpl).errors.join('\n'), /project\.clips\.a\.fps: must be <= 120/);
});
