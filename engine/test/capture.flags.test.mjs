// capture.flags.test.mjs: capture of a client-rendered page (docs/CLI.md capture): --wait-for, --warm, --scroll,
// --hide and the same recipe from project.json content.capture; every miss fails closed.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { uniq } from './_names.mjs';
import { resolveProject } from '../schema.js';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const CLI = join(ROOT, 'engine/cli/capture.mjs');
const PROJ = join(ROOT, 'projects', uniq('_zz-capflags'));
const SITE = mkdtempSync(join(tmpdir(), 'reelcode-capflags-'));
const PAGE = join(SITE, 'index.html');

// The page counts its loads in sessionStorage (#pass is 100 px wide per load), mounts #late after 3.5 s (later than
// the plain settle waits), keeps a fixed .badge overlay and puts #target 2400 px down, with room to scroll it to the top.
writeFileSync(PAGE, `<!doctype html><html><head><meta charset="utf-8"><style>
body{margin:0;font:16px sans-serif} h1{margin:0;height:60px}
#pass{height:20px;background:#333} .badge{position:fixed;left:8px;bottom:8px;width:40px;height:40px;background:#f0f}
#spacer{height:2400px} #target{height:200px;background:#0a0}
</style></head><body><h1 id="top">Top</h1><div id="pass"></div><div class="badge"></div><div id="spacer"></div>
<div id="target">target</div><div id="tail" style="height:1000px"></div><script>
const n = Number(sessionStorage.getItem('n') || 0) + 1; sessionStorage.setItem('n', String(n));
document.getElementById('pass').style.width = (n * 100) + 'px';
setTimeout(() => { const d = document.createElement('div'); d.id = 'late'; d.style.cssText = 'width:300px;height:50px;background:#00f';
  document.body.prepend(d); }, 3500);
</script></body></html>`);

const SELECTORS = 'late=#late,badge=.badge,pass=#pass,target=#target,top=#top';
const BASE = ['--states', 'default', '--w', '800', '--h', '600', '--dpr', '1', '--no-full'];
const capture = (...args) => spawnSync('node', [CLI, PAGE, PROJ, ...args], { cwd: ROOT, encoding: 'utf8', timeout: 180000 });
const screen = () => JSON.parse(readFileSync(join(PROJ, 'assets/assets.json'), 'utf8')).screens.default;
function fresh(project) {
  rmSync(PROJ, { recursive: true, force: true });
  mkdirSync(PROJ, { recursive: true });
  if (project) writeFileSync(join(PROJ, 'project.json'), JSON.stringify(project, null, 2));
}
after(() => { rmSync(PROJ, { recursive: true, force: true }); rmSync(SITE, { recursive: true, force: true }); });

test('without the new flags: one load, the overlay is captured, the late element is not, nothing scrolls', { timeout: 180000 }, () => {
  fresh();
  const r = capture(...BASE, '--selectors', SELECTORS);
  assert.equal(r.status, 0, r.stderr);
  const s = screen();
  assert.equal(s.crops.pass.w, 100, 'loaded once');
  assert.ok(s.rects.badge, 'overlay in the shot');
  assert.equal(s.crops.late, undefined, 'the late element is not mounted yet');
  assert.equal(s.scroll, undefined);
  assert.deepEqual(s.rects.top, [0, 0, 800, 60]);
});

test('--wait-for, --warm, --scroll with --scroll-offset and --hide', { timeout: 180000 }, () => {
  fresh();
  const r = capture(...BASE, '--selectors', SELECTORS, '--wait-for', '#late', '--warm', '--scroll', '#target', '--scroll-offset', '50', '--hide', '.badge');
  assert.equal(r.status, 0, r.stderr);
  const s = screen();
  assert.equal(s.crops.pass.w, 200, '--warm loads the state twice');
  assert.ok(s.crops.late, '--wait-for waited for the late element');
  assert.equal(s.rects.badge, undefined, '--hide removed the overlay');
  assert.equal(s.crops.badge, undefined);
  assert.deepEqual(s.rects.target.slice(0, 2), [0, 50], 'the target sits --scroll-offset below the top');
  assert.equal(s.rects.target[3], 200);
  assert.ok(s.scroll && s.scroll.y > 2000, `the screen records its scroll (${JSON.stringify(s.scroll)})`);
  assert.equal(s.rects.top, undefined, 'an element scrolled out of view has no screen rect');
  assert.ok(s.crops.top, 'but keeps its crop');
});

test('the same recipe from content.capture (per-state map, hide list) validates against the showreel schema', { timeout: 180000 }, () => {
  const template = JSON.parse(readFileSync(join(ROOT, 'templates/showreel/template.json'), 'utf8'));
  const example = JSON.parse(readFileSync(join(ROOT, 'projects/example-showreel/project.json'), 'utf8'));
  const capture_ = { states: ['default'], viewport: { w: 800, h: 600, dpr: 1 }, fullPage: false,
    selectors: { late: '#late', badge: '.badge', pass: '#pass', target: '#target' },
    waitFor: { default: '#late' }, waitTimeout: 20000, warm: true, scroll: { default: '#target' }, scrollOffset: 50, hide: ['.badge'] };
  const project = { ...example, content: { ...example.content, locale: 'de-DE', capture: capture_ } };
  assert.deepEqual(resolveProject(project, template, '16x9').errors, []);
  fresh(project);
  const r = capture('--no-crops');
  assert.equal(r.status, 0, r.stderr);
  const s = screen();
  assert.deepEqual(s.rects.target.slice(0, 2), [0, 50]);
  assert.equal(s.rects.badge, undefined);
  assert.ok(s.scroll && s.scroll.y > 2000);
  assert.equal(s.crops, undefined, 'a flag still wins over the recipe');
});

test('fails closed: an element that never shows, a scroll target that is missing, an unknown state, bad CSS', { timeout: 180000 }, () => {
  fresh();
  const never = capture(...BASE, '--wait-for', '#never', '--wait-timeout', '1000');
  assert.equal(never.status, 1);
  assert.match(never.stderr, /--wait-for "#never" did not become visible within 1000 ms/);
  const nowhere = capture(...BASE, '--scroll', '#nope');
  assert.equal(nowhere.status, 1);
  assert.match(nowhere.stderr, /--scroll "#nope" matched no element/);
  const typo = capture(...BASE, '--scroll', 'home=#target');
  assert.equal(typo.status, 1);
  assert.match(typo.stderr, /names state "home", which is not captured/);
  const bad = capture(...BASE, '--hide', 'div[');
  assert.equal(bad.status, 1);
  assert.match(bad.stderr, /--hide "div\[" is not a valid CSS selector/);
  const inject = capture(...BASE, '--hide', 'a{color:red}');
  assert.equal(inject.status, 1);
  assert.match(inject.stderr, /want a CSS selector/);
});
