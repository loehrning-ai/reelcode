// v2 foundation unit tests: 4x5, brand presets, variants, cutdowns, renditions, bespoke page resolution, sheet
// planning, the centred shutter and the feature-interface stubs. Fast (no browser).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { FORMATS, FORMAT_IDS, frame, contains } from '../layout.js';
import { resolveProject, brandIds, expandBrand, renditionDirs, renditions, isLegacyLayout, PROJECT_SCHEMA, PAGE_TEMPLATE, validate } from '../schema.js';
import { planCutdown, applyCutdown } from '../cutdown.js';
import { compile } from '../runtime.js';
import { makeGrid } from '../beat.js';
import { contactTimes, busiestBoundary, stripTimes, sheetTimes, tileW, CONTACT_MAX } from '../cli/lib/sheets.mjs';
import { subframeTime } from '../cli/lib/video.mjs';
import { NotImplemented, isNotImplemented } from '../notimpl.js';
import * as captions from '../captions.js';
import * as media from '../media.js';
import * as voiceover from '../cli/lib/voiceover.mjs';
import * as capSide from '../cli/lib/captions.mjs';
import * as clips from '../cli/lib/clips.mjs';
import * as exporter from '../cli/lib/exporter.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const BRAND = { colors: { bg: '#000000', fg: '#FFFFFF', accent: '#FF0000' }, fonts: { display: { family: 'A' }, ui: { family: 'B' } } };
const T = { id: 'x', defaults: { duration: 12, bpm: 120, formats: ['9x16'] }, content_schema: { type: 'object' } };
const P = (extra = {}) => ({ template: 'x', title: 'T', formats: ['9x16', '4x5'], brand: BRAND, content: { k: 1 }, ...extra });
const PRESETS = {
  base: { id: 'base', description: 'd', ...BRAND, name: 'Base', radius: 10 },
  blue: { extends: '@base', colors: { accent: '#0000FF' } },
  'loop-a': { extends: '@loop-b' }, 'loop-b': { extends: '@loop-a' },
};

// ---------- formats ----------
test('4x5: 1080x1350 portrait, safe area inside the frame, listed everywhere', () => {
  const F = frame('4x5');
  assert.equal(F.w, 1080); assert.equal(F.h, 1350); assert.equal(F.orient, 'v'); assert.equal(F.u, 1);
  assert.ok(contains(F.full, F.safe, 0));
  assert.ok(Math.abs(F.aspect - 0.8) < 1e-9);
  assert.deepEqual(FORMAT_IDS, ['9x16', '1x1', '4x5', '16x9']);
  assert.deepEqual(PROJECT_SCHEMA.properties.formats.items.enum, FORMAT_IDS, 'schema enum follows layout FORMATS');
  assert.deepEqual(Object.keys(PROJECT_SCHEMA.properties.overrides.properties), FORMAT_IDS);
  assert.equal(PROJECT_SCHEMA.properties.formats.maxItems, Object.keys(FORMATS).length);
  assert.equal(tileW(1080, 1350, 'contact'), 270);
});

