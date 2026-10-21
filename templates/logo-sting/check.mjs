// check.mjs: logo-sting structure check (local stand-in until engine/cli/lint.mjs has these rules).
// node templates/logo-sting/check.mjs projects/<name> [--format 9x16,1x1] [--variant id] [--cutdown id] [--no-audio]
// Fails when
//   - squash: any fillText is drawn with an anisotropic transform (sx/sy or sy/sx below 0.8) for more than 3
//     consecutive frames (every 30 fps frame, every glyph run, logged or not);
//   - hook: frame 0 has under 15% of its pixels inked (not the brand bg, not transparent);
//   - dead stretch: more than 2 beats pass without a quarter-beat step that changes >= 1.5% of the frame;
//   - ending: the last beat does not change >= 10% of the frame against half a beat before it;
//   - jump cut: a text present on both sides of a scene cut moves more than 5% of the frame or changes size by
//     more than 5% (the lockup must never be re-laid out across a cut);
//   - lockup scale: after the lock the name's cap height changes (> 5%) or is under 0.4x the hook's (the hook band
//     overscans the frame at 1.06-1.12x its width, so 0.8x is not reachable for a lockup that also carries a mark,
//     a tagline and a CTA field; the rule keeps the payoff from being a small afterthought and the size constant);
//   - phone floor: any resting, non-bleed text in the last 2 s has a cap height under 2% of the frame height;
//   - CTA orphan: a CTA of 2+ words breaks onto a line of fewer than two words;
//   - audio (mix.wav of the rendition): the lock's RMS step over the beat before the gap is under 8 dB; any
//     momentary loudness (400 ms) after the lock is under -20 LUFS or more than 6 LU under the post-lock median;
//     the last-beat hit is not >= 2 dB louder (RMS) than the lock hit and not the loudest peak after the lock.
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { startServer } from '../../engine/cli/lib/server.mjs';
import { openPage, closeShared } from '../../engine/cli/lib/browser.mjs';
import { loadProject } from '../../engine/cli/lib/project.mjs';

const args = process.argv.slice(2);
const dir = args.find((a, i) => !a.startsWith('--') && !(i > 0 && ['--format', '--variant', '--cutdown'].includes(args[i - 1])));
if (!dir) { console.error('usage: node templates/logo-sting/check.mjs projects/<name> [--format 9x16,...] [--variant id] [--cutdown id] [--no-audio]'); process.exit(2); }
const opt = (k) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : undefined; };
const P = loadProject(dir, { variant: opt('--variant') || 'main', cutdown: opt('--cutdown') || 'full' });
const formats = opt('--format') ? opt('--format').split(',') : P.formats;
const SQUASH = 0.8, SQUASH_FRAMES = 3, HOOK_INK = 0.15, STEP = 0.015, LAND = 0.1, FPS = 30;
const STILL_Q = 8, JUMP = 0.05, CAP_MIN = 0.4, PHONE = 0.02;
const LOCK_STEP_DB = 8, M_FLOOR = -20, M_DIP = 6, LAST_OVER_DB = 2;

function hexRGB(c) {
  const m = /^#([0-9a-f]{6})/i.exec(String(c || ''));
  return m ? [0, 2, 4].map((k) => parseInt(m[1].slice(k, k + 2), 16)) : [0, 0, 0];
}

/** In page: install the fillText probe once. */
function install() {
  if (window.__sq) return;
  window.__sq = [];
  const orig = CanvasRenderingContext2D.prototype.fillText;
  CanvasRenderingContext2D.prototype.fillText = function (s, ...rest) {
    const m = this.getTransform(), a = Math.hypot(m.a, m.b), d = Math.hypot(m.c, m.d);
    const r = Math.min(a, d) / Math.max(a, d, 1e-9);
    if (r < 0.999) window.__sq.push({ s: String(s), r });
    return orig.call(this, s, ...rest);
  };
}

/** In page: seek t, return squash records, the text log and a coarse frame signature (every 6th pixel). */
function frame({ t, bg, pix = true }) {
  window.__sq.length = 0;
  window.__reelcode.seek(t);
  const texts = window.__reelcode.report().texts.map((e) => ({ s: e.s, box: e.box, bleed: e.bleed, rest: !!e.rest, role: e.role }));
  if (!pix) return { sq: window.__sq.slice(), texts };
  const c = document.getElementById('c'), d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
  const sig = [];
  let ink = 0, n = 0;
  for (let i = 0; i < d.length; i += 4 * 6) {
    const on = d[i + 3] > 8 && Math.abs(d[i] - bg[0]) + Math.abs(d[i + 1] - bg[1]) + Math.abs(d[i + 2] - bg[2]) > 24;
    sig.push(on ? (d[i] >> 4) * 256 + (d[i + 1] >> 4) * 16 + (d[i + 2] >> 4) + 1 : 0);
    ink += on ? 1 : 0; n++;
  }
  return { sq: window.__sq.slice(), texts, sig, ink: ink / n };
}

