import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { validate, resolveProject, deepMerge, PROJECT_SCHEMA } from '../schema.js';
import { loadBrands } from '../cli/lib/project.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const templates = readdirSync(join(ROOT, 'templates'), { withFileTypes: true }).filter((d) => d.isDirectory() && existsSync(join(ROOT, 'templates', d.name, 'template.json'))).map((d) => d.name);

test('PROJECT_SCHEMA deep-equals docs/project.schema.json', () => {
  assert.deepEqual(PROJECT_SCHEMA, JSON.parse(readFileSync(join(ROOT, 'docs', 'project.schema.json'), 'utf8')));
});
test('every template.json example validates in every listed format (brand presets expanded)', () => {
  assert.ok(templates.length >= 1);
  for (const name of templates) {
    const t = JSON.parse(readFileSync(join(ROOT, 'templates', name, 'template.json'), 'utf8'));
    assert.equal(t.id, name);
    const project = { template: name, ...t.example };
    // brand presets ("@id", {extends}) are expanded exactly as new/make/the page do (brands/<id>.json)
    const { brands, errors: brandErrors } = loadBrands(project, t);
    assert.deepEqual(brandErrors, [], `${name}: ${brandErrors.join('; ')}`);
    const { base, errors } = resolveProject(project, t, undefined, { brands });
    assert.deepEqual(errors, [], `${name}: ${errors.join('; ')}`);
    for (const fmt of base.formats) assert.deepEqual(resolveProject(project, t, fmt, { brands }).errors, [], `${name} ${fmt}`);
  }
});
test('every shipped projects/*/project.json validates against the schema', () => {
  const dirs = readdirSync(join(ROOT, 'projects'), { withFileTypes: true })
    .filter((d) => d.isDirectory() && existsSync(join(ROOT, 'projects', d.name, 'project.json')) && (d.name.startsWith('example-') || ['_smoke', '_smoke-ui', '_media'].includes(d.name)));
  assert.ok(dirs.length >= 8);
  for (const d of dirs) {
    const project = JSON.parse(readFileSync(join(ROOT, 'projects', d.name, 'project.json'), 'utf8'));
    const t = JSON.parse(readFileSync(join(ROOT, 'templates', project.template, 'template.json'), 'utf8'));
    const { brands, errors: brandErrors } = loadBrands(project, t);
    assert.deepEqual(brandErrors, [], `${d.name}: ${brandErrors.join('; ')}`);
    assert.deepEqual(resolveProject(project, t, undefined, { brands }).errors, [], d.name);
  }
});
test('prepare.run accepts repo paths and ./project paths, never ..', () => {
  const run = PROJECT_SCHEMA.properties.prepare.items.properties.run;
  for (const ok of ['templates/x/score.py', './assets/bed.py', './scripts/make.py']) assert.deepEqual(validate(ok, run).errors, [], ok);
  for (const bad of ['../x.py', './../x.py', '/abs/x.py', 'x.sh', '.hidden.py']) assert.ok(validate(bad, run).errors.length, bad);
});
const good = { template: 'x', title: 'T', formats: ['9x16'], content: {},
  brand: { colors: { bg: '#000000', fg: '#FFFFFF', accent: '#FF0000' }, fonts: { display: { family: 'A' }, ui: { family: 'B' } } } };
test('known-bad projects produce the expected paths', () => {
  assert.deepEqual(validate(good, PROJECT_SCHEMA).errors, []);
  const badHex = deepMerge(good, { brand: { colors: { accent: '#FF00' } } });
  assert.deepEqual(validate(badHex, PROJECT_SCHEMA).errors.map((e) => e.path), ['brand.colors.accent']);
  const badFmt = deepMerge(good, { formats: ['9x16', '5x4'] });
  const e2 = validate(badFmt, PROJECT_SCHEMA).errors;
  assert.equal(e2[0].path, 'formats[1]'); assert.match(e2[0].msg, /one of 9x16,1x1,4x5,16x9/);
  const noFont = deepMerge(good); delete noFont.brand.fonts.ui;
  assert.deepEqual(validate(noFont, PROJECT_SCHEMA).errors.map((e) => e.path), ['brand.fonts.ui']);
  const extra = deepMerge(good, { colour: 'red' });
  assert.match(validate(extra, PROJECT_SCHEMA).errors[0].msg, /not allowed/);
});
test('validator keywords and resolution rules', () => {
  const s = { type: 'object', required: ['a'], properties: { a: { type: 'array', minItems: 2, items: { type: 'integer', minimum: 0 } }, b: { const: 3 }, c: { type: 'string', pattern: '^x', maxLength: 3 } } };
  assert.deepEqual(validate({ a: [1, -1, 2.5], b: 4, c: 'yyyy' }, s).errors.map((e) => e.path), ['a[1]', 'a[2]', 'b', 'c', 'c']);
  assert.match(validate({}, { oneOf: [] }).errors[0].msg, /unsupported/);
  const t = { id: 'x', defaults: { duration: 8, bpm: 100, audio: { music: 'synth', sfx: true } }, content_schema: { type: 'object', required: ['k'] } };
  const p = { ...good, content: { k: 1, list: [1, 2, 3] }, formats: ['9x16', '16x9'], overrides: { '16x9': { content: { list: [9] }, audio: { sfx: false } } } };
  const r = resolveProject(p, t, '16x9');
  assert.deepEqual(r.resolved.content.list, [9], 'arrays replace');
  assert.equal(r.resolved.duration, 8);
  assert.ok(r.errors.some((e) => /overrides.16x9.audio: may not be overridden/.test(e)));
  assert.equal(r.resolved.audio.sfx, true);
  assert.ok(resolveProject({ ...p, content: {} }, t, '9x16').errors.some((e) => e.startsWith('content.k')));
  assert.notEqual(r.resolved.brand, p.brand, 'merge returns new objects');
});
