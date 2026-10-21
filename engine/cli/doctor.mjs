// doctor.mjs: is this machine ready to make films? One line per check, a fix for every failure.
// Exit 0 when every required check passes (optional ones only warn).
//
// npx reelcode doctor [--json] [--skip-browser]
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseArgs, runCli } from './lib/args.mjs';
import { STUDIO_ROOT, startServer } from './lib/server.mjs';
import { pythonPath } from './lib/pipeline.mjs';
import { sh, which, versionOf, atLeast, pinnedPython, installHint, MIN_NODE, MIN_PYTHON, color } from './lib/sys.mjs';

const USAGE = 'npx reelcode doctor [--json] [--skip-browser]';
const SPEC = { json: { type: 'boolean', default: false }, 'skip-browser': { type: 'boolean', default: false } };
const FFMPEG_NEEDS = { filters: ['tmix', 'ebur128', 'loudnorm', 'scale', 'overlay'], encoders: ['libx264', 'aac'] };
const FFMPEG_NICE = { encoders: ['libvpx-vp9', 'prores_ks', 'libopus'] };

const checks = [];
const add = (name, ok, detail, fix, { optional = false } = {}) => checks.push({ name, ok: !!ok, optional, detail, fix: ok ? undefined : fix });

function node() {
  const v = versionOf(process.versions.node);
  add('node', atLeast(v, MIN_NODE), `v${process.versions.node}`, `install node ${MIN_NODE[0]} or newer (https://nodejs.org)`);
  add('npm install', existsSync(join(STUDIO_ROOT, 'node_modules', 'playwright', 'package.json')), 'node_modules/playwright',
    'run "npm install" in the repository');
}

function ffmpeg() {
  for (const tool of ['ffmpeg', 'ffprobe']) {
    const r = sh(tool, ['-hide_banner', '-version']);
    const ver = r.ok ? (r.out.match(/version\s+(\S+)/) || [])[1] : null;
    add(tool, r.ok, ver ? `version ${ver}` : 'not found', installHint('ffmpeg'));
  }
  const filters = sh('ffmpeg', ['-hide_banner', '-filters']), encoders = sh('ffmpeg', ['-hide_banner', '-encoders']);
  if (!filters.ok || !encoders.ok) return;
  const has = (txt, n) => new RegExp(`\\s${n}\\s`).test(txt);
  const missF = FFMPEG_NEEDS.filters.filter((n) => !has(filters.out, n));
  const missE = FFMPEG_NEEDS.encoders.filter((n) => !has(encoders.out, n));
  add('ffmpeg features', !missF.length && !missE.length, missF.length || missE.length ? `missing ${[...missF, ...missE].join(', ')}` : `${[...FFMPEG_NEEDS.filters, ...FFMPEG_NEEDS.encoders].join(', ')}`,
    'install a full ffmpeg build (the distro package or https://ffmpeg.org/download.html)');
  const nice = FFMPEG_NICE.encoders.filter((n) => !has(encoders.out, n));
  add('ffmpeg extras', !nice.length, nice.length ? `missing ${nice.join(', ')} (webm / prores / opus exports)` : FFMPEG_NICE.encoders.join(', '),
    'only needed for webm, prores-alpha or opus exports; a full ffmpeg build has them', { optional: true });
}

function python() {
  const py = pythonPath();
  const rel = py.replace(STUDIO_ROOT + '/', '');
  if (!existsSync(py)) { add('python venv', false, `${rel} missing`, 'run "npx reelcode setup"'); return; }
  const v = sh(py, ['-I', '-c', 'import sys; print("%d.%d.%d" % sys.version_info[:3])']);
  add('python venv', v.ok && atLeast(versionOf(v.out), MIN_PYTHON), v.ok ? `${rel} (${v.out.trim()})` : v.err.trim().split('\n').pop(),
    `the venv needs Python ${MIN_PYTHON.join('.')}+; run "npx reelcode setup --force"`);
  const pins = pinnedPython();
  const code = `import importlib.metadata as m, json\nout = {}\nfor n in ${JSON.stringify(pins.map(([n]) => n))}:\n    try: out[n] = m.version(n)\n    except Exception: out[n] = None\nprint(json.dumps(out))`;
  const r = sh(py, ['-I', '-c', code]);
  let got = {};
  try { got = JSON.parse(r.out.trim().split('\n').pop()); } catch { /* reported below */ }
  const wrong = pins.filter(([n, want]) => got[n] !== want).map(([n, want]) => `${n} ${got[n] || 'missing'} (want ${want})`);
  add('python deps', r.ok && !wrong.length, wrong.length ? wrong.join(', ') : pins.map(([n, v]) => `${n} ${v}`).join(', '),
    'run "npx reelcode setup --force" to rebuild the venv from requirements.txt');
  const imp = sh(py, ['-I', '-c', 'import numpy, scipy, librosa, soundfile; soundfile.available_formats()["FLAC"]']);
  add('python imports', imp.ok, imp.ok ? 'numpy, scipy, librosa, soundfile (FLAC)' : imp.err.trim().split('\n').pop(),
    'run "npx reelcode setup --force"');
}

