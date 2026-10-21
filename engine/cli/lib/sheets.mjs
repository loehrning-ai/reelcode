// sheets.mjs: frame times for the critique sheets (pure; used by stills.mjs, tested in engine/test/v2.test.mjs).
// info = the page's __reelcode.timeline(): {duration, bpm, loop, scenes:[{id, start, end, startBeat, beats, transition}],
// events:[s], poster, beatTimes:[s]}.

export const SHEETS = ['contact', 'phone', 'strip', 'seam', 'poster'];
export const CONTACT_MAX = 64;   // tiles; longer films group beats into bars, then 2 bars, 4 bars ...
export const STRIP_FRAMES = 12;

const r4 = (x) => +x.toFixed(4);
const lastFrame = (info) => info.duration - 1 / 30;

/**
 * contactTimes(info, max=CONTACT_MAX) -> {times, step, unit}
 * One tile per beat ON the beat grid (info.beatTimes, so measured grids are honoured). When the film has more beats
 * than `max`, tiles group to bars (every 4th beat = the downbeats), then 2 bars, 4 bars ... until they fit.
 */
export function contactTimes(info, max = CONTACT_MAX) {
  const beats = info.beatTimes;
  let step = 1;
  while (Math.ceil(beats.length / step) > max) step = step === 1 ? 4 : step * 2;
  const unit = step === 1 ? 'beat' : step === 4 ? 'bar' : `${step / 4} bars`;
  return { times: beats.filter((_, i) => i % step === 0), step, unit };
}

const lexGreater = (a, b) => { for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return a[i] > b[i]; return false; };

/**
 * busiestBoundary(info) -> {index, at, span:[from, to], transition} | null
 * The scene boundary with the most going on: a real (non-cut) transition first, then the most timeline events
 * within ±2 beats, then the longer transition, then the earlier boundary. null for a single-scene film.
 */
export function busiestBoundary(info) {
  const spb = 60 / info.bpm, sc = info.scenes || [];
  let best = null;
  for (let k = 1; k < sc.length; k++) {
    const at = sc[k].start, tr = sc[k].transition || { type: 'cut', beats: 0 };
    const real = tr.type !== 'cut' && tr.beats > 0;
    const busy = (info.events || []).filter((e) => Math.abs(e - at) <= 2 * spb + 1e-9).length;
    const score = [real ? 1 : 0, busy, real ? tr.beats : 0, -k];
    if (!best || lexGreater(score, best.score)) {
      const span = real ? [at - 0.5 * spb, at + (tr.beats + 0.5) * spb] : [at - spb, at + spb];
      best = { index: k, at, span, transition: tr, score };
    }
  }
  if (!best) return null;
  const { score, ...out } = best;
  return out;
}

/** stripTimes(info, n=12) -> n times evenly spanning the busiest boundary (or the middle of a single-scene film). */
export function stripTimes(info, n = STRIP_FRAMES) {
  const b = busiestBoundary(info), spb = 60 / info.bpm, last = lastFrame(info);
  let [from, to] = b ? b.span : [info.duration / 2 - spb, info.duration / 2 + spb];
  if (to - from > last) [from, to] = [0, last];
  if (from < 0) { to -= from; from = 0; }
  if (to > last) { from -= to - last; to = last; from = Math.max(0, from); }
  return Array.from({ length: n }, (_, i) => r4(from + ((to - from) * i) / (n - 1)));
}

/** phoneTimes(info): poster + 3 frames spread farthest-first over settled moments (60% into scenes, event + 1 beat). */
export function phoneTimes(info) {
  const spb = 60 / info.bpm, last = lastFrame(info), out = [info.poster];
  const pool = [...info.scenes.map((sc) => sc.start + (sc.end - sc.start) * 0.6), ...info.events.map((e) => e + spb)]
    .map((t) => r4(Math.min(t, last))).filter((t) => t >= 0.5);
  while (out.length < 4) {
    let best = null, bd = 0.5;
    for (const t of pool) { const d = Math.min(...out.map((o) => Math.abs(o - t))); if (d > bd + 1e-9) { bd = d; best = t; } }
    if (best === null) break;
    out.push(best);
  }
  return out.sort((a, b) => a - b);
}

/** seamTimes(info): one row of 4 frames per scene boundary, plus the loop wrap when loop is true (or no boundaries). */
export function seamTimes(info) {
  const dur = info.duration, last = lastFrame(info);
  const rows = info.scenes.slice(1).map((s) => [s.start - 2 / 30, s.start - 1 / 30, s.start, s.start + 1 / 30]);
  if (info.loop || !rows.length) rows.push([dur - 2 / 30, last, 0, 1 / 30]);
  return rows.flat().map((t) => r4(Math.min(Math.max(0, t), last)));
}

/**
 * sheetTimes(sheet, info, {every, at}) -> seconds[]
 * every (contact only): 'beat' (default, capped by CONTACT_MAX) | 'bar' | seconds. at: a single frame (not seam).
 */
export function sheetTimes(sheet, info, { every, at } = {}) {
  if (at !== undefined && sheet !== 'seam') return [at];
  if (sheet === 'poster') return [info.poster];
  if (sheet === 'contact') {
    if (!every || every === 'beat') return contactTimes(info).times;
    if (every === 'bar') return info.beatTimes.filter((_, i) => i % 4 === 0);
    const s = Number(every);
    if (!(s > 0)) throw new Error(`--every must be beat, bar or seconds > 0 (got ${every})`);
    return Array.from({ length: Math.max(1, Math.floor(info.duration / s + 1e-9)) }, (_, i) => r4(i * s));
  }
  if (sheet === 'strip') return stripTimes(info);
  if (sheet === 'phone') return phoneTimes(info);
  if (sheet === 'seam') return seamTimes(info);
  throw new Error(`unknown sheet "${sheet}" (use ${SHEETS.join(', ')} or all)`);
}

/** Tile width per sheet: phone 390; strip 160 px tall; contact/seam 270 (portrait/square) or 360 (landscape). */
export const tileW = (W, H, sheet) => (sheet === 'phone' ? 390 : sheet === 'strip' ? Math.round((160 * W) / H) : W > H ? 360 : 270);