const changed = (a, b) => { let k = 0; for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) k++; return k / a.length; };
const db = (x) => 20 * Math.log10(Math.max(1e-9, x));

/** mono float samples of a wav (via ffmpeg) */
function readMono(path) {
  const r = spawnSync('ffmpeg', ['-hide_banner', '-v', 'error', '-i', path, '-ac', '1', '-ar', '48000', '-f', 'f32le', '-'], { maxBuffer: 1 << 28 });
  if (r.status !== 0) throw new Error(`ffmpeg could not read ${path}`);
  const b = r.stdout;
  return new Float32Array(b.buffer, b.byteOffset, Math.floor(b.length / 4));
}
const win = (x, t0, len) => x.subarray(Math.max(0, Math.round(t0 * 48000)), Math.min(x.length, Math.round((t0 + len) * 48000)));
const rmsDb = (s) => { let a = 0; for (const v of s) a += v * v; return db(Math.sqrt(a / Math.max(1, s.length))); };
const peakDb = (s) => { let p = 0; for (const v of s) p = Math.max(p, Math.abs(v)); return db(p); };

/** momentary loudness every 100 ms: [{t, M}] (ffmpeg ebur128; t is the end of the 400 ms window) */
function momentary(path) {
  const r = spawnSync('ffmpeg', ['-hide_banner', '-nostats', '-v', 'verbose', '-i', path, '-af', 'ebur128=framelog=verbose', '-f', 'null', '-'], { encoding: 'utf8', maxBuffer: 1 << 26 });
  const out = [];
  for (const line of String(r.stderr).split('\n')) {
    const m = /t:\s*([\d.]+)\s+TARGET.*?M:\s*(-?[\d.]+|-inf)/.exec(line);
    if (m) out.push({ t: Number(m[1]), M: m[2] === '-inf' ? -120 : Number(m[2]) });
  }
  return out;
}

function audioCheck(file, lockT, lastT, dur, spb) {
  const bad = [];
  const x = readMono(file), w = 0.125;
  const pre = Math.max(...[0, 1, 2, 3].map((k) => rmsDb(win(x, lockT - spb * 1.5 + k * w, w))));
  const lockR = rmsDb(win(x, lockT, w)), lockP = peakDb(win(x, lockT, w));
  const lastR = rmsDb(win(x, lastT, w)), lastP = peakDb(win(x, lastT, w));
  const postP = peakDb(win(x, lockT + w, Math.max(0, lastT - lockT - w)));
  if (lockR - pre < LOCK_STEP_DB) bad.push(`audio: the lock steps ${(lockR - pre).toFixed(1)} dB RMS over the beat before the gap (< ${LOCK_STEP_DB})`);
  if (lastR < lockR + LAST_OVER_DB) bad.push(`audio: the last-beat hit is ${(lastR - lockR).toFixed(1)} dB RMS over the lock hit (< ${LAST_OVER_DB})`);
  if (lastP < Math.max(lockP, postP) - 0.05) bad.push(`audio: the last-beat peak (${lastP.toFixed(1)} dBFS) is not the loudest after the lock (${Math.max(lockP, postP).toFixed(1)})`);
  const M = momentary(file).filter((m) => m.t >= lockT + 0.4 - 1e-6 && m.t <= dur + 1e-6);
  const sorted = M.map((m) => m.M).sort((a, b) => a - b), med = sorted.length ? sorted[Math.floor(sorted.length / 2)] : 0;
  const lo = M.reduce((a, m) => (m.M < a.M ? m : a), { M: 99, t: 0 });
  if (M.length && lo.M < M_FLOOR) bad.push(`audio: momentary loudness ${lo.M.toFixed(1)} LUFS at ${lo.t.toFixed(1)} s after the lock (< ${M_FLOOR})`);
  if (M.length && lo.M < med - M_DIP) bad.push(`audio: momentary loudness dips ${(med - lo.M).toFixed(1)} LU under the post-lock bed at ${lo.t.toFixed(1)} s (> ${M_DIP})`);
  return { bad, line: `lock-step=${(lockR - pre).toFixed(1)}dB last-vs-lock=${(lastR - lockR).toFixed(1)}dB/${(lastP - lockP).toFixed(1)}dBpk post-lock-M-min=${lo.M.toFixed(1)} (median ${med.toFixed(1)})` };
}

const centre = (b) => [b.x + b.w / 2, b.y + b.h / 2];