async function fontsAndBrowser(skip) {
  const manifest = JSON.parse(readFileSync(join(STUDIO_ROOT, 'engine', 'fonts', 'fonts.json'), 'utf8'));
  const families = Object.keys(manifest.families);
  const missing = Object.entries(manifest.licenses).flatMap(([file, lic]) =>
    [join('engine', 'fonts', file), lic].filter((f) => !existsSync(join(STUDIO_ROOT, f))));
  add('bundled fonts', !missing.length, missing.length ? `missing ${missing.join(', ')}` : `${families.length} families, licences in LICENSES/`,
    'restore engine/fonts/ and LICENSES/ from git (git checkout -- engine/fonts LICENSES)');
  if (skip) return;
  let chromium;
  try { ({ chromium } = await import('playwright')); } catch { add('chromium', false, 'playwright not installed', 'run "npm install"'); return; }
  let browser;
  try { browser = await chromium.launch(); } catch (e) {
    add('chromium', false, e.message.split('\n')[0],
      process.platform === 'linux' ? 'run "npx reelcode setup --with-deps" (or: npx playwright install --with-deps chromium)' : 'run "npx reelcode setup"');
    return;
  }
  add('chromium', true, `${browser.version()}`);
  const srv = await startServer();
  try {
    const page = await browser.newPage();
    await page.goto(`${srv.base}/engine/fonts/fonts.json`);
    const res = await page.evaluate(async (families) => {
      const link = Object.assign(document.createElement('link'), { rel: 'stylesheet', href: '/engine/fonts/fonts.css' });
      await new Promise((ok) => { link.onload = ok; link.onerror = ok; document.head.appendChild(link); });
      const out = {};
      for (const f of families) {
        try { await document.fonts.load(`600 48px "${f}"`); } catch { /* reported as false */ }
        out[f] = document.fonts.check(`600 48px "${f}"`) && [...document.fonts].some((ff) => ff.family.replace(/"/g, '') === f && ff.status === 'loaded');
      }
      return out;
    }, families);
    const bad = Object.entries(res).filter(([, ok]) => !ok).map(([f]) => f);
    add('fonts load in chromium', !bad.length, bad.length ? `not loading: ${bad.join(', ')}` : families.join(', '),
      'check engine/fonts/fonts.css and that the .woff2 files are intact (git checkout -- engine/fonts)');
  } finally { await srv.close(); await browser.close(); }
}

function optionalVoice() {
  const say = process.platform === 'darwin' && which('say');
  add('voice: say', !!say, say ? 'available (macOS only; Apple licence: drafts, not published audio)' : 'not available (macOS only)',
    'use the "file" engine with your own recording, or "elevenlabs"', { optional: true });
  add('voice: elevenlabs', !!process.env.ELEVENLABS_API_KEY, process.env.ELEVENLABS_API_KEY ? 'ELEVENLABS_API_KEY is set' : 'ELEVENLABS_API_KEY not set',
    'only needed for voiceover.engine "elevenlabs"', { optional: true });
}

runCli(USAGE, async () => {
  const a = parseArgs(process.argv.slice(2), SPEC, { positionals: [0, 0] });
  node(); ffmpeg(); python();
  await fontsAndBrowser(a['skip-browser']);
  optionalVoice();
  const failed = checks.filter((c) => !c.ok && !c.optional);
  if (a.json) { console.log(JSON.stringify({ ok: !failed.length, checks }, null, 2)); return failed.length ? 1 : 0; }
  const w = Math.max(...checks.map((c) => c.name.length));
  for (const c of checks) {
    const mark = c.ok ? color.ok('ok  ') : c.optional ? color.warn('opt ') : color.bad('FAIL');
    console.log(`${mark} ${c.name.padEnd(w)}  ${color.dim(c.detail || '')}`);
    if (c.fix) console.log(`     ${' '.repeat(w)}  fix: ${c.fix}`);
  }
  console.log(failed.length ? `\n${color.bad(`${failed.length} problem(s).`)} Fix them and run "npx reelcode doctor" again.` : `\n${color.ok('ready.')}`);
  return failed.length ? 1 : 0;
});