// ---------- brand presets ----------
test('brand presets: "@id", {extends}, chains, cycles, missing presets, transitive ids', () => {
  assert.deepEqual(brandIds(P({ brand: '@blue' }), T, {}), ['blue']);
  assert.deepEqual(brandIds(P({ brand: '@blue' }), T, { blue: PRESETS.blue }), ['base'], 'presets that extend presets');
  assert.deepEqual(brandIds(P({ brand: '@blue', variants: [{ id: 'v', overrides: { brand: { extends: '@base' } } }] }), T, { ...PRESETS }), []);
  const b = expandBrand('@blue', PRESETS);
  assert.equal(b.colors.accent, '#0000FF'); assert.equal(b.colors.bg, '#000000'); assert.equal(b.radius, 10);
  assert.ok(!('id' in b) && !('description' in b) && !('extends' in b), 'preset meta and extends are removed');
  const p = expandBrand({ extends: '@base', name: 'Mine', colors: { fg: '#EEEEEE' } }, PRESETS);
  assert.equal(p.name, 'Mine'); assert.equal(p.colors.fg, '#EEEEEE'); assert.equal(p.colors.accent, '#FF0000');
  assert.throws(() => expandBrand('@loop-a', PRESETS), /cycle: @loop-a -> @loop-b -> @loop-a/);
  const r = resolveProject(P({ brand: '@nope' }), T);
  assert.deepEqual(r.errors, ['project.brand: brand preset "@nope" not found (brands/nope.json)']);
  const ok = resolveProject(P({ brand: '@blue' }), T, '4x5', { brands: PRESETS });
  assert.deepEqual(ok.errors, []); assert.equal(ok.resolved.brand.colors.accent, '#0000FF');
  assert.equal(PRESETS.blue.colors.accent, '#0000FF', 'presets are not mutated');
});

test('brands/*.json: every shipped preset expands to a valid brand; the tallyport logo exists', () => {
  const dir = join(ROOT, 'brands'), brands = {};
  for (const f of readdirSync(dir).filter((x) => x.endsWith('.json'))) brands[f.slice(0, -5)] = JSON.parse(readFileSync(join(dir, f), 'utf8'));
  assert.ok(brands.tallyport && brands.studio);
  for (const [id, preset] of Object.entries(brands)) {
    assert.equal(preset.id, id, `${id}: id matches the file name`);
    const r = resolveProject(P({ brand: `@${id}` }), T, '9x16', { brands });
    assert.deepEqual(r.errors, [], id);
  }
  assert.equal(brands.tallyport.colors.accent, '#3D5AFE');
  assert.ok(readFileSync(join(ROOT, brands.tallyport.logo), 'utf8').includes('<svg'));
});

// ---------- variants, cutdowns, overrides ----------
test('variants: content/brand/audio/captions overrides layer between the project and per-format overrides', () => {
  const proj = P({ brand: '@base', content: { k: 1, list: [1, 2] }, audio: { style: 'lofi' },
    variants: [{ id: 'de', overrides: { content: { k: 2 }, brand: { colors: { accent: '#00FF00' } }, audio: { key: 'D minor' } } },
      { id: 'blue', overrides: { brand: '@blue' } }],
    overrides: { '4x5': { content: { list: [9] } } } });
  const de = resolveProject(proj, T, '4x5', { variant: 'de', brands: PRESETS });
  assert.deepEqual(de.errors, []);
  assert.equal(de.resolved.content.k, 2); assert.deepEqual(de.resolved.content.list, [9]);
  assert.equal(de.resolved.brand.colors.accent, '#00FF00'); assert.equal(de.resolved.brand.name, 'Base', 'a partial brand merges onto the preset');
  assert.deepEqual(de.resolved.audio, { style: 'lofi', key: 'D minor' });
  assert.equal(resolveProject(proj, T, '9x16', { variant: 'blue', brands: PRESETS }).resolved.brand.colors.accent, '#0000FF');
  assert.equal(resolveProject(proj, T, '9x16', { brands: PRESETS }).resolved.content.k, 1, 'main is the project itself');
  assert.match(resolveProject(proj, T, undefined, { variant: 'fr', brands: PRESETS }).errors[0], /variant "fr" is not in project.variants \(main, de, blue\)/);
  const bad = resolveProject(P({ variants: [{ id: 'main' }, { id: 'a', overrides: { duration: 4 } }, { id: 'a' }] }), T);
  assert.ok(bad.errors.includes('project.variants[0].id: "main" is reserved'));
  assert.ok(bad.errors.includes('project.variants[2].id: duplicate id "a"'));
  assert.ok(bad.errors.includes('project.variants[1].overrides.duration: is not allowed'));
});

