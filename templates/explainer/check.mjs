// check.mjs: explainer composition check (local stand-in until engine/cli/lint.mjs has a composition rule).
// node templates/explainer/check.mjs projects/<name> [--format 9x16,1x1,4x5,16x9]
// Samples one frame per beat (the contact-sheet grid). Content = pixels that differ from the brand bg (a full-bleed
// dark frame counts as content). Fails when the vertical span of the content covers under 70% of the safe-area height
// for more than one beat in a row, or when the content stops short of the lowest 20% of the safe area for more than
// one beat in a row (the dead lower band of a landscape card stacked in a tall frame: a rail at the top can make the
// span pass while the bottom of the frame is empty). Prints the low beats so a regression points at its beat.
import { startServer } from '../../engine/cli/lib/server.mjs';
import { openPage, closeShared } from '../../engine/cli/lib/browser.mjs';
import { FORMATS } from '../../engine/layout.js';
import { readFileSync } from 'node:fs';
import { basename, join } from 'node:path';

const MIN = 0.7, REACH = 0.8, RUN = 1;
const args = process.argv.slice(2);
const dir = args.find((a) => !a.startsWith('--'));
if (!dir) { console.error('usage: node templates/explainer/check.mjs projects/<name> [--format 9x16,1x1,4x5,16x9]'); process.exit(2); }
const fi = args.indexOf('--format');
const formats = fi >= 0 ? args[fi + 1].split(',') : ['9x16', '1x1', '4x5', '16x9'];
const hex = JSON.parse(readFileSync(join(dir, 'project.json'), 'utf8')).brand?.colors?.bg || '#FFFFFF';
const bg = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));

const measure = ([t, bg, top, bottom]) => {
  window.__reelcode.seek(t);
  const c = document.getElementById('c'), x = c.getContext('2d');
  const { data, width } = x.getImageData(0, 0, c.width, c.height);
  let y0 = -1, y1 = -1;
  for (let y = top; y < bottom; y += 2) {
    let n = 0;
    for (let i = y * width * 4, e = i + width * 4; i < e; i += 8) {
      if (Math.abs(data[i] - bg[0]) + Math.abs(data[i + 1] - bg[1]) + Math.abs(data[i + 2] - bg[2]) > 24) n++;
    }
    if (n >= 3) { if (y0 < 0) y0 = y; y1 = y; }
  }
  return { y0, y1 };
};

const srv = await startServer();
let fails = 0;
try {
  for (const format of formats) {
    const s = await openPage({ base: srv.base, project: basename(dir), format, quiet: true });
    const Fm = FORMATS[format], top = Fm.safe.t, bottom = Fm.h - Fm.safe.b, safeH = bottom - top;
    const spb = 60 / s.info.bpm, beats = Math.round(s.info.duration / spb);
    let run = 0, runR = 0, worst = 1;
    const low = [], short = [];
    for (let b = 0; b < beats; b++) {
      const r = await s.page.evaluate(measure, [b * spb, bg, top, bottom]);
      const cover = r.y1 > r.y0 ? (r.y1 - r.y0) / safeH : 0;
      worst = Math.min(worst, cover);
      run = cover < MIN ? run + 1 : 0;
      if (cover < MIN) low.push(`b${b}:${(cover * 100).toFixed(0)}%`);
      const reach = r.y1 >= 0 ? (r.y1 - top) / safeH : 0;
      runR = reach < REACH ? runR + 1 : 0;
      if (reach < REACH) short.push(`b${b}:${(reach * 100).toFixed(0)}%`);
      if (runR === RUN + 1) { fails++; console.log(`FAIL ${format} composition: content stops above ${REACH * 100}% of the safe height for ${RUN + 1}+ beats from b${b - RUN}`); }
      if (run === RUN + 1) { fails++; console.log(`FAIL ${format} composition: content spans < ${MIN * 100}% of the safe height for ${RUN + 1}+ beats from b${b - RUN}`); }
    }
    console.log(`${format}: worst beat ${(worst * 100).toFixed(0)}% of safe height${low.length ? `; low beats ${low.join(' ')}` : ''}${short.length ? `; short beats ${short.join(' ')}` : ''}`);
    await s.close();
  }
} finally { await closeShared(); await srv.close(); }
process.exit(fails ? 1 : 0);
