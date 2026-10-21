// CLI test for the engine commands (render, stills, lint) on a per-process copy of projects/_smoke. About 60 s.
import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync, execFileSync } from 'node:child_process';
import { readFileSync, mkdirSync, writeFileSync, rmSync, existsSync, cpSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { uniq } from './_names.mjs';
import { ensureAudio } from './_prepare.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const run = (cmd, ...args) => spawnSync('node', [join(ROOT, 'engine', 'cli', `${cmd}.mjs`), ...args], { cwd: ROOT, encoding: 'utf8', timeout: 240000 });
const pngSize = (f) => { const b = readFileSync(f); return [b.readUInt32BE(16), b.readUInt32BE(20)]; };
const NEG = uniq('_lintneg'), NEG_T = join(ROOT, 'templates', NEG), NEG_P = join(ROOT, 'projects', NEG);
// a private copy of projects/_smoke (project.json + its audio), so concurrent runs never share out/ folders
const SMOKE = uniq('_smoke-cli'), SDIR = join(ROOT, 'projects', SMOKE), SP = `projects/${SMOKE}`;
ensureAudio('_smoke');
rmSync(SDIR, { recursive: true, force: true });
mkdirSync(SDIR, { recursive: true });
cpSync(join(ROOT, 'projects/_smoke/project.json'), join(SDIR, 'project.json'));
cpSync(join(ROOT, 'projects/_smoke/audio'), join(SDIR, 'audio'), { recursive: true });
after(() => { for (const d of [NEG_T, NEG_P, SDIR]) rmSync(d, { recursive: true, force: true }); });

test('bad flags print usage and exit 1', () => {
  const r = run('stills', SP, '--bogus');
  assert.equal(r.status, 1); assert.match(r.stderr, /unknown flag --bogus[\s\S]*usage:/);
  assert.equal(run('render').status, 1);
  assert.match(run('lint', 'projects/does-not-exist').stderr, /project.json not found/);
});

test('--help and -h print usage to stdout and exit 0 for every subcommand, before any side effect', () => {
  const bin = join(ROOT, 'bin', 'reelcode.mjs');
  const cmds = ['setup', 'doctor', 'new', 'templates', 'make', 'render', 'lint', 'stills', 'capture', 'preview', 'test'];
  for (const cmd of cmds) {
    for (const flag of ['--help', '-h']) {
      const r = spawnSync('node', [bin, cmd, 'q3-numbers', flag], { cwd: ROOT, encoding: 'utf8', timeout: 30000 });
      assert.equal(r.status, 0, `${cmd} ${flag}: ${r.stderr}`);
      assert.match(r.stdout, /usage: npx reelcode /, `${cmd} ${flag}`);
      assert.doesNotMatch(r.stderr, /error/, `${cmd} ${flag}`);
    }
  }
});

test('stills: contact sheet dimensions equal cols*tileW x rows*tileH in every format', () => {
  const r = run('stills', SP, '--format', 'all', '--sheet', 'contact,seam');
  assert.equal(r.status, 0, r.stderr);
  const tiles = { '9x16': [270, 480, 24], '1x1': [270, 270, 24], '16x9': [360, 203, 24] };
  for (const [fmt, [w, h, n]] of Object.entries(tiles)) {
    assert.deepEqual(pngSize(join(SDIR, 'out', fmt, 'contact.png')), [6 * w, Math.ceil(n / 6) * h]);
    assert.deepEqual(pngSize(join(SDIR, 'out', fmt, 'seam.png')), [4 * w, 4 * h]);
  }
  assert.ok(!existsSync(join(SDIR, 'out/9x16/_frames')), 'frames folder removed');
});

test('lint passes with determinism (out-of-order, interleaved, fresh page)', () => {
  const r = run('lint', SP);
  assert.equal(r.status, 0, r.stdout + r.stderr);
  const j = JSON.parse(readFileSync(join(SDIR, 'out/lint.json'), 'utf8'));
  assert.deepEqual(j.errors, []);
  assert.ok(j.info.hashes > 10);
});

test('render: draft 1x1 has duration*30 frames', () => {
  const r = run('render', SP, '--formats', '1x1', '--quiet');
  assert.equal(r.status, 0, r.stderr);
  const out = execFileSync('ffprobe', ['-v', 'error', '-count_frames', '-show_entries', 'stream=nb_read_frames,width,height', '-of', 'csv=p=0',
    join(SDIR, 'out/1x1/draft_silent.mp4')], { encoding: 'utf8' }).trim();
  assert.equal(out, '1080,1080,360');
});

test('negative: a template that uses Math.random fails lint (static + runtime guard)', () => {
  mkdirSync(NEG_T, { recursive: true }); mkdirSync(NEG_P, { recursive: true });
  const t = JSON.parse(readFileSync(join(ROOT, 'templates/_smoke/template.json'), 'utf8'));
  writeFileSync(join(NEG_T, 'template.json'), JSON.stringify({ ...t, id: NEG, content_schema: { type: 'object' } }));
  writeFileSync(join(NEG_T, 'scene.js'), `export default { id: '${NEG}', build(api) {
    return { scenes: [{ id: 'a', beats: 'fill', events: [2, 4, 6, 8, 10, 12, 14, 16, 18, 20], draw(f) { f.ctx.fillStyle = f.theme.colors.fg; f.ctx.fillRect(Math.random() * 10, 0, 10, 10); } }] };
  } };\n`);
  writeFileSync(join(NEG_P, 'project.json'), JSON.stringify({ template: NEG, ...t.example, formats: ['1x1'] }));
  const r = run('lint', `projects/${NEG}`, '--fast');
  assert.equal(r.status, 1);
  assert.match(r.stdout, new RegExp(`static templates/${NEG}/scene.js:2: Math.random is banned`));
  assert.match(r.stdout, /determinism: Math.random is banned in render mode/);
});