const srv = await startServer();
let fails = 0;
try {
  for (const format of formats) {
    const R = P.resolved(format), bg = hexRGB(R.brand && R.brand.colors && R.brand.colors.bg), content = R.content || {};
    const s = await openPage({ base: srv.base, project: P.name, format, quiet: true, ...P.pageOpts });
    await s.page.evaluate(install);
    const info = await s.page.evaluate(() => ({ W: window.__reelcode.W, H: window.__reelcode.H, tl: window.__reelcode.timeline(), cues: [].concat(window.__reelcode.cues().cues || window.__reelcode.cues()) }));
    const dur = s.info.duration, spb = 60 / s.info.bpm, bad = [], { W, H } = info;
    // squash, every frame
    const runs = new Map();
    let worst = 1;
    for (let i = 0; i < Math.round(dur * FPS); i++) {
      const { sq } = await s.page.evaluate(frame, { t: i / FPS, bg, pix: false });
      const now = new Set();
      for (const x of sq) { worst = Math.min(worst, x.r); if (x.r < SQUASH) now.add(x.s); }
      for (const k of [...runs.keys()]) if (!now.has(k)) runs.delete(k);
      for (const k of now) {
        const n = (runs.get(k) || 0) + 1; runs.set(k, n);
        if (n === SQUASH_FRAMES + 1) bad.push(`squash: "${k}" drawn below ${SQUASH} aspect for >${SQUASH_FRAMES} frames (to t=${(i / FPS).toFixed(2)}s)`);
      }
    }
    // hook, dead stretches and the landing, on the quarter-beat grid
    const nq = Math.floor((dur - 1e-6) / (spb / 4));
    const sigs = [];
    for (let q = 0; q <= nq; q++) sigs.push(await s.page.evaluate(frame, { t: Math.min(dur - 1 / FPS, q * spb / 4), bg }));
    if (sigs[0].ink < HOOK_INK) bad.push(`hook: frame 0 is ${(sigs[0].ink * 100).toFixed(1)}% inked (< ${HOOK_INK * 100}%)`);
    let lastEvt = 0, longest = 0, stillAt = 0;
    for (let q = 1; q < sigs.length; q++) {
      if (changed(sigs[q - 1].sig, sigs[q].sig) >= STEP) lastEvt = q;
      if (q - lastEvt > longest) { longest = q - lastEvt; stillAt = lastEvt; }
    }
    if (longest > STILL_Q) bad.push(`dead stretch: ${(longest / 4).toFixed(2)} beats without a visible event from beat ${(stillAt / 4).toFixed(2)} (> ${STILL_Q / 4} beats)`);
    const lastBeat = Math.floor(dur / spb - 1e-6), qL = lastBeat * 4, land = qL >= 2 && qL < sigs.length ? changed(sigs[qL - 2].sig, sigs[qL].sig) : 1;
    if (land < LAND) bad.push(`ending: the last beat changes ${(land * 100).toFixed(1)}% of the frame (< ${LAND * 100}%)`);

    // jump cuts: the same text on both sides of a scene cut must not move or rescale
    let worstJump = 0;
    for (const sc of info.tl.scenes.slice(1)) {
      const a = (await s.page.evaluate(frame, { t: sc.start - 1 / FPS, bg, pix: false })).texts.filter((e) => !e.bleed);
      const b = (await s.page.evaluate(frame, { t: sc.start, bg, pix: false })).texts.filter((e) => !e.bleed);
      for (const e of a) {
        const o = b.find((x) => x.s === e.s);
        if (!o) continue;
        const [ax, ay] = centre(e.box), [bx, by] = centre(o.box);
        const mv = Math.max(Math.abs(ax - bx) / W, Math.abs(ay - by) / H), sz = Math.abs(o.box.h / Math.max(1e-6, e.box.h) - 1);
        worstJump = Math.max(worstJump, mv, sz);
        if (mv > JUMP || sz > JUMP) bad.push(`jump cut at ${sc.start.toFixed(2)}s: "${e.s}" moves ${(mv * 100).toFixed(1)}% / rescales ${(sz * 100).toFixed(1)}% across the cut (> ${JUMP * 100}%)`);
      }
    }

    // lockup scale: the name after the lock vs the hook
    const name = String(content.name || (R.brand && R.brand.name) || '');
    const words = new Set(name.split(/\s+/).filter(Boolean));
    const isName = (e) => e.role === 'display' && (e.s === name || e.s.split(/\s+/).every((w) => words.has(w)));
    const thumps = info.cues.filter((c) => c.sfx === 'thump').map((c) => c.beat).sort((a, b) => a - b);
    const lockB = thumps.length ? thumps[0] : null;
    let capLine = '';
    if (lockB !== null && name) {
      const hookCap = Math.max(0, ...sigs[0].texts.filter(isName).map((e) => e.box.h));
      const caps = [];
      for (let q = Math.ceil(lockB * 4) + 1; q < sigs.length; q++) {
        const hs = sigs[q].texts.filter((e) => isName(e) && !e.bleed).map((e) => e.box.h);
        if (hs.length) caps.push(Math.max(...hs));
      }
      if (caps.length && hookCap > 0) {
        const lo = Math.min(...caps), hi = Math.max(...caps);
        capLine = ` name-cap/hook=${(lo / hookCap).toFixed(2)}`;
        if (hi / lo - 1 > JUMP) bad.push(`lockup scale: the name's cap height changes ${((hi / lo - 1) * 100).toFixed(1)}% after the lock (one geometry from the lock to the end)`);
        if (lo < hookCap * CAP_MIN) bad.push(`lockup scale: the settled name is ${(lo / hookCap).toFixed(2)}x the hook's cap height (< ${CAP_MIN})`);
      }
    }

    // phone floor in the final 2 s, and CTA orphans
    let minCap = Infinity;
    const ctaWords = content.endCard && content.endCard.cta ? content.endCard.cta.split(/\s+/).filter(Boolean) : [];
    for (let q = 0; q < sigs.length; q++) {
      const t = q * spb / 4;
      if (t < dur - 2 - 1e-6) continue;
      for (const e of sigs[q].texts) {
        if (e.bleed || e.box.w < 1) continue;
        minCap = Math.min(minCap, e.box.h / H);
        if (e.box.h / H < PHONE) bad.push(`phone floor: "${e.s}" cap ${(e.box.h / H * 100).toFixed(2)}% of the height at ${t.toFixed(2)}s (< ${PHONE * 100}%)`);
      }
      if (ctaWords.length > 1) {
        const ws = sigs[q].texts.filter((e) => e.role === 'ui' && ctaWords.includes(e.s));
        const hMax = Math.max(0, ...ws.map((e) => e.box.h));   // the CTA's own size (URL characters can match a word)
        ws.splice(0, ws.length, ...ws.filter((e) => e.box.h > hMax * 0.8));
        const rows = new Map();
        for (const e of ws) {   // group words by baseline (within half a cap)
          const base = e.box.y + e.box.h, k = [...rows.keys()].find((b) => Math.abs(b - base) < e.box.h * 0.5) ?? base;
          rows.set(k, (rows.get(k) || 0) + e.s.split(/\s+/).length);
        }
        if (rows.size > 1 && [...rows.values()].some((n) => n < 2)) bad.push(`CTA orphan: "${content.endCard.cta}" breaks onto a one-word line at ${t.toFixed(2)}s`);
      }
    }

    fails += [...new Set(bad)].length;
    const uniqBad = [...new Set(bad)].slice(0, 12);
    console.log(`${bad.length ? 'FAIL' : 'ok  '} ${format.padEnd(5)} hook-ink=${(sigs[0].ink * 100).toFixed(0)}% worst-text-aspect=${worst.toFixed(2)} longest-still=${(longest / 4).toFixed(2)} beats last-beat-change=${(land * 100).toFixed(0)}% worst-cut-jump=${(worstJump * 100).toFixed(1)}%${capLine} final-2s-min-cap=${Number.isFinite(minCap) ? (minCap * 100).toFixed(2) : '-'}%${uniqBad.length ? `\n     ${uniqBad.join('\n     ')}` : ''}`);
    await s.close();
  }
  // audio, once per rendition (identical in every format)
  if (!args.includes('--no-audio')) {
    const file = join(P.audioDir, 'mix.wav');
    if (!existsSync(file)) console.log(`skip  audio: ${P.rel(file)} is missing (run make first)`);
    else {
      const s = await openPage({ base: srv.base, project: P.name, format: formats[0], quiet: true, ...P.pageOpts });
      const cues = await s.page.evaluate(() => [].concat(window.__reelcode.cues().cues || window.__reelcode.cues()));
      const dur = s.info.duration, spb = 60 / s.info.bpm;
      await s.close();
      const th = cues.filter((c) => c.sfx === 'thump').map((c) => c.beat).sort((a, b) => a - b);
      if (th.length >= 2) {
        const r = audioCheck(file, th[0] * spb, th[th.length - 1] * spb, dur, spb);
        fails += r.bad.length;
        console.log(`${r.bad.length ? 'FAIL' : 'ok  '} audio ${r.line}${r.bad.length ? `\n     ${r.bad.join('\n     ')}` : ''}`);
      } else console.log('skip  audio: needs a lock thump and a last-beat thump (end card)');
    }
  }
} finally { await closeShared(); await srv.close(); }
process.exit(fails ? 1 : 0);