test('cutdowns: duration and poster replaced, full duration kept; reserved ids; longer than the film rejected', () => {
  const proj = P({ poster: 'bar2', cutdowns: [{ id: 'c6', duration: 6 }, { id: 'p', duration: 8, keep: ['a', 'b'], poster: 'b3' }] });
  const c = resolveProject(proj, T, '9x16', { cutdown: 'c6' });
  assert.deepEqual(c.errors, []);
  assert.equal(c.resolved.duration, 6); assert.equal(c.fullDuration, 12); assert.equal(c.resolved.poster, undefined, 'the film poster does not apply to a cut');
  assert.deepEqual({ ...c.cutdown }, { id: 'c6', duration: 6, keep: 'auto', poster: undefined });
  assert.equal(resolveProject(proj, T, '9x16', { cutdown: 'p' }).resolved.poster, 'b3');
  assert.equal(resolveProject(proj, T, '9x16').resolved.duration, 12);
  assert.match(resolveProject(P({ cutdowns: [{ id: 'l', duration: 30 }] }), T, undefined, { cutdown: 'l' }).errors[0], /duration 30s is longer than the film \(12s\)/);
  const bad = resolveProject(P({ cutdowns: [{ id: 'full', duration: 6 }, { id: 'x', duration: 6, keep: 'some' }, { id: 'y', duration: 6, keep: [] }] }), T);
  assert.ok(bad.errors.includes('project.cutdowns[0].id: "full" is reserved'));
  assert.ok(bad.errors.includes('project.cutdowns[1].keep: must match ^auto$'));
  assert.ok(bad.errors.includes('project.cutdowns[2].keep: must name at least one scene'));
  assert.match(resolveProject(proj, T, undefined, { cutdown: 'zz' }).errors[0], /cutdown "zz" is not in project.cutdowns \(full, c6, p\)/);
});

test('per-format overrides may not change duration/bpm/loop/audio/variants/cutdowns (clear error)', () => {
  const r = resolveProject(P({ overrides: { '4x5': { duration: 6, bpm: 90, loop: true, cutdowns: [], content: { k: 3 } } } }), T, '4x5');
  assert.ok(r.errors.includes('project.overrides.4x5.duration: may not be overridden per format (every format shares one timeline and one mix; use cutdowns:[{id, duration, keep}] for a shorter edit)'));
  assert.ok(r.errors.some((e) => e.startsWith('project.overrides.4x5.bpm:')));
  assert.ok(r.errors.some((e) => e.startsWith('project.overrides.4x5.loop:')));
  assert.ok(r.errors.some((e) => e.startsWith('project.overrides.4x5.cutdowns:')));
  assert.equal(r.resolved.duration, 12); assert.equal(r.resolved.content.k, 3);
});

test('renditions: legacy paths without variants/cutdowns, out/<variant>/<cutdown> otherwise', () => {
  assert.ok(isLegacyLayout(P()));
  assert.deepEqual(renditionDirs(P()), { legacy: true, variant: 'main', cutdown: 'full', out: 'out', audio: 'audio' });
  const proj = P({ variants: [{ id: 'de' }], cutdowns: [{ id: 'c6', duration: 6 }] });
  assert.deepEqual(renditionDirs(proj), { legacy: false, variant: 'main', cutdown: 'full', out: 'out/main/full', audio: 'audio' });
  assert.deepEqual(renditionDirs(proj, 'de', 'c6'), { legacy: false, variant: 'de', cutdown: 'c6', out: 'out/de/c6', audio: 'audio/de/c6' });
  assert.deepEqual(renditions(proj).map((r) => `${r.variant}/${r.cutdown}`), ['main/full', 'main/c6', 'de/full', 'de/c6']);
  assert.equal(resolveProject(proj, T, undefined, { variant: 'de', cutdown: 'c6' }).dirs.out, 'out/de/c6');
});

