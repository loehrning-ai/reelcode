// make.mjs: one project -> finished films in every format (docs/SPEC.md §5.2).
// prepare (project.prepare generators, once) then, per rendition (variant x cutdown): validate -> [clips] -> music (+ musicStart/fit) + beats.json -> timeline + cues
// -> [voice-over: voice.wav + voiceover.json] -> sfx -> mix -> [voice mix, ducked] -> [caption sidecars] -> lint
// (text QA sees the burned-in captions) -> render (segment cache) -> mux -> [exports] -> deliverables -> manifest.
// [..] run only when the project asks for them; a feature that throws NotImplemented is skipped with a warning.
// npx reelcode make projects/Y [--quality draft|final] [--formats 9x16,1x1,4x5,16x9|all] [--only video|audio]
//      [--variant id|all] [--cutdown id|all] [--no-stills] [--force] [--jobs N] [--quiet]
import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { isDeepStrictEqual } from 'node:util';
import { parseArgs, runCli } from './lib/args.mjs';
import { loadProject, pickFormats, pickRenditions } from './lib/project.mjs';
import { startServer, STUDIO_ROOT } from './lib/server.mjs';
import { launch, openPage } from './lib/browser.mjs';
import { preset, renderFormat, pool, silentName, sourceStamp, SHUTTER } from './lib/video.mjs';
import { mux, loop3, probe, loudness } from './lib/ffmpeg.mjs';
import { nodeCli, sha256File, readJSON, writeJSON, table } from './lib/pipeline.mjs';
import { audioPaths, audioSettings, musicStage, checkBeatsFresh, soundStage, audioState } from './lib/audio.mjs';
import { validate, PROJECT_SCHEMA } from '../schema.js';
import { isNotImplemented } from '../notimpl.js';
import { buildVoiceover, mixVoiceover, DEFAULT_DUCK_DB } from './lib/voiceover.mjs';
import { writeSidecars, manualSegments } from './lib/captions.mjs';
import { prepareClips } from './lib/clips.mjs';
import { exportPresets } from './lib/exporter.mjs';
import { runPrepare } from './lib/prepare.mjs';

const USAGE = 'npx reelcode make <project> [--quality draft|final] [--formats 9x16,1x1,4x5,16x9|all] [--only video|audio] [--variant id|all] [--cutdown id|all] [--no-stills] [--force] [--jobs N] [--quiet]';
const SPEC = {
  variant: { type: 'list' }, cutdown: { type: 'list' },
  quality: { type: 'string', enum: ['draft', 'final'] }, formats: { type: 'list' }, format: { type: 'list' },
  only: { type: 'string', enum: ['video', 'audio'] }, stills: { type: 'boolean', default: true },
  force: { type: 'boolean', default: false }, jobs: { type: 'number', default: 3 }, quiet: { type: 'boolean', default: false },
};
const SHEETS = ['contact', 'phone', 'strip', 'seam', 'poster'];
const videoName = (quality) => (quality === 'final' ? 'final.mp4' : 'draft.mp4');

/** Every validation problem, against docs/project.schema.json (read from disk) and the template's content schema. */
function validationErrors(P) {
  const errors = [...P.errors];
  const docSchema = readJSON(join(STUDIO_ROOT, 'docs', 'project.schema.json'));
  if (!docSchema) errors.push('docs/project.schema.json is missing or invalid JSON');
  else if (!isDeepStrictEqual(docSchema, PROJECT_SCHEMA)) {
    // the page validates with the inlined copy; a drifted doc schema is itself a problem
    errors.push('docs/project.schema.json differs from engine/schema.js PROJECT_SCHEMA (keep the two copies equal)');
    for (const e of validate(P.base, docSchema).errors) errors.push(`project.${e.path}: ${e.msg} (docs/project.schema.json)`.replace('project.(root)', 'project'));
  }
  return errors;
}

