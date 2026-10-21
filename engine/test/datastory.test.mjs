// data-story hero spine: a decline lays out cleanly in every format, and a change too small to draw stops at boot
// with a message naming the limit instead of a list of layout errors. About 25 s.
import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync, rmSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { uniq } from './_names.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const DOWN = uniq('_zz-ds-down'), SMALL = uniq('_zz-ds-small');
const run = (cmd, ...args) => spawnSync('node', [join(ROOT, 'engine', 'cli', `${cmd}.mjs`), ...args], { cwd: ROOT, encoding: 'utf8', timeout: 240000 });
after(() => { for (const n of [DOWN, SMALL]) rmSync(join(ROOT, 'projects', n), { recursive: true, force: true }); });

function scaffold(name, value) {
  rmSync(join(ROOT, 'projects', name), { recursive: true, force: true });
  const r = run('new', '--template', 'data-story', '--name', name);
  assert.equal(r.status, 0, r.stderr);
  const pj = join(ROOT, 'projects', name, 'project.json'), p = JSON.parse(readFileSync(pj, 'utf8'));
  p.content.hero.value = value;
  writeFileSync(pj, JSON.stringify(p, null, 2));
  return p.content.hero.from;
}

test('data-story: a decline (1.6M -> 1.1M) passes lint in all four formats', () => {
  const from = scaffold(DOWN, 1100000);
  assert.ok(from > 1100000, 'the template example must start above the decline value');
  const r = run('lint', `projects/${DOWN}`);
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.match(r.stdout, /\(0 errors, 0 warnings/);
});

test('data-story: a change too small for the spine names the limit and the way out', () => {
  scaffold(SMALL, 1500000);
  const r = run('lint', `projects/${SMALL}`);
  assert.equal(r.status, 1);
  assert.match(r.stdout + r.stderr, /content\.hero: 1\.6M -> 1\.5M \(-6%\) is too small a change to draw as a spine/);
  assert.match(r.stdout + r.stderr, /"counter" point/);
  assert.doesNotMatch(r.stdout + r.stderr, /leaves the safe area/);
});
