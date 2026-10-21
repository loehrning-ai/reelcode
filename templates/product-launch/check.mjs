// check.mjs: product-launch seam + captured-UI readability check (local stand-in until engine/cli/lint.mjs has
// these rules). node templates/product-launch/check.mjs projects/<name> [--format 9x16,1x1,4x5,16x9]
// Fails when
//   - seam: at any scene boundary the frame 1/30 s before, the boundary frame and the frame 1/30 s after are not
//     all different (a transition that starts after the cut leaves the boundary frozen under its whoosh);
//   - glyph: a feature tour stop (captured UI held >= 1 beat) renders its smallest text line below 2.2% of the
//     short side (reported with the effective height on a 390 px wide phone);
//   - crop: a tour stop's lens has a glyph, icon or border crossing its edge (text cut by the crop);
//   - ending: the frame on the last beat changes < 10% against half a beat before it (the lockup must complete ON
//     the final beat, not settle early and hold).
import { startServer } from '../../engine/cli/lib/server.mjs';
import { openPage, closeShared } from '../../engine/cli/lib/browser.mjs';
import { basename } from 'node:path';

const args = process.argv.slice(2);
const dir = args.find((a, i) => !a.startsWith('--') && !(i > 0 && args[i - 1].startsWith('--')));
if (!dir) { console.error('usage: node templates/product-launch/check.mjs projects/<name> [--format 9x16,1x1,4x5,16x9]'); process.exit(2); }
const fi = args.indexOf('--format');
const formats = fi >= 0 ? args[fi + 1].split(',') : ['9x16', '1x1', '4x5', '16x9'];
const FPS = 30, LAND = 0.1;

/** In page: seek, return a hash and the RGB bytes (subsampled) for diffs. */
const grab = (t) => {
  window.__reelcode.seek(t);
  const c = document.getElementById('c'), x = c.getContext('2d');
  const { data, width, height } = x.getImageData(0, 0, c.width, c.height);
  const px = [];
  let h = 0x811c9dc5;
  for (let y = 0; y < height; y += 4) for (let i = y * width * 4, e = i + width * 4; i < e; i += 16) {
    px.push(data[i], data[i + 1], data[i + 2]);
    h = Math.imul(h ^ (data[i] + data[i + 1] * 3 + data[i + 2] * 7), 0x01000193);
  }
  return { h: h >>> 0, px };
};
const changed = (a, b) => {
  let n = 0;
  for (let i = 0; i < a.px.length; i += 3) if (Math.abs(a.px[i] - b.px[i]) + Math.abs(a.px[i + 1] - b.px[i + 1]) + Math.abs(a.px[i + 2] - b.px[i + 2]) > 30) n++;
  return n / (a.px.length / 3);
};

const srv = await startServer();
let fails = 0;
const report = (ok, msg) => { if (!ok) fails++; console.log(`${ok ? 'ok  ' : 'FAIL'} ${msg}`); };
try {
  for (const format of formats) {
    const s = await openPage({ base: srv.base, project: basename(dir), format, quiet: true });
    const spb = 60 / s.info.bpm, dur = s.info.duration ?? s.info.scenes[s.info.scenes.length - 1].end;
    for (const sc of s.info.scenes.slice(1)) {
      const b = sc.start;
      const [a, m, z] = [await s.page.evaluate(grab, b - 1 / FPS), await s.page.evaluate(grab, b), await s.page.evaluate(grab, b + 1 / FPS)];
      const frozen = a.h === m.h || m.h === z.h;
      report(!frozen, `${format} seam  ${sc.id.padEnd(10)} t=${b.toFixed(2)}s  diff(b-1,b)=${(changed(a, m) * 100).toFixed(1)}% diff(b,b+1)=${(changed(m, z) * 100).toFixed(1)}%${frozen ? '  <- frozen boundary frame' : ''}`);
    }
    const qa = await s.page.evaluate(() => globalThis.__productLaunchQA || null);
    const W = s.W, short = Math.min(s.W, s.H);
    for (const ft of (qa && qa.features) || []) {
      ft.stops.forEach((st, j) => {
        const phone = st.glyphPx ? (st.glyphPx * 390) / W : null;
        if (st.run === null) { console.log(`warn ${format} glyph feature${ft.feature} stop ${j + 1}: no text line measured`); return; }
        report(st.glyphPx >= ft.need, `${format} glyph feature${ft.feature} stop ${j + 1}: k=${st.k} line ${st.run}px -> ${st.glyphPx}px (${((st.glyphPx / short) * 100).toFixed(1)}% of short side, ${phone.toFixed(1)}px on a 390px phone; need ${ft.need}px)`);
        report(st.clean, `${format} crop  feature${ft.feature} stop ${j + 1}: lens edges ${st.clean ? 'clear' : 'cross a glyph/border'}`);
      });
    }
    const tl = dur - spb, last = await s.page.evaluate(grab, tl), before = await s.page.evaluate(grab, tl - spb / 2);
    const ch = changed(before, last);
    report(ch >= LAND, `${format} ending: the last beat (t=${tl.toFixed(2)}s) changes ${(ch * 100).toFixed(1)}% of the frame (need ${LAND * 100}%)`);
    await s.close();
  }
} finally { await closeShared(); await srv.close(); }
process.exit(fails ? 1 : 0);
