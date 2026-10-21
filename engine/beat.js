// beat.js: the beat grid. Beat 0 is the film start. Picture and sound read the same beats.json.
export { quant } from './motion.js';

/** Bars-snapped beat count for a duration (s) and bpm. */
export const totalBeatsFor = (duration, bpm) => Math.max(4, 4 * Math.round((duration * bpm) / 240));

/**
 * makeGrid({bpm, beats?, downbeats?}, duration) -> grid
 * beats (seconds) come from audio/beats.json when present; otherwise the nominal grid is used.
 */
export function makeGrid(src, duration) {
  const bpm = Number(src && src.bpm);
  if (!(bpm > 0)) throw new Error('beat: grid needs a positive bpm');
  const spb = 60 / bpm;
  const list = Array.isArray(src.beats) && src.beats.length >= 2 ? src.beats.slice() : null;
  const totalBeats = totalBeatsFor(duration, bpm);

  const beat = (n) => {
    if (!list) return n * spb;
    const last = list.length - 1;
    if (n <= 0) return list[0] + n * spb;
    if (n >= last) return list[last] + (n - last) * spb;
    const i = Math.floor(n), f = n - i;
    return list[i] + (list[i + 1] - list[i]) * f;
  };
  const at = (t) => {
    if (!list) return t / spb;
    const last = list.length - 1;
    if (t <= list[0]) return (t - list[0]) / spb;
    if (t >= list[last]) return last + (t - list[last]) / spb;
    let lo = 0, hi = last;
    while (hi - lo > 1) { const m = (lo + hi) >> 1; if (list[m] <= t) lo = m; else hi = m; }
    return lo + (t - list[lo]) / (list[lo + 1] - list[lo]);
  };
  const bar = (n) => beat(4 * n);
  const snap = (t, div = 4) => beat(Math.round(at(t) * div) / div);
  const downbeats = Array.isArray(src.downbeats) ? src.downbeats.slice()
    : Array.from({ length: totalBeats / 4 }, (_, i) => beat(4 * i));
  return Object.freeze({
    bpm, spb, totalBeats, measured: !!list, beats: list, downbeats,
    duration: beat(totalBeats), beat, bar, at, snap,
  });
}

const REF = /^(?:b(-?\d+(?:\.\d+)?)|bar(\d+(?:\.\d+)?)|s(-?\d+(?:\.\d+)?))$/;

/**
 * parseAt(ref, grid) -> beats. ref: number (beats) | "b3.5" | "bar2" (= beat 8) | "s1.25" (seconds at grid tempo).
 */
export function parseAt(ref, grid) {
  if (typeof ref === 'number' && Number.isFinite(ref)) return ref;
  const m = typeof ref === 'string' && REF.exec(ref.trim());
  if (!m) throw new Error(`beat: bad time ref ${JSON.stringify(ref)} (use 3, "b3.5", "bar2" or "s1.25")`);
  if (m[1] !== undefined) return Number(m[1]);
  if (m[2] !== undefined) return 4 * Number(m[2]);
  if (!grid) throw new Error(`beat: "${ref}" needs a grid`);
  return (Number(m[3]) * grid.bpm) / 60;
}
