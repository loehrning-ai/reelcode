// voiceover.mjs: build the voice-over track for one rendition.
// make.mjs calls buildVoiceover after the page timeline is known and before the mix, then mixVoiceover after
// mix.py; a NotImplemented throw skips the voice-over with a warning. Never reads or prints .env contents; the
// elevenlabs engine reads its key from process.env by variable name only and refuses when it is not set.
//
// Engines:
//   say        macOS local TTS. Each line is synthesized on its own (exact segment timing), converted to 48 kHz,
//              trimmed to its speech edges and levelled (engine/audio/voice.py prep), then placed on the beat grid.
//              Apple licenses the macOS voices for personal, non-commercial use: say audio is for drafts, never for
//              a film you publish.
//   file       a supplied recording (wav/aiff/mp3/m4a inside the project). Segments come from a sidecar
//              <file stem>.segments.json ({segments:[{text,start,end}]} or a bare array) when present; otherwise
//              speech regions are detected and paired with `lines` (counts must match).
//   elevenlabs remote TTS, only when the ELEVENLABS_API_KEY environment variable is set (never read from files,
//              never printed). Responses are cached by content hash under audio/.voice-cache/.
import { spawn, execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, writeFileSync, rmSync, readFileSync } from 'node:fs';
import { join, resolve, sep, dirname, basename, extname } from 'node:path';
import { makeGrid, parseAt } from '../../beat.js';
import { py, readJSON, writeJSON } from './pipeline.mjs';
import { toWav48 } from './ffmpeg.mjs';

export const ENGINES = Object.freeze(['say', 'file', 'elevenlabs']);
export const DEFAULT_DUCK_DB = -9;
export const DEFAULT_SAY_VOICE = 'Samantha';
export const ELEVENLABS_ENV = 'ELEVENLABS_API_KEY';
export const DEFAULT_ELEVENLABS_VOICE = '21m00Tcm4TlvDq8ikWAM';
const GAP_BEATS = 1;          // sequential lines: one beat after the previous line ends
const FIRST_BEAT = 1;         // a first line without `at` starts on beat 1
const DIV = 4;                // line starts snap to the 1/16 grid (4 per beat)
const SYNTH_VERSION = 'v1';   // bump to invalidate the TTS cache

const sha = (s) => createHash('sha256').update(s).digest('hex');
const warn = (m) => process.stderr.write(`make: voiceover: warning: ${m}\n`);

function run(cmd, args) {
  return new Promise((ok, fail) => {
    const p = spawn(cmd, args, { stdio: ['ignore', 'ignore', 'pipe'] });
    let err = '';
    p.stderr.on('data', (d) => { err += d; });
    p.on('error', (e) => fail(new Error(`could not run ${cmd}: ${e.message}`)));
    p.on('close', (code) => (code === 0 ? ok() : fail(new Error(`${cmd} exited ${code}: ${err.trim().split('\n').slice(-2).join(' | ')}`))));
  });
}

/** The rendition's beat grid, exactly as the page builds it (audio/beats.json, else the nominal grid). */
export function gridFor(project, dirs) {
  const beats = readJSON(join(dirs.audio, 'beats.json'));
  const grid = makeGrid(beats && Array.isArray(beats.beats) ? beats : { bpm: project.bpm || 120 }, project.duration || 16);
  const tl = dirs.timeline;
  if (tl && Number.isFinite(tl.duration) && Math.abs(tl.duration - grid.duration) > 1e-3)
    throw new Error(`voiceover: grid duration ${grid.duration}s does not match the timeline (${tl.duration}s)`);
  return grid;
}

const MISSING = Symbol('missing scene');
/**
 * lineBeat(line, i, grid, scenes) -> beats from the film start, null (no `at`: sequential) or MISSING.
 * `at` is a time ref from the film start, or {scene, at} local to that scene (scenes: the rendition's timeline
 * scenes [{id, startBeat}]), so a line follows its scene when a cutdown re-times the film.
 */
function lineBeat(ln, i, grid, scenes) {
  const at = ln.at;
  if (at === undefined || at === null) return null;
  if (typeof at !== 'object') return parseAt(at, grid);
  if (typeof at.scene !== 'string' || !at.scene) throw new Error(`voiceover line ${i + 1}: "at" {scene, at} needs a scene id`);
  if (!Array.isArray(scenes)) throw new Error(`voiceover line ${i + 1}: "at" {scene: "${at.scene}"} needs the timeline (run make)`);
  const sc = scenes.find((x) => x.id === at.scene);
  if (!sc) return MISSING;
  const local = parseAt(at.at ?? 0, grid);
  if (local < 0 || local > sc.beats + 1e-9) throw new Error(`voiceover line ${i + 1}: "at" ${JSON.stringify(at)} is outside scene "${at.scene}" (0..${sc.beats} beats)`);
  return sc.startBeat + local;
}

