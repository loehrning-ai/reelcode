// captions.mjs: caption sidecar files (owner: captions). make.mjs calls these after the voice-over.
// Cues follow the burned-in pages: at most 2 lines of at most 42 characters; a longer segment is split into
// several cues timed proportionally to characters (the same estimate engine/captions.js uses for word times).
import { mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { makeGrid } from '../../beat.js';
import { segmentsFromLines, wordTimes } from '../../captions.js';

export const LINE_CHARS = 42;
export const MAX_LINES = 2;

/** Greedy wrap by characters; a single word longer than max stays on its own line. */
export function wrapChars(text, max = LINE_CHARS) {
  const lines = [];
  let cur = '';
  for (const w of String(text).split(/\s+/).filter(Boolean)) {
    const next = cur ? `${cur} ${w}` : w;
    if (cur && [...next].length > max) { lines.push(cur); cur = w; } else cur = next;
  }
  if (cur) lines.push(cur);
  return lines;
}

function validate(segments) {
  if (!Array.isArray(segments)) throw new Error('captions: segments must be an array of {text, start, end}');
  segments.forEach((s, i) => {
    if (!s || typeof s.text !== 'string' || !s.text.trim()) throw new Error(`captions: segment ${i} needs non-empty text`);
    if (!Number.isFinite(s.start) || !Number.isFinite(s.end) || s.start < 0 || !(s.end > s.start)) throw new Error(`captions: segment ${i} ("${s.text}") needs 0 <= start < end (got ${s.start}..${s.end})`);
  });
}

/** cuesOf(segments) -> [{start, end, lines:[...]}]: each segment paged into <= 2-line cues, never overlapping. */
export function cuesOf(segments) {
  validate(segments);
  const cues = [];
  for (const s of segments) {
    const lines = wrapChars(s.text.trim());
    const words = wordTimes(s.text.trim(), s.start, s.end);
    let wi = 0;
    for (let p = 0; p < lines.length; p += MAX_LINES) {
      const group = lines.slice(p, p + MAX_LINES);
      const n = group.reduce((a, l) => a + l.split(' ').length, 0);
      const first = words[wi], last = words[wi + n - 1];
      cues.push({ start: first.start, end: last.end, lines: group });
      wi += n;
    }
  }
  const ms = (x) => Math.round(x * 1000);
  const out = cues.map((c) => ({ ...c, start: ms(c.start), end: ms(c.end) }));
  out.forEach((c, i) => { if (i + 1 < out.length && c.end > out[i + 1].start) c.end = out[i + 1].start; });
  return out.filter((c) => c.end > c.start);
}

const pad = (n, w = 2) => String(n).padStart(w, '0');
/** Milliseconds -> "HH:MM:SS,mmm" (SRT, sep ',') or "HH:MM:SS.mmm" (VTT, sep '.'). */
export function stamp(msTotal, sep) {
  const h = Math.floor(msTotal / 3600000), m = Math.floor(msTotal / 60000) % 60, s = Math.floor(msTotal / 1000) % 60, ms = msTotal % 1000;
  return `${pad(h)}:${pad(m)}:${pad(s)}${sep}${pad(ms, 3)}`;
}

const vttText = (l) => l.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

export function toSrt(cues) {
  return cues.map((c, i) => `${i + 1}\n${stamp(c.start, ',')} --> ${stamp(c.end, ',')}\n${c.lines.join('\n')}\n`).join('\n');
}
export function toVtt(cues) {
  return `WEBVTT\n\n${cues.map((c) => `${stamp(c.start, '.')} --> ${stamp(c.end, '.')}\n${c.lines.map(vttText).join('\n')}\n`).join('\n')}`;
}

/**
 * writeSidecars(segments, outDir) -> {srt, vtt} (absolute paths written)
 * segments: [{text, start, end}] seconds. Writes <outDir>/captions.srt and <outDir>/captions.vtt (UTF-8, LF,
 * byte-identical on rerun). outDir is the rendition out dir (shared by formats).
 */
export function writeSidecars(segments, outDir) {
  if (!outDir) throw new Error('captions: writeSidecars needs an outDir');
  const cues = cuesOf(segments);
  const dir = resolve(outDir);
  mkdirSync(dir, { recursive: true });
  const srt = join(dir, 'captions.srt'), vtt = join(dir, 'captions.vtt');
  writeFileSync(srt, toSrt(cues));
  writeFileSync(vtt, toVtt(cues));
  return { srt, vtt };
}

/**
 * manualSegments(lines, timeline) -> [{text, start, end}]
 * captions.lines [{text, at, end?}] (time refs) -> seconds, using timeline.beatTimes / timeline.bpm
 * (the same rule as engine/captions.js segmentsFromLines).
 */
export function manualSegments(lines, timeline) {
  if (!timeline || !(timeline.bpm > 0) || !(timeline.duration > 0)) throw new Error('captions: manualSegments needs a timeline with bpm and duration');
  const beats = Array.isArray(timeline.beatTimes) && timeline.beatTimes.length >= 2 ? timeline.beatTimes : undefined;
  const grid = makeGrid({ bpm: timeline.bpm, beats }, timeline.duration);
  return segmentsFromLines(lines, grid, timeline.duration);
}
