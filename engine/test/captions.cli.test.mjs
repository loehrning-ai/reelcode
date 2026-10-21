// captions + text QA in a real page (chromium): burned-in captions are drawn, logged inside the safe area and pass
// the contrast check; lint's text QA flags low-contrast text with time + text per format; --strict-text fails the run.
import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync, rmSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { uniq, reName } from './_names.mjs';
import { startServer } from '../cli/lib/server.mjs';
import { launch, openPage } from '../cli/lib/browser.mjs';
import { FORMATS } from '../layout.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const CAP = uniq('_zz-captions'), CDIR = join(ROOT, 'projects', CAP);
const LOW = uniq('_zz-lowcontrast'), LDIR = join(ROOT, 'projects', LOW);
const run = (cmd, ...args) => spawnSync('node', [join(ROOT, 'engine', 'cli', `${cmd}.mjs`), ...args], { cwd: ROOT, encoding: 'utf8', timeout: 300000 });
const readJ = (f) => JSON.parse(readFileSync(f, 'utf8'));
after(() => { for (const d of [CDIR, LDIR]) rmSync(d, { recursive: true, force: true }); });

function project(dir, name, patch) {
  rmSync(dir, { recursive: true, force: true });
  const n = run('new', '--template', '_smoke', '--name', name, '--formats', '9x16,4x5,16x9');
  assert.equal(n.status, 0, n.stderr);
  const p = readJ(join(dir, 'project.json'));
  writeFileSync(join(dir, 'project.json'), JSON.stringify(patch(p), null, 2));
}

test('captions: drawn in the page from manual lines, words logged inside the safe area, lint text QA clean for them', async () => {
  project(CDIR, CAP, (p) => ({ ...p, captions: { enabled: true, source: 'manual', lines: [
    { text: 'One timeline renders every format.', at: 'b2' },
    { text: 'Captions page every two lines and highlight the spoken word in the accent.', at: 'b8', end: 'b14' }] } }));
  const srv = await startServer(), browser = await launch();
  try {
    for (const fmt of ['9x16', '4x5', '16x9']) {
      const s = await openPage({ browser, base: srv.base, project: CAP, format: fmt, quiet: true });
      try {
        assert.deepEqual(s.warnings.filter((w) => /captions/.test(w)), [], fmt);
        const t = await s.page.evaluate(() => window.__reelcode.time('b3'));
        await s.seek(t);
        const r = await s.report();
        const all = ['One', 'timeline', 'renders', 'every', 'format.'];
        const words = r.texts.filter((x) => all.includes(x.s));
        assert.ok(words.length >= 3 && words[0].s === 'One', `${fmt}: the first caption page is logged (${words.map((w) => w.s).join(' ')})`);
        const lines = new Set(words.map((w) => Math.round(w.box.y)));
        assert.ok(lines.size <= 2, `${fmt}: at most 2 lines`);
        const sf = FORMATS[fmt], safe = { x: sf.safe.l, y: sf.safe.t, x2: sf.w - sf.safe.r, y2: sf.h - sf.safe.b };
        for (const w of words) assert.ok(w.box.x >= safe.x && w.box.y >= safe.y && w.box.x + w.box.w <= safe.x2 && w.box.y + w.box.h <= safe.y2, `${fmt}: "${w.s}" inside the safe area`);
        const h1 = await s.seekHash(t), h2 = await s.seekHash(t);
        assert.equal(h1, h2, 'deterministic');
        await s.seek(await s.page.evaluate(() => window.__reelcode.time('b1')));
        assert.equal((await s.report()).texts.filter((x) => x.s === 'One').length, 0, `${fmt}: nothing before the first line`);
      } finally { await s.close(); }
    }
  } finally { await browser.close(); await srv.close(); }
  const l = run('lint', `projects/${CAP}`, '--fast');
  assert.equal(l.status, 0, l.stdout + l.stderr);
  const j = readJ(join(CDIR, 'out/lint.json'));
  assert.deepEqual(Object.keys(j.textqa).sort(), ['16x9', '4x5', '9x16']);
  const capWords = /One|timeline|renders|every|format|Captions|page|two|lines|highlight|spoken|word|accent/;
  for (const [fmt, q] of Object.entries(j.textqa)) {
    assert.ok(q.checked > 0, fmt);
    assert.deepEqual(q.issues.filter((i) => capWords.test(i.text)), [], `${fmt}: captions pass contrast/safe/size`);
  }
});

test('text QA: low-contrast brand is flagged per format with time + text; --strict-text turns it into errors', () => {
  project(LDIR, LOW, (p) => ({ ...p, formats: ['9x16', '16x9'], brand: { ...p.brand, colors: { ...p.brand.colors, fg: '#2A2B2E', bg: '#101113' } } }));
  const l = run('lint', `projects/${LOW}`, '--fast');
  assert.equal(l.status, 0, 'warnings by default');
  const j = readJ(join(LDIR, 'out/lint.json'));
  for (const fmt of ['9x16', '16x9']) {
    const iss = j.textqa[fmt].issues.filter((i) => i.kind === 'contrast');
    assert.ok(iss.length > 0, `${fmt}: contrast issues found`);
    for (const i of iss) {
      assert.ok(i.contrast < i.need && typeof i.t === 'number' && i.text && i.scene, JSON.stringify(i));
      assert.ok(i.need === 3 || i.need === 4.5);
    }
    assert.ok(iss.some((i) => i.fg === '#2A2B2E'), `${fmt}: measured glyph colour is the fg`);
  }
  assert.ok(j.warnings.some((w) => /^textqa \[9x16\]: ".+" [\d.]+px at t=\d+\.\d\d \(.+\): contrast \d\.\d\d < (3|4\.5)/.test(w)), j.warnings.join('\n'));
  const strict = run('lint', `projects/${LOW}`, '--fast', '--strict-text');
  assert.equal(strict.status, 1);
  assert.ok(readJ(join(LDIR, 'out/lint.json')).errors.some((e) => e.startsWith('textqa [16x9]')));
  const off = run('lint', `projects/${LOW}`, '--fast', '--no-textqa');
  assert.equal(off.status, 0);
  assert.deepEqual(readJ(join(LDIR, 'out/lint.json')).textqa, {});
});
