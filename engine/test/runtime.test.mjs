import test from 'node:test';
import assert from 'node:assert/strict';
import { compile, deriveCues, makeTheme, mixHex, fnv1a } from '../runtime.js';
import { makeGrid } from '../beat.js';
import { frame } from '../layout.js';
import { lintSource, scanSource } from '../cli/lib/static.mjs';

const grid = makeGrid({ bpm: 120 }, 8); // 16 beats
const sc = (id, beats, extra = {}) => ({ id, beats, draw() {}, ...extra });

test('compile: fill, sums, starts, events in seconds, poster default', () => {
  const tl = compile({ scenes: [sc('a', 4, { events: ['b2'] }), sc('b', 'fill', { events: [1, 30], sfx: [{ at: 30, sfx: 'pop' }] }), sc('c', 4)] }, grid, {});
  assert.deepEqual(tl.scenes.map((s) => [s.start, s.beats]), [[0, 4], [4, 8], [12, 4]]);
  assert.deepEqual(tl.events, [0, 1, 2, 2.5, 6]);
  assert.equal(tl.scenes[1].sfx.length, 0, 'fill scene drops sfx past its end');
  assert.equal(tl.poster, 7.5, 'default poster: last scene start + 75% (end card landed)');
  assert.throws(() => compile({ scenes: [sc('a', 4), sc('b', 4)] }, grid), /scenes sum to 8 beats, project needs 16/);
  assert.throws(() => compile({ scenes: [sc('a', 15), sc('b', 'fill')] }, grid), /needs >= 2/);
  assert.throws(() => compile({ scenes: [sc('a', 8), sc('a', 8)] }, grid), /duplicate/);
  assert.throws(() => compile({ scenes: [sc('a', 8), sc('b', 8, { transition: { type: 'dissolve' } })] }, grid), /transition/);
  assert.throws(() => compile({ scenes: [sc('a', 8, { events: [9] }), sc('b', 8)] }, grid), /outside the scene/);
});
test('cues: derived, transitions add whoosh/swish on the boundary, loop riser, density, sfx off', () => {
  const scenes = [sc('a', 8, { sfx: [{ at: 0, sfx: 'thump' }, { at: 1.5, sfx: 'tick', tier: 'busy' }, { at: 2, sfx: 'click' }] }),
    sc('b', 4, { transition: { type: 'wipe', beats: 1 } }), sc('c', 4, { transition: { type: 'push', beats: 0.5 } })];
  const tl = compile({ scenes, loop: true }, grid, { audio: { sfx: true } });
  assert.deepEqual(tl.cues.cues.map((c) => [c.beat, c.sfx, c.id]),
    [[0, 'thump', 'a:0'], [2, 'click', 'a:2'], [8, 'whoosh', 'b:0'], [12, 'swish', 'c:0'], [16, 'riser', 'loop:0']]);
  assert.ok(tl.cues.cues.every((c) => c.gain_db < 0 && c.pan === 0 && !('tier' in c)));
  const busy = deriveCues(tl.scenes, grid, { sfxDensity: 'busy' }, false).cues;
  assert.ok(busy.some((c) => c.sfx === 'tick'));
  const sparse = deriveCues(tl.scenes, grid, { sfxDensity: 'sparse' }, false).cues;
  assert.deepEqual(sparse.map((c) => c.id), ['a:0', 'a:2', 'b:0', 'c:0']);
  assert.deepEqual(deriveCues(tl.scenes, grid, { sfx: false }, true).cues, []);
  assert.throws(() => compile({ scenes: [sc('a', 16, { sfx: [{ at: 0, sfx: 'boom' }] })] }, grid), /unknown sfx/);
});
test('theme derives muted/surface, scales radius, has no glow keys', () => {
  const F = frame('16x9');
  const t = makeTheme({ colors: { bg: '#000000', fg: '#ffffff', accent: '#ff0000' }, fonts: { display: { family: 'A' }, ui: { family: 'B' } } }, F);
  assert.equal(t.colors.muted, mixHex('#FFFFFF', '#000000', 0.45));
  assert.equal(t.colors.surface, '#141414');
  assert.equal(t.radius, 28);
  assert.equal(t.fonts.display.weight, 800);
  assert.equal(t.mix('bg', 'fg', 0.5), 'rgb(128,128,128)');
  assert.ok(!JSON.stringify(Object.keys(t)).match(/shadow|glow/));
  assert.equal(t.accent2, undefined);
  assert.equal(fnv1a(new Uint8Array([1, 2, 3])), fnv1a(new Uint8Array([1, 2, 3])));
  assert.notEqual(fnv1a(new Uint8Array([1, 2, 3])), fnv1a(new Uint8Array([1, 2, 4])));
});
test('static lint: bans, comment stripping, allow regions, scene-only rules', () => {
  assert.deepEqual(lintSource('// Math.random()\n/* setTimeout */ const a = 1;'), []);
  assert.equal(lintSource('const x = Math.random();')[0].line, 1);
  assert.equal(lintSource('\n\nrequestAnimationFrame(f)')[0].line, 3);
  assert.deepEqual(lintSource('// @lint-allow-begin guard\nMath.random = 1;\n// @lint-allow-end\n'), []);
  assert.equal(lintSource('ctx.shadowBlur = 0;').length, 0);
  assert.equal(lintSource('ctx.shadowBlur = 12;').length, 1);
  assert.equal(lintSource("el.style.cssText = 'opacity:0;transition: opacity 1s';").length, 1);
  assert.equal(lintSource("const s = { transition: { type: 'wipe' } };").length, 0, 'scene transition keys are not CSS');
  assert.equal(lintSource("const c = '#FF00AA'; const w = 1080;").length, 0, 'raw literals allowed outside scene code');
  assert.equal(lintSource("const c = '#FF00AA'; const w = 1080; ctx.globalAlpha = 0.5; ctx.createLinearGradient(0,0,1,1);", { scene: true }).length, 4);
  assert.equal(lintSource('const r = /\'"/g; Math.random()').length, 1, 'regex literals with quotes do not derail the scanner');
  assert.equal(scanSource('"a" + `b`').strings.length, 2);
});
