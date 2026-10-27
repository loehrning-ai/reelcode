// fontslocale.test.mjs: project.fonts (schema, boot in a real page, lint, manifest licence), showreel content.locale
// (German number format) and the montage's full stop, which a line ending in a number does not get.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { copyFileSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { uniq } from './_names.mjs';
import { resolveProject, validate, PROJECT_SCHEMA } from '../schema.js';
import { counterText } from '../text.js';
import { endsInNumber } from '../../templates/showreel/middle.js';
import { startServer } from '../cli/lib/server.mjs';
import { launch, openPage } from '../cli/lib/browser.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const NAME = uniq('_zz-pfonts'), DIR = join(ROOT, 'projects', NAME);
const readJ = (f) => JSON.parse(readFileSync(f, 'utf8'));
const TEMPLATE = readJ(join(ROOT, 'templates/showreel/template.json'));
const EXAMPLE = readJ(join(ROOT, 'projects/example-showreel/project.json'));
const FACE = { family: 'Fixture Face', file: 'fonts/face.woff2', weight: '100 900', licence: 'OFL-1.1' };
const BRAND = { ...EXAMPLE.brand, fonts: {
  display: { family: '"Fixture Face", sans-serif', weight: 800, tracking: -0.02 },
  ui: { family: '"Fixture Face", sans-serif', weight: 500, tracking: 0 } } };
const run = (cmd, ...args) => spawnSync('node', [join(ROOT, 'engine', 'cli', `${cmd}.mjs`), ...args], { cwd: ROOT, encoding: 'utf8', timeout: 300000 });
after(() => rmSync(DIR, { recursive: true, force: true }));

test('project.fonts schema: family, file inside the project, weight, and a required licence; no per-format override', () => {
  const ok = (fonts) => validate(fonts, PROJECT_SCHEMA.properties.fonts).errors;
  assert.deepEqual(ok([FACE]), []);
  assert.deepEqual(ok([{ family: 'Brand Sans', file: 'assets/fonts/BrandSans-Bold.otf', weight: 700, style: 'italic', licence: 'Desktop and video licence, Example GmbH' }]), []);
  const { licence: _l, ...noLicence } = FACE;
  assert.match(JSON.stringify(ok([noLicence])), /licence.*is required/);
  for (const file of ['../face.woff2', 'fonts/../../x.woff2', 'out/face.woff2', 'fonts/face.svg', '/abs/face.woff2'])
    assert.ok(ok([{ ...FACE, file }]).length, `${file} is refused`);
  assert.ok(ok([{ ...FACE, weight: 'bold' }]).length, 'weight is a number or a range');
  assert.ok(ok([{ ...FACE, family: 'a"b' }]).length, 'no quotes in a family name');
  const project = { ...EXAMPLE, fonts: [FACE], overrides: { '9x16': { fonts: [] } } };
  assert.match(resolveProject(project, TEMPLATE, '9x16').errors.join('\n'), /overrides\.9x16\.fonts: may not be overridden per format/);
});

test('showreel content.locale: validated as a BCP 47 tag; metric and pct numbers follow it', () => {
  const errs = (content) => resolveProject({ ...EXAMPLE, content: { ...EXAMPLE.content, ...content } }, TEMPLATE, '16x9').errors;
  assert.deepEqual(errs({ locale: 'de-DE' }), []);
  assert.match(errs({ locale: 'de_DE' }).join('\n'), /content\.locale: must match/);
  assert.match(errs({ capture: { states: ['home'], nope: 1 } }).join('\n'), /content\.capture\.nope: is not allowed/);
  assert.equal(counterText(3.8, 1, { fmt: 'pct', decimals: 1, locale: 'de-DE' }), '3,8 %');
  assert.equal(counterText(42.5, 1, { fmt: 'pct', decimals: 1, locale: 'en-US' }), '42.5%');
  assert.equal(counterText(1234, 1, { locale: 'de-DE' }), '1.234');
});

test('montage: no full stop after a line that ends in a number', () => {
  for (const s of ['+105 %', '−20 %', '3,8 %', '2026', '10x', '4 Mio', '100%', 'Q4', '12,5k', '9 h']) assert.equal(endsInNumber(s), true, s);
  for (const s of ['LAUNCHES', 'DATA', '3 PILLARS', 'Dieselben Wochen', 'ADS 4 YOU', '']) assert.equal(endsInNumber(s), false, s);
});

test('project.fonts in a real page: the brand renders in a project font, lint is clean, make records the licence', { timeout: 600000 }, async () => {
  rmSync(DIR, { recursive: true, force: true });
  mkdirSync(join(DIR, 'fonts'), { recursive: true });
  copyFileSync(join(ROOT, 'engine/fonts/Jost-Variable.woff2'), join(DIR, 'fonts/face.woff2'));
  const montage = { technique: 'montage', beats: 3, lines: ['+26 %', '−20 %'], text: 'Dieselben Wochen', transition: 'cut' };
  const shots = EXAMPLE.content.shots.map((s) => (s.technique === 'montage' ? { ...montage, beats: s.beats, lines: [...montage.lines, 'DATA', '2026', 'LOOPS'] } : s));
  const project = { ...EXAMPLE, title: 'Project font', formats: ['1x1'], brand: BRAND, fonts: [FACE], content: { ...EXAMPLE.content, locale: 'de-DE', shots } };
  delete project.$schema;
  writeFileSync(join(DIR, 'project.json'), JSON.stringify(project, null, 2));

  const srv = await startServer(), browser = await launch();
  try {
    const s = await openPage({ browser, base: srv.base, project: NAME, format: '1x1', quiet: true });
    try {
      const faces = await s.page.evaluate(() => [...document.fonts].filter((f) => f.family.replace(/"/g, '') === 'Fixture Face').map((f) => f.status));
      assert.deepEqual(faces, ['loaded']);
    } finally { await s.close(); }
    // without the fonts entry the same brand is a boot error that names project.fonts
    writeFileSync(join(DIR, 'project.json'), JSON.stringify({ ...project, fonts: undefined }, null, 2));
    await assert.rejects(openPage({ browser, base: srv.base, project: NAME, format: '1x1', quiet: true }), /font missing: display "Fixture Face" is neither bundled nor installed here; add its file to project\.fonts/);
  } finally { await browser.close(); await srv.close(); }

  writeFileSync(join(DIR, 'project.json'), JSON.stringify(project, null, 2));
  const l = run('lint', `projects/${NAME}`, '--fast');
  assert.equal(l.status, 0, l.stdout + l.stderr);
  const m = run('make', `projects/${NAME}`, '--formats', '1x1', '--no-stills', '--only', 'video');
  assert.equal(m.status, 0, m.stdout + m.stderr);
  const man = readJ(join(DIR, 'out/manifest.json'));
  assert.equal(man.fonts.length, 1);
  assert.deepEqual({ ...man.fonts[0], sha256: undefined }, { family: 'Fixture Face', file: 'fonts/face.woff2', licence: 'OFL-1.1', sha256: undefined });
  assert.match(man.fonts[0].sha256, /^[0-9a-f]{64}$/);

  rmSync(join(DIR, 'fonts/face.woff2'));
  const gone = run('lint', `projects/${NAME}`, '--fast');
  assert.notEqual(gone.status, 0);
  assert.match(readFileSync(join(DIR, 'out/lint.json'), 'utf8'), /fonts\[0\] fonts\/face.woff2 is missing/);
});