/**
 * placeLines(lines, durations, grid, duration, {drop, scenes}) -> {items:[{i, text, start, end}], warnings, dropped}
 * Pure. A line with `at` starts on that time ref snapped to the 1/16 grid; a line without one starts GAP_BEATS
 * after the previous line ends (the first on beat FIRST_BEAT), snapped up to the 1/16 grid. A line that would
 * overlap the previous one is pushed after it (warning). A line that would end after the film throws, unless
 * `drop` (cutdowns), which drops it with a warning. A line anchored to a scene ({scene, at}) starts at that scene's
 * start beat plus `at`; in a cutdown that dropped the scene the line is dropped (warning), in the full film it throws.
 */
export function placeLines(lines, durations, grid, duration, { drop = false, scenes = null } = {}) {
  const items = [], warnings = [], dropped = [];
  let prevEnd = null;
  const after = (t) => Math.ceil((grid.at(t) + GAP_BEATS) * DIV - 1e-6) / DIV;
  lines.forEach((ln, i) => {
    const dur = durations[i];
    const ref = lineBeat(ln, i, grid, scenes);
    if (ref === MISSING) {
      const msg = `voiceover line ${i + 1} ("${ln.text.slice(0, 40)}") is anchored to scene "${ln.at.scene}", which is not in this ${drop ? 'cutdown' : 'film'} (scenes: ${(scenes || []).map((x) => x.id).join(', ')})`;
      if (drop) { warnings.push(`${msg}; dropped in this cutdown`); dropped.push(i); return; }
      throw new Error(msg);
    }
    let b = ref !== null ? Math.round(ref * DIV) / DIV : (prevEnd === null ? FIRST_BEAT : after(prevEnd));
    if (prevEnd !== null && grid.beat(b) < prevEnd + 0.05) {
      const nb = after(prevEnd);
      warnings.push(`line ${i + 1} at beat ${b} overlaps line ${items.length} (ends ${prevEnd.toFixed(3)}s); moved to beat ${nb}`);
      b = nb;
    }
    if (b < 0) throw new Error(`voiceover line ${i + 1}: "at" ${JSON.stringify(ln.at)} is before the film start`);
    const start = grid.beat(b), end = start + dur;
    if (end > duration + 1e-9) {
      const msg = `voiceover line ${i + 1} ("${ln.text.slice(0, 40)}") needs ${dur.toFixed(2)}s from ${start.toFixed(3)}s and ends at ${end.toFixed(3)}s, after the film end (${duration.toFixed(3)}s)`;
      if (drop) { warnings.push(`${msg}; dropped in this cutdown`); dropped.push(i); return; }
      throw new Error(`${msg}; shorten it, move it earlier ("at"), or lengthen the film`);
    }
    items.push({ i, text: ln.text, start: +start.toFixed(6), end: +end.toFixed(6), beat: b });
    prevEnd = end;
  });
  return { items, warnings, dropped };
}