test('bespoke page: exactly one of template/page; content optional; validates with PAGE_TEMPLATE', () => {
  const page = { page: 'page.html', title: 'T', formats: ['4x5'], duration: 8, bpm: 120, brand: BRAND };
  assert.deepEqual(resolveProject(page, PAGE_TEMPLATE, '4x5').errors, []);
  assert.deepEqual(resolveProject({ ...page, template: 'x' }, PAGE_TEMPLATE).errors, ['project: set either template or page, not both']);
  const noTpl = { ...P() }; delete noTpl.template;
  assert.ok(resolveProject(noTpl, null).errors.includes('project.template: is required (or set page for a bespoke page)'));
  const noContent = { ...P() }; delete noContent.content;
  assert.ok(resolveProject(noContent, T).errors.includes('project.content: is required'));
  for (const bad of ['../x.html', 'page.js', '/abs.html']) assert.ok(validate({ ...page, page: bad }, PROJECT_SCHEMA).errors.some((e) => e.path === 'page'), bad);
});

// ---------- cutdown planning ----------
const sc = (id, beats, extra = {}) => ({ id, beats, draw() {}, ...extra });
const FILM = [sc('hook', 4), sc('click', 4), sc('chart', 6), sc('metric', 4), sc('cta', 'fill')];

test('planCutdown auto: first + last always, then film order while it fits; fill absorbs the rest', () => {
  const r = planCutdown(FILM, 12, 'auto');
  assert.deepEqual(r.kept.map((s) => s.id), ['hook', 'click', 'cta']);
  assert.deepEqual(r.dropped, ['chart', 'metric']); assert.equal(r.extend, null);
  const pri = planCutdown([sc('a', 4), sc('b', 4), sc('c', 4, { cut: 5 }), sc('d', 4)], 12, 'auto');
  assert.deepEqual(pri.kept.map((s) => s.id), ['a', 'c', 'd'], 'priority (scene.cut number) beats film order');
  const kd = planCutdown([sc('a', 4), sc('b', 2, { cut: 'drop' }), sc('c', 4, { cut: 'keep' }), sc('d', 4)], 14, 'auto');
  assert.deepEqual(kd.kept.map((s) => s.id), ['a', 'c', 'd']); assert.deepEqual(kd.extend, { id: 'd', beats: 6 }, 'no fill: the last scene holds longer');
  assert.throws(() => planCutdown([sc('a', 8), sc('b', 8)], 12, 'auto'), /first, last and cut:'keep' scenes need 16 beats but the cutdown has 12/);
});

test('planCutdown keep: named scenes in film order; unknown ids and overflow are clear errors', () => {
  const r = planCutdown(FILM, 16, ['cta', 'hook', 'metric']);
  assert.deepEqual(r.kept.map((s) => s.id), ['hook', 'metric', 'cta'], 'film order, not list order');
  assert.throws(() => planCutdown(FILM, 16, ['hook', 'nope']), /unknown scene\(s\) "nope" \(scenes: hook, click, chart, metric, cta\)/);
  assert.throws(() => planCutdown(FILM, 8, ['hook', 'chart', 'cta']), /kept scenes need 12 beats but the cutdown has 8/);
  assert.throws(() => planCutdown(FILM, 8, 'some'), /keep must be "auto" or a list/);
});

