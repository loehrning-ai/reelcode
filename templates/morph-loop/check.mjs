// check.mjs: morph-loop scale / emptiness / poster / sound-arc check (local stand-in until engine/cli/lint.mjs has
// these rules). node templates/morph-loop/check.mjs projects/<name> [--format 9x16,1x1,4x5,16x9]
// Fails when
//   - scale: any UI text logged at rest on a beat is smaller than MIN_UI of the frame (9:16: 3% of the frame height;
//     4:5 / 1:1 / 16:9: 4.4% of the short side, i.e. an x-height of about 2.3%). Lint's text QA checks contrast,
//     safe area and overlap, not scale: a 50 px pill in a 1920 px frame passed it;
//   - empty frame: on any quarter beat less than MIN_INK of the frame differs from the background (a lone dot + cursor
//     handoff reads as a dead frame);
//   - poster: the page warns that the poster lands on a loader / success / change (scene.js poster guard);
//   - sound arc: the mix's loudness range (audio/audio.json, ebur128 LRA) is outside LRA_LO..LRA_HI LU (a flat bed).
import { readFileSync, existsSync } from 'node:fs';
import { join, basename } from 'node:path';
import { startServer } from '../../engine/cli/lib/server.mjs';
import { openPage, closeShared } from '../../engine/cli/lib/browser.mjs';

const args = process.argv.slice(2);
const dir = args.find((a, i) => !a.startsWith('--') && !(i > 0 && args[i - 1].startsWith('--')));
if (!dir) { console.error('usage: node templates/morph-loop/check.mjs projects/<name> [--format 9x16,1x1,4x5,16x9]'); process.exit(2); }
const fi = args.indexOf('--format');
const formats = fi >= 0 ? args[fi + 1].split(',') : ['9x16', '1x1', '4x5', '16x9'];
const MIN_UI = { v916: 0.03, other: 0.044 }, MIN_INK = 0.05, LRA_LO = 4, LRA_HI = 6;

function probe([t, bg]) {
  const fx = window.__reelcode;
  fx.seek(t);
  const texts = fx.report().texts.map((x) => ({ s: x.s, size: x.size, role: x.role }));
  const c = document.getElementById('c'), d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
  let ink = 0, n = 0;
  for (let i = 0; i < d.length; i += 16) { n++; if (Math.abs(d[i] - bg[0]) + Math.abs(d[i + 1] - bg[1]) + Math.abs(d[i + 2] - bg[2]) > 24) ink++; }
  return { texts, ink: ink / n };
}

let fails = 0;
const fail = (m) => { fails++; console.log(`FAIL ${m}`); };
const audioJson = join(dir, 'audio', 'audio.json');
if (existsSync(audioJson)) {
  const lra = JSON.parse(readFileSync(audioJson, 'utf8')).mix?.LRA;
  if (!(lra >= LRA_LO && lra <= LRA_HI)) fail(`sound: mix LRA ${lra} LU outside ${LRA_LO}-${LRA_HI} (flat bed, no arc)`);
  else console.log(`ok   sound: mix LRA ${lra} LU`);
}
// ink is measured against the brand background (a full-bleed accent frame is full, not empty)
const hex = JSON.parse(readFileSync(join(dir, 'project.json'), 'utf8')).brand?.colors?.bg || '#000000';
const BG = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
const srv = await startServer();
try {
  for (const format of formats) {
    const s = await openPage({ base: srv.base, project: basename(dir), format, quiet: true });
    const info = await s.page.evaluate(() => ({ W: window.__reelcode.W, H: window.__reelcode.H, warnings: window.__reelcode.warnings.slice(), tl: window.__reelcode.timeline() }));
    const min = (format === '9x16' ? MIN_UI.v916 * info.H : MIN_UI.other * Math.min(info.W, info.H));
    for (const w of info.warnings) if (/poster/.test(w)) fail(`${format} ${w}`);
    const spb = 60 / info.tl.bpm, small = new Map();
    let emptiest = { ink: 1, t: 0 }, smallest = { size: Infinity, s: '' }, seen = 0;
    for (let q = 0; q < info.tl.totalBeats * 4; q++) {
      const t = (q * spb) / 4, r = await s.page.evaluate(probe, [t, BG]);
      if (r.ink < emptiest.ink) emptiest = { ink: r.ink, t };
      if (r.ink < MIN_INK) fail(`${format} t=${t.toFixed(2)}s empty frame: ${(r.ink * 100).toFixed(1)}% ink`);
      if (q % 4 === 0) for (const x of r.texts) {
        if (x.role !== 'ui') continue;
        seen++; if (x.size < smallest.size) smallest = x;
        if (x.size < min - 0.5 && !small.has(x.s)) small.set(x.s, { t, size: x.size });
      }
    }
    for (const [str, v] of small) fail(`${format} t=${v.t.toFixed(2)}s "${str}" ${v.size.toFixed(0)}px < ${min.toFixed(0)}px`);
    console.log(`${small.size ? 'FAIL' : 'ok  '} ${format} min UI ${min.toFixed(0)}px (smallest of ${seen}: "${smallest.s}" ${smallest.size.toFixed(0)}px); emptiest frame ${(emptiest.ink * 100).toFixed(1)}% ink at ${emptiest.t.toFixed(2)}s`);
    await s.close();
  }
} finally { await closeShared(); await srv.close(); }
process.exit(fails ? 1 : 0);