/** Stamp of everything that decides the picture of one format (lib/video.mjs sourceFiles) plus the encode preset. */
function videoStamp(P, format, q) {
  const values = { format, fps: q.fps, sub: q.sub, crf: q.crf, preset: q.preset };
  if (q.sub > 1) values.shutter = SHUTTER;
  return sourceStamp(P, values);
}

/** Child-CLI flags that select this rendition (none for main/full). */
const renditionArgs = (P) => [...(P.variant !== 'main' ? ['--variant', P.variant] : []), ...(P.cutdown !== 'full' ? ['--cutdown', P.cutdown] : [])];

/** Run an optional v2 feature: NotImplemented -> warning + skipped; any other error fails the run. */
async function feature(name, skipped, log, fn) {
  try { return await fn(); } catch (e) {
    if (!isNotImplemented(e)) throw new Error(`${name}: ${e.message}`);
    skipped.push(name); log(`warning: ${name} skipped (${e.message})`);
    return null;
  }
}

async function lintStage(P, formats, quality, log) {
  log(`lint: ${quality === 'final' ? 'full' : '--fast'} on ${formats.join(', ')}`);
  const r = await nodeCli('lint', [P.rel(P.dir), '--format', formats.join(','), ...renditionArgs(P), ...(quality === 'final' ? [] : ['--fast'])]);
  const j = readJSON(join(P.outDir(), 'lint.json'), { errors: [], warnings: [] });
  if (r.code !== 0) throw new Error(`lint failed (${j.errors.length} errors; see ${P.rel(join(P.outDir(), 'lint.json'))})\n  ${(j.errors.length ? j.errors : [r.stderr.trim()]).join('\n  ')}`);
  for (const w of j.warnings) log(`lint warning: ${w}`);
  return { status: j.warnings.length ? 'warn' : 'pass', warnings: j.warnings.length };
}

/** Render (or reuse) the silent video, mux the mix, probe and measure. */
async function videoStage({ P, A, format, q, quality, base, browser, force, audio, log }) {
  const dir = P.outDir(format), silent = join(dir, silentName(quality)), final = join(dir, videoName(quality));
  const stampFile = join(dir, `.${silentName(quality)}.stamp`), want = videoStamp(P, format, q);
  const fresh = !force && existsSync(silent) && existsSync(stampFile) && readFileSync(stampFile, 'utf8').trim() === want;
  if (fresh) log(`[${format}] video up to date (${P.rel(silent)})`);
  else {
    rmSync(stampFile, { force: true });
    log(`[${format}] rendering ${quality} ${q.fps}fps sub ${q.sub}`);
    const r = await renderFormat({ P, format, q, quality, base, browser });
    log(`[${format}] rendered ${r.frames} frames in ${r.seconds.toFixed(1)}s${r.segments ? ` (${r.cached}/${r.segments} segments from the cache)` : ''}`);
    writeFileSync(stampFile, want + '\n');
  }
  const meta = await probe(silent);
  if (!audio) { rmSync(final, { force: true }); return { format, silent, final: null, meta, lufs: null, rendered: !fresh }; }
  await mux({ video: silent, audio: A.mix, out: final });
  const fm = await probe(final);
  if (!fm.audio) throw new Error(`[${format}] ${P.rel(final)} has no audio stream`);
  if (fm.frames !== meta.frames || fm.width !== meta.width || fm.height !== meta.height) throw new Error(`[${format}] mux changed the video (${fm.frames} vs ${meta.frames} frames)`);
  return { format, silent, final, meta: fm, lufs: await loudness(final), rendered: !fresh };
}

async function deliverables(P, formats, results, log) {
  log(`stills: ${SHEETS.join(', ')} for ${formats.join(', ')}`);
  const r = await nodeCli('stills', [P.rel(P.dir), '--format', formats.join(','), '--sheet', SHEETS.join(','), ...renditionArgs(P)]);
  if (r.code !== 0) throw new Error(`stills failed: ${r.stderr.trim()}`);
  for (const v of results) {
    const out = join(P.outDir(v.format), 'loop_check.mp4');
    await loop3({ input: v.final || v.silent, out });
    v.loop = { out, meta: await probe(out) };
  }
}

