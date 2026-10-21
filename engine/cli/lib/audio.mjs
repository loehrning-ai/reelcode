// audio.mjs: the make.mjs audio stage (docs/SPEC.md §5.2 step 2 and §6), calling engine/audio/*.py as black boxes.
import { existsSync, mkdirSync, rmSync } from 'node:fs';
import { join, resolve, sep } from 'node:path';
import { totalBeatsFor } from '../../beat.js';
import { py, sha256File, readJSON, writeJSON } from './pipeline.mjs';
import { toWav48, loudness } from './ffmpeg.mjs';

/** Absolute paths of every audio work file of a project. */
export function audioPaths(P) {
  const d = P.audioDir || join(P.dir, 'audio'); // v2: the rendition's audio dir (audio/ or audio/<variant>/<cutdown>/)
  return { dir: d, music: join(d, 'music.wav'), track48: join(d, 'track_48k.wav'), beats: join(d, 'beats.json'),
    cues: join(d, 'cues.json'), timed: join(d, 'cues_timed.json'), sfx: join(d, 'sfx.wav'), mix: join(d, 'mix.wav'),
    state: join(d, 'audio.json') };
}

/** The resolved audio settings with defaults filled in. */
export function audioSettings(P) {
  const b = P.base, a = b.audio || {};
  const bpm = b.bpm || 120, duration = b.duration || 16;
  return { music: a.music || 'synth', style: a.style || 'minimal-tech', key: a.key || null, sfx: a.sfx !== false,
    lufs: a.lufs ?? -14, bpm, duration, seed: b.seed ?? 7, loop: !!b.loop, bars: totalBeatsFor(duration, bpm) / 4,
    musicStart: a.musicStart ?? 0, fit: a.fit ?? null };
}

/** audio.music values that are not a file: the beat grid is exact (no analysis). "none" = no music bed. */
export const GRID_ONLY = Object.freeze(['synth', 'none']);

/** The exact nominal grid (same shape as music.py's beats.json) for a film without a music bed. */
function nominalBeats(S) {
  const spb = 60 / S.bpm, n = S.bars * 4, r6 = (x) => Math.round(x * 1e6) / 1e6;
  const beats = Array.from({ length: n }, (_, k) => r6(k * spb));
  return { bpm: S.bpm, beats, downbeats: beats.filter((_, k) => k % 4 === 0), duration: r6(n * spb), source: 'none', lag_ms: 0, bars: S.bars, loop: S.loop };
}

/** audio.fit modes for a supplied track (engine/audio/fit.py). */
export const FIT_MODES = Object.freeze(['trim', 'loop', 'fade-bar']);

function checkFit(S) {
  if (!(typeof S.musicStart === 'number' && Number.isFinite(S.musicStart) && S.musicStart >= 0))
    throw new Error(`audio.musicStart must be a number of seconds >= 0 (got ${JSON.stringify(S.musicStart)})`);
  if (S.fit !== null && !FIT_MODES.includes(S.fit))
    throw new Error(`audio.fit must be one of ${FIT_MODES.map((m) => `"${m}"`).join(', ')} (got ${JSON.stringify(S.fit)})`);
  if (GRID_ONLY.includes(S.music) && (S.musicStart || S.fit)) throw new Error(`audio.musicStart / audio.fit apply to a supplied track only (audio.music is "${S.music}")`);
}

/** A supplied track must be a file inside the project folder. */
function suppliedTrack(P, music) {
  const p = resolve(P.dir, music);
  if (!p.startsWith(P.dir + sep)) throw new Error(`audio.music "${music}" must be a path inside ${P.rel(P.dir)}/`);
  if (!existsSync(p)) throw new Error(`audio.music: supplied track ${P.rel(p)} is missing`);
  return p;
}

/** Step 2.1: synth music + exact beats.json, or measure a supplied track. Returns a summary for the manifest. */
export async function musicStage(P, A, S, log) {
  mkdirSync(A.dir, { recursive: true });
  checkFit(S);
  if (S.music === 'none') {
    log(`music: none (sfx${S.sfx ? '' : ' off'}; voice-over if set), nominal grid ${S.bpm} bpm, ${S.bars} bars`);
    writeJSON(A.beats, nominalBeats(S));
    rmSync(A.music, { force: true }); rmSync(A.track48, { force: true });
    return { source: 'none', file: null, bpm: S.bpm, bars: S.bars, duration: (S.bars * 4 * 60) / S.bpm };
  }
  if (S.music === 'synth') {
    log(`music: synth ${S.style}, ${S.bpm} bpm, ${S.bars} bars${S.loop ? ', loop' : ''}`);
    const r = await py('music.py', ['--style', S.style, '--bpm', S.bpm, ...(S.key ? ['--key', S.key] : []), '--bars', S.bars,
      '--seed', S.seed, ...(S.loop ? ['--loop'] : []), '--out', A.music, '--beats', A.beats]);
    rmSync(A.track48, { force: true });
    return { source: 'synth', file: A.music, style: r.style, key: r.key, bpm: r.bpm, bars: r.bars, duration: r.duration };
  }
  const src = suppliedTrack(P, S.music);
  if (S.musicStart || S.fit) return fittedTrack(P, A, S, src, log);
  log(`music: supplied ${P.rel(src)}; converting to 48 kHz and measuring beats`);
  await toWav48({ input: src, out: A.track48 });
  const r = await py('beats.py', ['--in', A.track48, '--out', A.beats, '--bpm-hint', S.bpm]);
  return { source: 'measured', file: A.track48, supplied: P.rel(src), bpm: r.bpm, lag_ms: r.lag_ms ?? null };
}

