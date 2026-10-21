// check.mjs: data-story seam, hand-off, composition and score gates (a template-local gate until engine/cli/lint.mjs
// grows template rules). node templates/data-story/check.mjs projects/<name> [--format 9x16,1x1,4x5,16x9] [--no-audio]
// Per format and scene it fails when
//   - composition: the resting frame's ink bbox covers under 70% of the safe height or under 60% of the safe width;
//   - hand-off occlusion: a carried hand-off shape (logged as a 'handoff' mark) covers more than 20% of a text box
//     on more than 2 frames of the cut window;
//   - empty open: the frame at cut + 0.25 s has under 40% of the resting frame's ink (a scene that opens on empty axes);
//   - a cut that lands on a still (the frame before the cut equals the one a quarter beat earlier).
// Once per project (needs make's audio/audio.json + mix.wav):
//   - the mix loudness range is under 4 LU (a flat bed with no sections);
//   - the loudest 0.5 s window does not start within ±1 beat of the final lockup (the film's last beat).
import { startServer } from '../../engine/cli/lib/server.mjs';
import { openPage, closeShared } from '../../engine/cli/lib/browser.mjs';
import { FORMATS } from '../../engine/layout.js';
import { basename, join, resolve } from 'node:path';
import { readFileSync, existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';

const args = process.argv.slice(2);
const dir = args.find((a) => !a.startsWith('--') && !/^[\dx,]+$/.test(a));
if (!dir) { console.error('usage: node templates/data-story/check.mjs projects/<name> [--format 9x16,1x1,16x9] [--no-audio]'); process.exit(2); }
const fi = args.indexOf('--format');
const formats = fi >= 0 ? args[fi + 1].split(',') : ['9x16', '1x1', '4x5', '16x9'];
const MIN_H = 0.7, MIN_W = 0.6, OCC = 0.2, OCC_FRAMES = 2, OPEN_INK = 0.4, MIN_LRA = 4;

const measure = (t) => {
  window.__reelcode.seek(t);
  const c = document.getElementById('c'), x = c.getContext('2d');
  const { data, width, height } = x.getImageData(0, 0, c.width, c.height);
  const bg = [data[0], data[1], data[2]];
  let ink = 0, y0 = height, y1 = -1, x0 = width, x1 = -1, hash = 0;
  for (let y = 0; y < height; y += 2) for (let i = y * width * 4, e = i + width * 4; i < e; i += 8) {
    hash = (hash * 31 + data[i] + data[i + 1] * 7 + data[i + 2] * 13) | 0;
    if (Math.abs(data[i] - bg[0]) + Math.abs(data[i + 1] - bg[1]) + Math.abs(data[i + 2] - bg[2]) > 24) {
      ink++; const px = ((i - y * width * 4) / 4) | 0;
      if (y < y0) y0 = y; if (y > y1) y1 = y; if (px < x0) x0 = px; if (px > x1) x1 = px;
    }
  }
  return { ink, y0, y1, x0, x1, hash };
};
// hand-off boxes vs text boxes at time t: the number of texts covered by more than `occ` of their area
const occlusion = ({ t, occ }) => {
  window.__reelcode.seek(t);
  const rep = window.__reelcode.report() || {};
  const hands = (rep.media || []).filter((m) => m.kind === 'handoff').map((m) => m.box);
  const hits = [];
  for (const tx of rep.texts || []) {
    const b = tx.box, area = Math.max(1, b.w * b.h);
    for (const h of hands) {
      const ix = Math.max(0, Math.min(b.x + b.w, h.x + h.w) - Math.max(b.x, h.x)), iy = Math.max(0, Math.min(b.y + b.h, h.y + h.h) - Math.max(b.y, h.y));
      if ((ix * iy) / area > occ) { hits.push(tx.s); break; }
    }
  }
  return hits;
};

let fails = 0;
const srv = await startServer();
try {
  for (const format of formats) {
    const s = await openPage({ base: srv.base, project: basename(dir), format, quiet: true });
    const sp = FORMATS[format].safe, safeH = FORMATS[format].h - sp.t - sp.b, safeW = FORMATS[format].w - sp.l - sp.r;
    const spb = 60 / s.info.bpm;
    for (const sc of s.info.scenes) {
      const t0 = sc.start, t1 = sc.end, last = sc === s.info.scenes[s.info.scenes.length - 1];
      const restT = last ? t1 - 1 / 30 : Math.max(t0, Math.min(t1 - 1 / 30, t1 - spb / 2));
      const rest = await s.page.evaluate(measure, restT);
      const open = await s.page.evaluate(measure, t0 + 0.25);
      const before = t0 > 0 ? await s.page.evaluate(measure, Math.max(0, t0 - 1 / 30)) : null;
      const prior = t0 > 0 ? await s.page.evaluate(measure, Math.max(0, t0 - 1 / 30 - spb / 4)) : null;
      const coverH = rest.y1 > rest.y0 ? (rest.y1 - rest.y0) / safeH : 0, coverW = rest.x1 > rest.x0 ? (rest.x1 - rest.x0) / safeW : 0;
      const openInk = open.ink / Math.max(1, rest.ink);
      let occFrames = 0; const occTexts = new Set();
      if (t0 > 0) for (let k = 0; k <= 18; k++) {
        const hits = await s.page.evaluate(occlusion, { t: t0 + k / 30, occ: OCC });
        if (hits.length) { occFrames++; hits.forEach((h) => occTexts.add(h)); }
      }
      const bad = [];
      if (coverH < MIN_H) bad.push(`resting bbox ${(coverH * 100).toFixed(0)}% of safe height (< ${MIN_H * 100}%)`);
      if (coverW < MIN_W) bad.push(`resting bbox ${(coverW * 100).toFixed(0)}% of safe width (< ${MIN_W * 100}%)`);
      if (t0 > 0 && openInk < OPEN_INK) bad.push(`opens with ${(openInk * 100).toFixed(0)}% of its resting ink at cut+0.25s (< ${OPEN_INK * 100}%)`);
      if (occFrames > OCC_FRAMES) bad.push(`hand-off shape covers text on ${occFrames} frames (${[...occTexts].slice(0, 3).map((x) => JSON.stringify(x)).join(', ')})`);
      if (before && prior && before.hash === prior.hash) bad.push('still frame into the cut');
      fails += bad.length;
      console.log(`${bad.length ? 'FAIL' : 'ok  '} ${format} ${sc.id.padEnd(12)} t=${t0.toFixed(2)}s bbox=${(coverH * 100).toFixed(0)}%h/${(coverW * 100).toFixed(0)}%w open-ink=${(openInk * 100).toFixed(0)}% occl=${occFrames}f${bad.length ? `  <- ${bad.join('; ')}` : ''}`);
    }
    await s.close();
  }
} finally { await closeShared(); await srv.close(); }

if (!args.includes('--no-audio')) {
  const P = resolve(dir), aj = join(P, 'audio', 'audio.json'), tj = join(P, 'out', 'timeline.json');
  if (!existsSync(aj) || !existsSync(tj)) { console.log('FAIL audio: audio/audio.json or out/timeline.json missing; run make first'); fails++; }
  else {
    const a = JSON.parse(readFileSync(aj, 'utf8')), tl = JSON.parse(readFileSync(tj, 'utf8'));
    const spb = 60 / tl.bpm, lockup = tl.duration - spb;
    const lra = a.mix && a.mix.LRA;
    const lraOk = typeof lra === 'number' && lra >= MIN_LRA;
    if (!lraOk) fails++;
    console.log(`${lraOk ? 'ok  ' : 'FAIL'} audio mix LRA ${lra} LU (>= ${MIN_LRA})`);
    // loudest 0.5 s window (RMS of the mono mix, 50 ms hop)
    const mix = join(P, a.mix.file.replace(/^projects\/[^/]+\//, ''));
    const r = spawnSync('ffmpeg', ['-v', 'error', '-i', mix, '-ac', '1', '-ar', '8000', '-f', 'f32le', '-'], { maxBuffer: 1 << 28 });
    if (r.status !== 0) { console.log(`FAIL audio: ffmpeg could not decode ${mix}`); fails++; }
    else {
      const x = new Float32Array(r.stdout.buffer, r.stdout.byteOffset, r.stdout.byteLength / 4), sr = 8000, win = sr / 2, hop = sr / 20;
      let best = -1, bestT = 0;
      for (let i = 0; i + win <= x.length; i += hop) { let e = 0; for (let j = i; j < i + win; j++) e += x[j] * x[j]; if (e > best) { best = e; bestT = i / sr; } }
      const ok = Math.abs(bestT - lockup) <= spb + 1e-6;
      if (!ok) fails++;
      console.log(`${ok ? 'ok  ' : 'FAIL'} audio loudest 0.5 s window at ${bestT.toFixed(2)} s (final lockup ${lockup.toFixed(2)} s ± ${spb.toFixed(2)})`);
    }
  }
}
process.exit(fails ? 1 : 0);
