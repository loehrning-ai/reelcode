// capture.test.mjs — docs/SPEC.md §10: capture fixture:mock-product into a temp project.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { uniq } from './_names.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const CLI = join(ROOT, 'engine/cli/capture.mjs');
const PROJ = join(ROOT, 'projects', uniq('_capture_unit'));
const FROZEN = ['logo', 'nav', 'search', 'kpi-1', 'kpi-2', 'kpi-3', 'chart', 'export', 'primary', 'palette', 'result-1', 'filters', 'report-chart', 'toast'];
const HEX = /^#[0-9A-F]{6}$/;

after(() => rmSync(PROJ, { recursive: true, force: true }));

test('captures 3 states, logo, assets.json with every frozen cap id, and applies brand', { timeout: 120000 }, () => {
  rmSync(PROJ, { recursive: true, force: true });
  mkdirSync(PROJ, { recursive: true });
  writeFileSync(join(PROJ, 'project.json'), JSON.stringify({
    template: 'product-launch', title: 't', formats: ['16x9'],
    brand: { colors: { bg: '#000000', fg: '#FFFFFF', accent: '#FF0000' }, fonts: { display: { family: 'serif', weight: 800 }, ui: { family: 'serif' } } },
    content: {},
  }, null, 2));
  const out = execFileSync('node', [CLI, 'fixture:mock-product', PROJ, '--states', 'home,search,report', '--apply-brand'], { cwd: ROOT, encoding: 'utf8' });
  assert.equal(JSON.parse(out.trim().split('\n').pop()).ok, true);

  const a = JSON.parse(readFileSync(join(PROJ, 'assets/assets.json'), 'utf8'));
  assert.deepEqual(Object.keys(a.screens), ['home', 'search', 'report']);
  assert.deepEqual(a.viewport, { w: 1440, h: 900, dpr: 2 });
  const ids = new Set();
  for (const [s, e] of Object.entries(a.screens)) {
    assert.ok(existsSync(join(PROJ, e.file)), `${s} screen`);
    assert.ok(existsSync(join(PROJ, e.full.file)), `${s} full`);
    assert.equal(e.w, 2880); assert.equal(e.h, 1800);
    for (const [id, r] of Object.entries(e.rects)) {
      ids.add(id);
      assert.equal(r.length, 4);
      assert.ok(r[2] > 0 && r[3] > 0, `${s}.${id} has size`);
      assert.ok(existsSync(join(PROJ, e.crops[id].file)), `${s}.${id} crop`);
    }
  }
  for (const id of FROZEN) assert.ok(ids.has(id), `cap id ${id}`);
  assert.ok(existsSync(join(PROJ, 'assets/logo.png')));
  assert.ok(existsSync(join(PROJ, 'assets/logo.svg')));
  assert.deepEqual(a.colors, { bg: '#0F1012', fg: '#F2F0EA', accent: '#3D5AFE', muted: '#6B6B70', surface: '#1C1C20' });
  assert.equal(a.colorsSource, 'css-vars');
  for (const p of a.palette) assert.match(p.hex, HEX);
  assert.equal(a.sampled.accent && a.sampled.accent.slice(0, 2), '#3', 'pixel-sampled accent is the blue');
  assert.equal(a.fonts.display, 'Archivo, sans-serif');
  assert.equal(a.fonts.ui, 'Inter, sans-serif');
  assert.ok(!JSON.stringify(a).match(/20\d\d-\d\d-\d\dT/), 'no timestamps');

  const pj = JSON.parse(readFileSync(join(PROJ, 'project.json'), 'utf8'));
  assert.equal(pj.brand.colors.accent, '#3D5AFE');
  assert.equal(pj.brand.fonts.display.family, 'Archivo, sans-serif');
  assert.equal(pj.brand.fonts.display.weight, 800, 'other keys kept');
  assert.equal(pj.brand.logo, 'assets/logo.png');
});

test('refuses non-local targets without touching the network', () => {
  for (const t of ['https://example.com', 'http://10.0.0.1:8080/', 'fixture:../etc']) {
    const r = spawnSync('node', [CLI, t, PROJ], { cwd: ROOT, encoding: 'utf8' });
    assert.equal(r.status, 1, t);
    assert.match(r.stderr, /refused|bad fixture/);
  }
});