/** A supplied track with an in-point (audio.musicStart) and/or a fit mode: cut, measure, fit on bar lines. */
async function fittedTrack(P, A, S, src, log) {
  const mode = S.fit || 'none', full = join(A.dir, 'track_src_48k.wav');
  log(`music: supplied ${P.rel(src)} from ${S.musicStart}s, fit ${mode}; converting to 48 kHz, measuring beats`);
  await toWav48({ input: src, out: full });
  try {
    const r = await py('fit.py', ['--in', full, '--out', A.track48, '--beats', A.beats, '--total-beats', S.bars * 4,
      '--start', S.musicStart, '--mode', mode, '--bpm-hint', S.bpm, ...(S.loop ? ['--film-loop'] : [])]);
    const b = readJSON(A.beats);
    if (b && b.bar_phase) log(`music: warning: audio.musicStart ${S.musicStart}s is not on a downbeat (the bar starts on beat ${b.bar_phase}); bar lines will not match the track`);
    return { source: 'measured', file: A.track48, supplied: P.rel(src), bpm: r.bpm, lag_ms: b ? b.lag_ms ?? null : null,
      fit: { mode, start: S.musicStart, copies: r.copies, bars_per_copy: r.bars_per_copy, duration: r.duration } };
  } finally { rmSync(full, { force: true }); }
}

/** With --only video: refuse a beats.json that no longer matches the project (it would desync a later audio run). */
export function checkBeatsFresh(A, S) {
  const b = readJSON(A.beats);
  if (!b) {
    if (!GRID_ONLY.includes(S.music)) throw new Error('audio/beats.json is missing for a supplied track; run make --only audio first');
    return 'nominal grid (no audio/beats.json yet)';
  }
  if (GRID_ONLY.includes(S.music)) {
    const dur = (S.bars * 4 * 60) / S.bpm;
    if (b.source !== S.music || Math.abs(b.bpm - S.bpm) > 1e-6 || Math.abs(b.duration - dur) > 1e-3)
      throw new Error(`audio/beats.json is stale (${b.source} ${b.bpm} bpm, ${b.duration}s; project wants ${S.music} ${S.bpm} bpm, ${dur}s); run make without --only video`);
  }
  return `audio/beats.json (${b.source}, ${b.bpm} bpm)`;
}

/**
 * Steps 2.2–2.5: cues.json (from the page) -> cues.py -> sfx.py render -> mix.py, then verify with ebur128.
 * tl/cues come from the booted page. Writes audio/audio.json (deterministic) and returns it.
 */
export async function soundStage(P, A, S, music, tl, cues, log) {
  writeJSON(A.cues, cues);
  const timed = await py('cues.py', ['--cues', A.cues, '--beats', A.beats, '--out', A.timed]);
  const D = tl.duration, loopArgs = S.loop ? ['--loop'] : [];
  const useSfx = S.sfx && timed.cues > 0;
  if (!music.file && !useSfx) throw new Error('audio.music is "none" but there are no sfx cues to mix (sfx is off or the timeline has no cues); use music "synth" or a track, or turn sfx on');
  if (useSfx) {
    log(`sfx: ${timed.cues} cues (max ${timed.max_offgrid_ms} ms off grid)`);
    await py('sfx.py', ['render', '--cues', A.timed, '--duration', D, ...loopArgs, '--out', A.sfx]);
  } else rmSync(A.sfx, { force: true });
  log(`mix: ${D.toFixed(3)}s to ${S.lufs} LUFS`);
  const m = await py('mix.py', [...(music.file ? ['--music', music.file] : []), ...(useSfx ? ['--sfx', A.sfx, '--cues', A.timed] : []),
    '--duration', D, ...loopArgs, '--lufs', S.lufs, '--out', A.mix]);
  const meas = await loudness(A.mix);
  if (!(Math.abs(meas.I - S.lufs) <= 0.5)) throw new Error(`mix.wav reads ${meas.I} LUFS (target ${S.lufs} ±0.5)`);
  const state = {
    music: { ...music, file: music.file ? P.rel(music.file) : null },
    beats: sha256File(A.beats), cues: sha256File(A.cues), cueCount: timed.cues, maxOffgridMs: timed.max_offgrid_ms,
    mix: { file: P.rel(A.mix), sha256: sha256File(A.mix), I: meas.I, TP: meas.TP, LRA: meas.LRA, seam_ok: m.seam_ok ?? null, duration: D },
  };
  writeJSON(A.state, state);
  return state;
}

/** Is audio/mix.wav in sync with the current page timeline? (used by --only video before muxing) */
export function audioState(A, cues) {
  const st = readJSON(A.state);
  if (!st || !existsSync(A.mix) || !existsSync(A.beats)) return { ok: false, why: 'no audio/mix.wav yet (run make --only audio)' };
  if (st.beats !== sha256File(A.beats)) return { ok: false, why: 'audio/beats.json changed since the last mix' };
  if (!existsSync(A.cues) || sha256File(A.cues) !== st.cues) return { ok: false, why: 'audio/cues.json changed since the last mix' };
  if (JSON.stringify(sortKeys(readJSON(A.cues))) !== JSON.stringify(sortKeys(cues))) return { ok: false, why: 'the timeline cues changed since the last mix (run make without --only video)' };
  if (st.mix.sha256 !== sha256File(A.mix)) return { ok: false, why: 'audio/mix.wav changed outside make' };
  return { ok: true, state: st };
}

const sortKeys = (v) => (Array.isArray(v) ? v.map(sortKeys) : v && typeof v === 'object'
  ? Object.fromEntries(Object.keys(v).sort().map((k) => [k, sortKeys(v[k])])) : v);