function writeManifest(P, quality, results, lint, sound, S, withStills, extra = {}) {
  const file = join(P.outDir(), 'manifest.json');
  const old = readJSON(file);
  const mixSha = sound ? sound.mix.sha256 : null;
  const formats = {};
  if (old && old.quality === quality) for (const [f, e] of Object.entries(old.formats || {})) if (e.mix === mixSha) formats[f] = e;
  for (const v of results) {
    const dir = P.outDir(v.format), names = [silentName(quality), videoName(quality), ...(withStills ? ['loop_check.mp4', ...SHEETS.map((s) => `${s}.png`)] : [])];
    const files = Object.fromEntries(names.filter((n) => existsSync(join(dir, n))).map((n) => [n, sha256File(join(dir, n))]));
    formats[v.format] = { files, frames: v.meta.frames, fps: v.meta.fps, width: v.meta.width, height: v.meta.height,
      duration: +v.meta.duration.toFixed(3), audio: !!v.final, mix: v.final ? mixSha : null,
      lufs: v.lufs ? { I: v.lufs.I, TP: v.lufs.TP, LRA: v.lufs.LRA } : null };
  }
  const m = { project: P.name, template: P.base.template || null, title: P.base.title, quality, lint: lint.status,
    timeline: { bpm: S.bpm, bars: S.bars, loop: S.loop }, audio: sound || (old && old.audio) || null, formats };
  if (P.page) m.page = P.page;
  if (!P.legacy) Object.assign(m, { variant: P.variant, cutdown: P.cutdown });
  for (const [k, v] of Object.entries(extra)) if (v && (!Array.isArray(v) || v.length)) m[k] = v;
  writeJSON(file, m);
  return file;
}

function summary(P, results, sound, manifest, lint, quality, withStills) {
  const rows = [['format', 'video', 'frames', 'fps', 'duration', 'LUFS I', 'TP dBTP', 'rendered']];
  for (const v of results) rows.push([v.format, P.rel(v.final || v.silent), v.meta.frames, v.meta.fps, `${v.meta.duration.toFixed(3)}s`,
    v.lufs ? v.lufs.I.toFixed(1) : '-', v.lufs ? v.lufs.TP.toFixed(1) : '-', v.rendered ? 'yes' : 'cached']);
  if (sound) rows.push(['audio', sound.mix.file, '-', '-', `${sound.mix.duration.toFixed(3)}s`,
    sound.mix.I.toFixed(1), sound.mix.TP.toFixed(1), `${sound.cueCount} cues`]);
  const lines = [table(rows)];
  for (const v of results) {
    const dir = P.outDir(v.format), extra = [silentName(quality), ...(withStills ? [...SHEETS.map((s) => `${s}.png`), 'loop_check.mp4'] : [])].filter((n) => existsSync(join(dir, n)));
    lines.push(`${v.format}: ${P.rel(dir)}/{${extra.join(',')}}`);
  }
  lines.push(`lint: ${lint.status}${lint.warnings ? ` (${lint.warnings} warnings)` : ''}  manifest: ${P.rel(manifest)}`);
  return lines.join('\n');
}

/** Voice-over (before the mix) and caption sidecars; returns {vo, segments}. */
async function voiceStage(P, A, tl, skipped, log) {
  const vcfg = P.base.audio && P.base.audio.voiceover;
  if (vcfg && vcfg.engine === 'say') log('warning: voiceover engine "say": Apple licenses the macOS voices for personal, non-commercial use; do not publish this audio');
  const vo = vcfg ? await feature('voiceover', skipped, log, () => buildVoiceover(P.base, { project: P.dir, audio: A.dir, out: P.outDir(), timeline: tl })) : null;
  if (vo) log(`voiceover: ${vo.segments.length} lines -> ${P.rel(vo.wav)}`);
  return vo;
}