test('applyCutdown + compile: the cut timeline sums to the cutdown, drops build().poster, keeps template-planned cuts', () => {
  const grid = makeGrid({ bpm: 120 }, 6);
  const built = applyCutdown({ scenes: FILM, poster: 'b20' }, grid.totalBeats, { id: 'c6', keep: 'auto' });
  assert.equal(built.poster, undefined);
  assert.deepEqual(built.cut, { id: 'c6', kept: ['hook', 'click', 'cta'], dropped: ['chart', 'metric'], extended: null, by: 'engine' });
  const tl = compile(built, grid, {});
  assert.deepEqual(tl.scenes.map((s) => [s.id, s.start, s.beats]), [['hook', 0, 4], ['click', 4, 4], ['cta', 8, 4]]);
  const ext = compile(applyCutdown({ scenes: [sc('a', 4), sc('b', 4), sc('c', 2)] }, 12, { id: 'x', keep: ['a', 'c'] }), makeGrid({ bpm: 120 }, 6), {});
  assert.deepEqual(ext.scenes.map((s) => s.beats), [4, 8]);
  const own = applyCutdown({ scenes: [sc('a', 12)], cutdownApplied: true }, 12, { id: 'x', keep: 'auto' });
  assert.equal(own.cut.by, 'template'); assert.equal(own.scenes.length, 1);
  assert.equal(applyCutdown({ scenes: FILM }, 12, null).scenes, FILM, 'no cutdown: untouched');
});

// ---------- sheets ----------
const info = (over = {}) => {
  const bpm = 120, n = over.beats || 24, spb = 0.5;
  return { duration: n * spb, bpm, loop: false, poster: 9, beatTimes: Array.from({ length: n }, (_, i) => i * spb), events: [0, 0.5, 2, 2.5, 3, 7],
    scenes: [{ id: 'a', start: 0, end: 2, transition: { type: 'cut', beats: 0 } }, { id: 'b', start: 2, end: 5, transition: { type: 'cut', beats: 0 } },
      { id: 'c', start: 5, end: n * spb, transition: { type: 'wipe', beats: 1 } }], ...over };
};

test('contact: one tile per beat on the beat grid; long films group to bars, then 2 bars', () => {
  const i = info();
  assert.deepEqual(contactTimes(i).times, i.beatTimes);
  assert.equal(contactTimes(i).unit, 'beat');
  const long = info({ beats: 120 });
  const c = contactTimes(long);
  assert.equal(c.unit, 'bar'); assert.equal(c.times.length, 30); assert.equal(c.times[1], 2);
  const huge = contactTimes(info({ beats: 600 }));
  assert.ok(huge.times.length <= CONTACT_MAX); assert.match(huge.unit, /bars$/);
  const measured = info({ beatTimes: Array.from({ length: 24 }, (_, k) => 0.017 + k * 0.5) });
  assert.equal(sheetTimes('contact', measured)[3], 1.517, 'measured grid (with lag) is used as is');
});

test('strip: 12 frames spanning the busiest boundary; a real transition wins over busy cuts', () => {
  const i = info();
  const b = busiestBoundary(i);
  assert.equal(b.index, 2, 'the wipe into c'); assert.equal(b.transition.type, 'wipe');
  const t = stripTimes(i);
  assert.equal(t.length, 12);
  assert.ok(t[0] < 5 && t[11] > 5.5, `spans the 1-beat wipe at 5s: ${t}`);
  const cuts = info({ scenes: i.scenes.map((s) => ({ ...s, transition: { type: 'cut', beats: 0 } })) });
  assert.equal(busiestBoundary(cuts).index, 1, 'all cuts: the boundary with the most events nearby');
  const one = info({ scenes: [{ id: 'a', start: 0, end: 12 }] });
  assert.equal(busiestBoundary(one), null);
  assert.equal(stripTimes(one).length, 12);
  for (const x of stripTimes(info({ scenes: [i.scenes[0], { ...i.scenes[2], start: 11.8 }] }))) assert.ok(x >= 0 && x <= 12 - 1 / 30 + 1e-4, String(x));
});

// ---------- render shutter ----------
test('subframeTime: centred shutter; loop films wrap sub-frames around the seam, one-shots clamp', () => {
  assert.equal(subframeTime(30, 30, 1, 10, false), 1, 'sub 1 = v1 timing');
  const rate = 240, sub = 4;
  const f1 = [4, 5, 6, 7].map((i) => subframeTime(i, rate, sub, 10, false));
  assert.ok(Math.abs((f1[0] + f1[3]) / 2 - 1 / 60) < 1e-12, 'frame 1 is centred on 1/60 s');
  const f0loop = [0, 1, 2, 3].map((i) => subframeTime(i, rate, sub, 10, true));
  assert.ok(f0loop[0] > 9.99 && f0loop[1] > 9.99 && f0loop[2] < 0.01, `loop frame 0 straddles the seam: ${f0loop}`);
  assert.deepEqual([0, 1].map((i) => subframeTime(i, rate, sub, 10, false)), [0, 0]);
});