// ---------- engines: one 48 kHz stereo wav per line ----------
let SAY_VOICES = null;
/** Installed say voices ("Samantha", "Eddy (English (US))", ...). say silently falls back on an unknown -v. */
export function sayVoices() {
  if (SAY_VOICES) return SAY_VOICES;
  let txt;
  try { txt = execFileSync('say', ['-v', '?'], { encoding: 'utf8' }); } catch (e) {
    throw new Error(`voiceover engine "say" needs macOS say (${e.message.split('\n')[0]})`);
  }
  SAY_VOICES = txt.split('\n').map((l) => /^(.+?)\s+[a-z]{2,3}_[A-Za-z0-9]+\s+#/.exec(l)).filter(Boolean).map((m) => m[1].trim());
  return SAY_VOICES;
}

function checkSayVoice(voice) {
  const names = sayVoices(), want = voice.toLowerCase();
  if (!names.some((n) => n.toLowerCase() === want || n.split(' (')[0].toLowerCase() === want))
    throw new Error(`say voice "${voice}" is not installed; "say -v ?" lists the installed voices`);
}

async function synthSay(text, voice, out) {
  const dir = dirname(out), txt = `${out}.txt`, aiff = `${out}.aiff`;
  mkdirSync(dir, { recursive: true });
  writeFileSync(txt, text);                              // -f file: text never parsed as flags
  try {
    await run('say', ['-v', voice, '-o', aiff, '-f', txt]).catch((e) => {
      throw new Error(`say -v "${voice}" failed (${e.message}); "say -v ?" lists the installed voices`);
    });
    await toWav48({ input: aiff, out });
  } finally { rmSync(txt, { force: true }); rmSync(aiff, { force: true }); }
}

/** ElevenLabs TTS for one line. The key is read from process.env[ELEVENLABS_ENV] and never logged. */
export async function synthElevenLabs(text, voice, out, { fetchImpl = globalThis.fetch } = {}) {
  const key = process.env[ELEVENLABS_ENV];
  if (!key) throw new Error(`voiceover engine "elevenlabs" needs the ${ELEVENLABS_ENV} environment variable, which is not set; use engine "file" for your own recording (no key, no network)`);
  if (typeof fetchImpl !== 'function') throw new Error('voiceover: no fetch available for engine "elevenlabs"');
  const url = `https://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(voice)}?output_format=mp3_44100_128`;
  const res = await fetchImpl(url, { method: 'POST', headers: { 'xi-api-key': key, 'content-type': 'application/json', accept: 'audio/mpeg' },
    body: JSON.stringify({ text, model_id: 'eleven_multilingual_v2', seed: 7 }) });
  if (!res || !res.ok) throw new Error(`voiceover: elevenlabs returned HTTP ${res ? res.status : '?'} for "${text.slice(0, 40)}"`);
  const buf = Buffer.from(await res.arrayBuffer());
  if (!buf.length) throw new Error('voiceover: elevenlabs returned an empty body');
  mkdirSync(dirname(out), { recursive: true });
  const raw = `${out}.src`;
  writeFileSync(raw, buf);
  try { await toWav48({ input: raw, out }); } finally { rmSync(raw, { force: true }); }
}

/** Synthesize (or reuse from the content-addressed cache) every line. Returns the cached 48 kHz wav paths. */
async function synthLines(engine, voice, lines, cacheDir, opts) {
  const files = [];
  if (engine === 'say') checkSayVoice(voice);
  for (const ln of lines) {
    const f = join(cacheDir, `${engine}-${sha(`${SYNTH_VERSION}\0${engine}\0${voice}\0${ln.text}`).slice(0, 20)}.wav`);
    if (!existsSync(f)) {
      if (engine === 'say') await synthSay(ln.text, voice, f);
      else await synthElevenLabs(ln.text, voice, f, opts);
    }
    files.push(f);
  }
  return files;
}

function insideProject(dirs, rel, what) {
  const p = resolve(dirs.project, rel);
  if (!p.startsWith(resolve(dirs.project) + sep)) throw new Error(`${what} "${rel}" must be a path inside the project`);
  if (!existsSync(p)) throw new Error(`${what}: ${rel} is missing`);
  return p;
}

function validSegments(raw, duration, src) {
  const list = Array.isArray(raw) ? raw : raw && raw.segments;
  if (!Array.isArray(list) || !list.length) throw new Error(`${src}: expected {segments:[{text,start,end}]}`);
  let prev = 0;
  return list.map((s, i) => {
    const ok = s && typeof s.text === 'string' && Number.isFinite(s.start) && Number.isFinite(s.end) && s.start >= prev - 1e-9 && s.end > s.start && s.end <= duration + 1e-6;
    if (!ok) throw new Error(`${src}: segment ${i + 1} must be {text, start, end} in order, inside 0..${duration.toFixed(3)}s`);
    prev = s.end;
    return { text: s.text, start: +s.start.toFixed(6), end: +s.end.toFixed(6) };
  });
}

async function fileVoice(v, dirs, duration, wav) {
  if (!v.file) throw new Error('voiceover engine "file" needs audio.voiceover.file (a recording inside the project)');
  const src = insideProject(dirs, v.file, 'audio.voiceover.file');
  const tmp = join(dirs.audio, 'voice_src_48k.wav');
  await toWav48({ input: src, out: tmp });
  try {
    await py('voice.py', ['fit', '--in', tmp, '--duration', duration, '--out', wav]);
    const side = join(dirname(src), `${basename(src, extname(src))}.segments.json`);
    if (existsSync(side)) return validSegments(JSON.parse(readFileSync(side, 'utf8')), duration, basename(side));
    const { regions } = await py('voice.py', ['regions', '--in', wav]);
    const lines = v.lines || [];
    if (!regions.length) throw new Error(`audio.voiceover.file ${v.file} has no speech`);
    if (lines.length && lines.length !== regions.length)
      throw new Error(`audio.voiceover.file: found ${regions.length} speech regions but ${lines.length} lines; add ${basename(side)} with exact {segments:[{text,start,end}]}`);
    if (!lines.length) warn(`${v.file}: no lines and no ${basename(side)}; segments have empty text (captions will be blank)`);
    return regions.map(([s, e], i) => ({ text: lines.length ? lines[i].text : '', start: s, end: e }));
  } finally { rmSync(tmp, { force: true }); }
}

/**
 * buildVoiceover(project, dirs) -> Promise<{wav, segments: [{text, start, end}]}>
 * @param project  the resolved rendition base (P.base): project.audio.voiceover = {engine:'say'|'file'|'elevenlabs',
 *                 voice, file, lines:[{text, at?}], duck_db}; project.bpm / duration
 * @param dirs     {project: abs project dir, audio: abs rendition audio dir, out: abs rendition out dir,
 *                 timeline: out/timeline.json contents (beatTimes, duration, scenes)}
 * Writes <audio>/voice.wav (48 kHz stereo, film length, silence between lines) and <audio>/voiceover.json
 * ({segments}) — the page reads voiceover.json for captions source "voiceover". `at` is a time ref resolved on
 * the beat grid (beats) or seconds ("s1.5"); line starts snap to the 1/16 grid. Deterministic.
 * @param opts     (tests) {fetchImpl} for the elevenlabs engine.
 */
export async function buildVoiceover(project, dirs, opts = {}) {
  const v = (project && project.audio && project.audio.voiceover) || null;
  if (!v) throw new Error('voiceover: project.audio.voiceover is not set');
  const engine = v.engine;
  if (!ENGINES.includes(engine)) throw new Error(`voiceover: audio.voiceover.engine must be one of ${ENGINES.join(', ')} (got ${JSON.stringify(engine)})`);
  if (engine === 'say' && process.platform !== 'darwin') throw new Error('voiceover engine "say" needs macOS; use engine "file" (your own recording) or "elevenlabs"');
  mkdirSync(dirs.audio, { recursive: true });
  const grid = gridFor(project, dirs), duration = dirs.timeline && Number.isFinite(dirs.timeline.duration) ? dirs.timeline.duration : grid.duration;
  const wav = join(dirs.audio, 'voice.wav'), json = join(dirs.audio, 'voiceover.json');
  let segments, voice = null, warnings = [];
  if (engine === 'file') segments = await fileVoice(v, dirs, duration, wav);
  else {
    const lines = v.lines || [];
    if (!lines.length) throw new Error(`voiceover engine "${engine}" needs audio.voiceover.lines [{text, at?}]`);
    voice = v.voice || (engine === 'say' ? DEFAULT_SAY_VOICE : DEFAULT_ELEVENLABS_VOICE);
    const cache = join(dirs.project, 'audio', '.voice-cache');
    const raw = await synthLines(engine, voice, lines, cache, opts);
    const prepDir = join(dirs.audio, '.voice-lines');
    rmSync(prepDir, { recursive: true, force: true });
    try {
      const prep = await py('voice.py', ['prep', '--in', ...raw, '--out-dir', prepDir]);
      const placed = placeLines(lines, prep.lines.map((l) => l.duration), grid, duration,
        { drop: !!(dirs.timeline && dirs.timeline.cut), scenes: dirs.timeline && Array.isArray(dirs.timeline.scenes) ? dirs.timeline.scenes : null });
      warnings = placed.warnings;
      if (!placed.items.length) throw new Error('voiceover: no line fits this rendition');
      const plan = join(prepDir, 'plan.json');
      writeJSON(plan, { items: placed.items.map((it) => ({ file: prep.lines[it.i].file, start: it.start, text: it.text })) });
      ({ segments } = await py('voice.py', ['place', '--plan', plan, '--duration', duration, '--out', wav]));
    } finally { rmSync(prepDir, { recursive: true, force: true }); }
  }
  for (const w of warnings) warn(w);
  writeJSON(json, { engine, voice, duration: +duration.toFixed(6), segments });
  return { wav, segments, json, warnings };
}

/**
 * mixVoiceover({mix, voice, segments, duck_db, lufs, out, loop?}) -> Promise<{I, TP}>
 * Ducks the music+sfx mix (mix.wav) by duck_db under each voice segment (ffmpeg sidechaincompress keyed by the
 * segment envelope), adds the voice, re-normalises to `lufs` (true peak <= -1 dBTP) and writes `out` (make passes
 * the same path as mix, so mix.wav is replaced in place).
 */
export async function mixVoiceover({ mix, voice, segments, duck_db, lufs, out, loop = false }) {
  if (!Array.isArray(segments) || !segments.length) throw new Error('mixVoiceover: no voice segments');
  const duck = duck_db ?? DEFAULT_DUCK_DB;
  const segFile = join(dirname(out), '.voice_segments.json');
  writeJSON(segFile, { segments });
  try {
    const r = await py('voice.py', ['mix', '--mix', mix, '--voice', voice, '--segments', segFile, '--duck-db', duck,
      '--lufs', lufs ?? -14, '--tp', -1, ...(loop ? ['--loop'] : []), '--out', out]);
    return { I: r.I, TP: r.TP, LRA: r.LRA, duck_db: duck, voice_gain_db: r.voice_gain_db };
  } finally { rmSync(segFile, { force: true }); }
}