async function voiceMix(P, A, S, vo, sound, log) {
  const vcfg = P.base.audio.voiceover, duck = vcfg.duck_db ?? DEFAULT_DUCK_DB;
  const r = await mixVoiceover({ mix: A.mix, voice: vo.wav, segments: vo.segments, duck_db: duck, lufs: S.lufs, out: A.mix, loop: S.loop });
  const meas = await loudness(A.mix);
  if (!(Math.abs(meas.I - S.lufs) <= 0.5)) throw new Error(`mix.wav with voice reads ${meas.I} LUFS (target ${S.lufs} ±0.5)`);
  const state = { ...sound, voice: { segments: vo.segments.length, duck_db: duck, I: r && r.I !== undefined ? r.I : meas.I },
    mix: { ...sound.mix, sha256: sha256File(A.mix), I: meas.I, TP: meas.TP, LRA: meas.LRA } };
  writeJSON(A.state, state);
  return state;
}

async function captionStage(P, tl, vo, skipped, log) {
  const c = P.base.captions;
  if (!c || c.sidecars === false) return null;
  const source = c.source || 'voiceover';
  const segments = source === 'voiceover' ? (vo ? vo.segments : null)
    : await feature('captions', skipped, log, () => manualSegments(c.lines || [], tl));
  if (!segments) { if (source === 'voiceover' && !skipped.includes('voiceover')) log('captions: no voice-over segments; sidecars skipped'); return null; }
  const out = await feature('captions', skipped, log, () => writeSidecars(segments, P.outDir()));
  if (out) log(`captions: ${P.rel(out.srt)}, ${P.rel(out.vtt)}`);
  return out;
}

/** One rendition (variant x cutdown) end to end. */
async function makeRendition(P, a, log) {
  const errors = validationErrors(P);
  if (errors.length) throw new Error(`${P.rel(join(P.dir, 'project.json'))}${P.legacy ? '' : ` (${P.variant}/${P.cutdown})`} is invalid (${errors.length} problem${errors.length > 1 ? 's' : ''}):\n  - ${errors.join('\n  - ')}`);
  const quality = a.quality || P.base.quality || 'draft', q = preset(quality);
  const formats = pickFormats(P, a.formats || a.format);
  const doAudio = a.only !== 'video', doVideo = a.only !== 'audio';
  const A = audioPaths(P), S = audioSettings(P), skipped = [];
  if (!P.legacy) log(`rendition ${P.variant}/${P.cutdown}: ${S.duration}s -> ${P.rel(P.outDir())}`);

  if (P.base.clips && Object.keys(P.base.clips).length) await feature('clips', skipped, log, () => prepareClips(P, { log }));
  const music = doAudio ? await musicStage(P, A, S, log) : (log(`grid: ${checkBeatsFresh(A, S)}`), null);
  const srv = await startServer(), browser = await launch();
  let sound = null, results = [], captions = null, lint = null;
  const exportsDone = [];
  try {
    const s = await openPage({ browser, base: srv.base, project: P.name, format: formats[0], quiet: true, ...P.pageOpts });
    let tl, cues;
    try { tl = s.info; cues = await s.cues(); } finally { await s.close(); }
    writeJSON(join(P.outDir(), 'timeline.json'), tl);
    if (doAudio) {
      const vo = await voiceStage(P, A, tl, skipped, log);
      sound = await soundStage(P, A, S, music, tl, cues, log);
      if (vo) sound = (await feature('voiceover', skipped, log, () => voiceMix(P, A, S, vo, sound, log))) || sound;
      captions = await captionStage(P, tl, vo, skipped, log);
    } else {
      const st = audioState(A, cues);
      if (st.ok) sound = st.state; else log(`audio: not muxing: ${st.why}`);
    }
    // after the voice-over, so lint's text QA reads the burned-in captions from this run's voiceover.json
    lint = await lintStage(P, formats, quality, log);
    if (doVideo) {
      results = await pool(formats, a.jobs, (format) => videoStage({ P, A, format, q, quality, base: srv.base, browser, force: a.force, audio: !!sound, log }));
      for (const v of results) {
        const want = Math.round(tl.duration * q.fps);
        if (v.meta.frames !== want) throw new Error(`[${v.format}] ${v.meta.frames} frames, expected ${want}`);
        if (v.lufs && Math.abs(v.lufs.I - S.lufs) > 0.5) throw new Error(`[${v.format}] ${P.rel(v.final)} reads ${v.lufs.I} LUFS (target ${S.lufs} ±0.5)`);
        if (v.lufs && v.lufs.TP > -1.0) log(`[${v.format}] warning: AAC true peak ${v.lufs.TP} dBTP is above -1`);
      }
      // exports reuse this server and browser for the re-rendered presets (4k, prores-alpha)
      if (Array.isArray(P.base.exports) && P.base.exports.length) {
        for (const v of results) {
          const r = await feature('exports', skipped, log, () => exportPresets({ P, format: v.format, video: v.final, silent: v.silent, quality,
            presets: P.base.exports, outDir: P.outDir(v.format), log, base: srv.base, browser }));
          if (!r) break;
          for (const e of r) exportsDone.push({ format: v.format, preset: e.preset, file: P.rel(e.file) });
        }
      }
    }
  } finally { await browser.close(); await srv.close(); }
  if (doVideo && a.stills) await deliverables(P, formats, results, log);
  const withStills = doVideo && a.stills;
  const manifest = writeManifest(P, quality, results, lint, sound, S, withStills,
    { skipped: [...new Set(skipped)].sort(), exports: exportsDone, captions: captions ? { srt: P.rel(captions.srt), vtt: P.rel(captions.vtt) } : null,
      // which font files the film used and the licence each was rendered under
      fonts: (Array.isArray(P.base.fonts) ? P.base.fonts : []).map((f) => ({ family: f.family, file: f.file, licence: f.licence,
        sha256: existsSync(join(P.dir, f.file)) ? sha256File(join(P.dir, f.file)) : null })) });
  console.log(summary(P, results, sound, manifest, lint, quality, withStills));
  return { variant: P.variant, cutdown: P.cutdown, manifest: P.rel(manifest), duration: S.duration };
}