// ---------- feature interfaces ----------
test('v2 interfaces keep their signatures and are implemented (no NotImplemented left)', async () => {
  const fns = [[captions.drawCaptions, 3], [captions.segmentsFromLines, 3], [media.imageBlock, 2], [media.clipBlock, 2], [media.lowerThird, 2],
    [capSide.writeSidecars, 2], [capSide.manualSegments, 2], [media.loadClips, 2], [voiceover.buildVoiceover, 2], [voiceover.mixVoiceover, 1],
    [clips.extractClip, 1], [clips.prepareClips, 1], [exporter.exportPresets, 1], [exporter.renderRange, 1]];
  for (const [fn, n] of fns) {
    assert.equal(typeof fn, 'function'); assert.equal(fn.length, n, `${fn.name} arity`);
    // bad input fails with a real error, never the NotImplemented marker
    let err = null;
    try { await fn(); } catch (e) { err = e; }
    assert.ok(!isNotImplemented(err), `${fn.name} still throws NotImplemented`);
  }
  assert.deepEqual([...exporter.EXPORT_PRESETS], PROJECT_SCHEMA.properties.exports.items.enum);
  assert.ok(isNotImplemented(new NotImplemented('x')) && !isNotImplemented(new Error('x')));
});

test('schema: v2 fields validate (voiceover, captions, exports, clips) and reject bad values with paths', () => {
  const good = P({ audio: { voiceover: { engine: 'say', voice: 'Samantha', lines: [{ text: 'Hi', at: 'bar1' }, { text: 'There' }], duck_db: -8 } },
    captions: { enabled: true, style: 'clean', source: 'manual', sidecars: true, lines: [{ text: 'Hi', at: 0, end: 'b4' }] },
    exports: ['720p', 'gif', 'reels'], clips: { demo: { src: 'assets/demo.mp4', from: 0, to: 2, fps: 30 } } });
  assert.deepEqual(validate(good, PROJECT_SCHEMA).errors, []);
  const bad = P({ audio: { voiceover: { engine: 'cloud', lines: [{ at: 1 }], duck_db: 3 } }, captions: { source: 'asr' }, exports: ['8k'] });
  assert.deepEqual(validate(bad, PROJECT_SCHEMA).errors.map((e) => e.path).sort(),
    ['audio.voiceover.duck_db', 'audio.voiceover.engine', 'audio.voiceover.lines[0].text', 'captions.source', 'exports[0]']);
  // supplied-music fit, transparent, typed clips
  const v2b = P({ audio: { music: 'audio/track.wav', musicStart: 1.5, fit: 'loop' }, transparent: true, clips: { a: { src: 'assets/a.webm', fps: 24, width: 640 } } });
  assert.deepEqual(validate(v2b, PROJECT_SCHEMA).errors, []);
  const bad2 = P({ audio: { musicStart: -1, fit: 'stretch' }, transparent: 'yes', clips: { a: { from: 0, fps: 0, width: 8, speed: 2 } } });
  assert.deepEqual(validate(bad2, PROJECT_SCHEMA).errors.map((e) => e.path).sort(),
    ['audio.fit', 'audio.musicStart', 'clips.a.fps', 'clips.a.speed', 'clips.a.src', 'clips.a.width', 'transparent']);
  assert.equal(PROJECT_SCHEMA.properties.audio.properties.voiceover.properties.duck_db.default, voiceover.DEFAULT_DUCK_DB);
});