runCli(USAGE, async () => {
  const a = parseArgs(process.argv.slice(2), SPEC, { positionals: [1, 1] });
  if (!(a.jobs >= 1 && Number.isInteger(a.jobs))) throw new Error('--jobs must be an integer >= 1');
  const log = (m) => { if (!a.quiet) process.stderr.write(`make: ${m}\n`); };
  const first = loadProject(a._[0]);
  const prepared = await runPrepare(first, { log });
  // a capture step may have rewritten project.json (--apply-brand), so load again after any step ran
  const P0 = prepared.some((d) => d.ran) ? loadProject(a._[0]) : first;
  const targets = pickRenditions(P0, { variant: a.variant, cutdown: a.cutdown });
  if (!a.variant && !a.cutdown && targets.length < P0.renditions.length) log(`${P0.renditions.length - 1} more rendition(s) in project.json; use --variant all --cutdown all`);
  const done = [];
  for (const t of targets) done.push(await makeRendition(t.variant === 'main' && t.cutdown === 'full' ? P0 : loadProject(a._[0], t), a, log));
  if (!P0.legacy) {
    const file = join(P0.dir, 'out', 'renditions.json'), old = readJSON(file, { renditions: [] });
    const key = (r) => `${r.variant}/${r.cutdown}`, byKey = new Map((old.renditions || []).map((r) => [key(r), r]));
    for (const r of done) byKey.set(key(r), r);
    const known = new Set(P0.renditions.map(key));
    writeJSON(file, { project: P0.name, renditions: [...byKey.values()].filter((r) => known.has(key(r))).sort((x, y) => key(x).localeCompare(key(y))) });
    console.log(`renditions: ${P0.rel(file)} (${done.map(key).join(', ')})`);
  }
  return 0;
});
