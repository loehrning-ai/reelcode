// video.mjs: render one format of a project to a silent H.264 file (used by render.mjs and make.mjs).
// v2: the film is encoded as fixed 1 s closed-GOP segments cached under <P.outDir()>/.cache/<format>/ and joined by
// stream copy, so a re-render only encodes the segments whose pixels changed (render --from/--to, make after an edit).
import { join } from 'node:path';
import { existsSync, mkdirSync, renameSync, rmSync, readdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { QUALITY, encoder, probe, concatSegments, ffmpegVersion } from './ffmpeg.mjs';
import { openPage } from './browser.mjs';
import { STUDIO_ROOT } from './server.mjs';
import { listFiles, stamp, readJSON, writeJSON } from './pipeline.mjs';

/** Output file name for a quality: draft never overwrites final. */
export const silentName = (quality) => (quality === 'final' ? 'silent.mp4' : 'draft_silent.mp4');

/** Merge a preset name with explicit overrides ({fps, sub, crf, preset}). */
export function preset(quality = 'draft', over = {}) {
  const q = QUALITY[quality];
  if (!q) throw new Error(`unknown quality "${quality}" (use draft or final)`);
  const out = { ...q };
  for (const k of ['fps', 'sub', 'crf', 'preset']) if (over[k] !== undefined) out[k] = over[k];
  if (!(out.fps > 0 && Number.isInteger(out.fps))) throw new Error('fps must be a positive integer');
  if (!(out.sub >= 1 && Number.isInteger(out.sub))) throw new Error('sub must be an integer >= 1');
  return Object.freeze(out);
}

/** Shutter of the sub-frame motion blur (part of the video stamp). */
export const SHUTTER = 'centered';

/** Seconds per cached segment (one closed GOP each). */
export const SEGMENT_SECONDS = 1;
/** Bump when the segment encode or key changes (invalidates every cached segment). */
const SEG_VERSION = 1;
const STRONG_MAX = 4096;
const sha = (v) => createHash('sha256').update(typeof v === 'string' ? v : JSON.stringify(v)).digest('hex');

/**
 * subframeTime(i, rate, sub, duration, loop) -> seconds of sub-frame i.
 * Centred shutter: output frame j blends the sub-frames centred on j/fps (not j/fps .. j/fps + (sub-1)/rate), so
 * frame 0 of a loop does not show the film's first moments smeared forward. Loop films wrap the sub-frames
 * before 0 to the end of the film (the seam is continuous); one-shots clamp to 0.
 */
export function subframeTime(i, rate, sub, duration, loop) {
  const t = i / rate - (sub - 1) / (2 * rate);
  if (loop) return ((t % duration) + duration) % duration;
  return Math.max(0, t);
}

/** Sub-frame times of output frames [f0, f1) (sub per frame, in order). */
export function subframeTimes(f0, f1, q, duration, loop) {
  const rate = q.fps * q.sub, out = [];
  for (let i = f0 * q.sub; i < f1 * q.sub; i++) out.push(subframeTime(i, rate, q.sub, duration, loop));
  return out;
}

/** segmentPlan(frames, fps, seconds=1) -> [{index, f0, f1}]: fixed GOP-aligned segments; the last may be short. */
export function segmentPlan(frames, fps, seconds = SEGMENT_SECONDS) {
  const n = Math.max(1, Math.round(fps * seconds)), out = [];
  for (let f0 = 0, index = 0; f0 < frames; f0 += n, index++) out.push({ index, f0, f1: Math.min(frames, f0 + n) });
  return out;
}

/** Segments of a plan that overlap output frames [f0, f1). */
export const segmentsFor = (plan, f0, f1) => plan.filter((s) => s.f1 > f0 && s.f0 < f1);

/**
 * Files whose contents decide the picture of a rendition: engine page code, template (or the bespoke project's own
 * files), project.json, assets, brand presets, the beat grid and voice-over segments. Same list as make's stamp.
 */
export function sourceFiles(P) {
  const eng = join(STUDIO_ROOT, 'engine');
  const own = P.templateDir ? listFiles(P.templateDir)
    : listFiles(P.dir).filter((f) => !f.startsWith(join(P.dir, 'out') + '/') && !f.startsWith(join(P.dir, 'audio') + '/'));
  const audioDir = P.audioDir || join(P.dir, 'audio');
  return [...listFiles(eng).filter((f) => /\.(js|html)$/.test(f) && !f.includes(`${eng}/cli/`) && !f.includes(`${eng}/test/`)),
    ...own, join(P.dir, 'project.json'), ...listFiles(join(P.dir, 'assets')),
    ...(P.brandFiles || []).flatMap((f) => (f.endsWith('.json') ? [f] : listFiles(f))),
    join(audioDir, 'beats.json'), join(audioDir, 'voiceover.json')];
}

/** Content stamp of a rendition's sources plus plain values (format, preset, ...). */
export const sourceStamp = (P, values = {}) => stamp(sourceFiles(P), { ...values, variant: P.variant || 'main', cutdown: P.cutdown || 'full' });

// ---------- segment cache ----------
/**
 * The cache of one format: <cacheDir>/seg/<contentKey>.mp4 plus index.json
 * {strong: {sourceKey: contentKey}, films: {draft|final: {frames, fps, sub, W, H, keys}}, range: [keys]}.
 * contentKey = settings + the pixel hash of every sub-frame of the segment (position independent: identical pixels
 * encode to identical bytes). sourceKey = settings + sourceStamp + segment frames: a hit skips the page entirely.
 */
export function openCache(cacheDir) {
  const file = join(cacheDir, 'index.json'), segDir = join(cacheDir, 'seg');
  const j = readJSON(file, null) || {};
  const idx = { strong: j.strong || {}, films: j.films || {}, range: j.range || [] };
  const path = (key) => join(segDir, `${key}.mp4`);
  return {
    idx, dir: cacheDir, path,
    has: (key) => !!key && existsSync(path(key)),
    tmp: (key) => { mkdirSync(segDir, { recursive: true }); return join(segDir, `_tmp-${process.pid}-${key}.mp4`); },
    commit: (tmp, key) => renameSync(tmp, path(key)),
    /** Drop segment files no film/range references; cap the source map. */
    save() {
      const keep = new Set([...Object.values(idx.films).flatMap((f) => f.keys || []), ...idx.range]);
      if (existsSync(segDir)) {
        for (const n of readdirSync(segDir)) {
          const k = n.replace(/\.mp4$/, '');
          if (n.startsWith('_tmp-') || !keep.has(k)) rmSync(join(segDir, n), { force: true });
        }
      }
      const strong = Object.entries(idx.strong).filter(([, v]) => keep.has(v)).slice(-STRONG_MAX);
      idx.strong = Object.fromEntries(strong);
      writeJSON(file, idx);
    },
  };
}

/**
 * renderSegments({s, q, plan, segs, cache, settings, sourceKey, onSegment}) -> {keys:[{index, key, cached}], cached, rendered}
 * For each segment of segs: a sourceKey hit reuses it without touching the page; else the page hashes every
 * sub-frame (seek + fnv1a of the canvas, about 1/5 of a screenshot) and a content hit reuses the encoded bytes;
 * else the segment is rendered (seek, screenshot, closed-GOP encode) and stored.
 */
export async function renderSegments({ s, q, segs, cache, settings, sourceKey, onSegment }) {
  const out = [];
  let cached = 0, rendered = 0;
  for (const seg of segs) {
    const strong = sourceKey ? sha([sourceKey, seg.f0, seg.f1]) : null;
    let key = strong ? cache.idx.strong[strong] : null;
    if (key && cache.has(key)) { cached++; out.push({ ...seg, key, cached: true }); if (onSegment) onSegment(seg, true); continue; }
    const times = subframeTimes(seg.f0, seg.f1, q, s.info.duration, s.info.loop);
    const hashes = [];
    for (const t of times) hashes.push(await s.seekHash(t));
    key = sha([settings, seg.f1 - seg.f0, hashes]);
    const hit = cache.has(key);
    if (hit) cached++;
    else {
      const tmp = cache.tmp(key);
      const enc = encoder({ out: tmp, fps: q.fps, sub: q.sub, crf: q.crf, preset: q.preset, gop: Math.round(q.fps * SEGMENT_SECONDS) });
      try {
        for (const t of times) { await s.seek(t); await enc.write(await s.shot()); }
        await enc.end();
      } catch (e) { enc.abort(); rmSync(tmp, { force: true }); throw e; }
      const m = await probe(tmp);
      if (m.frames !== seg.f1 - seg.f0) { rmSync(tmp, { force: true }); throw new Error(`segment ${seg.index}: ${m.frames} frames, expected ${seg.f1 - seg.f0}`); }
      cache.commit(tmp, key);
      rendered++;
    }
    if (strong) cache.idx.strong[strong] = key;
    out.push({ ...seg, key, cached: hit });
    if (onSegment) onSegment(seg, hit);
  }
  return { keys: out, cached, rendered };
}

/** Encoder settings shared by every segment of one format/quality (part of both keys). */
export async function segmentSettings({ W, H, q }) {
  return { v: SEG_VERSION, ff: await ffmpegVersion(), W, H, fps: q.fps, sub: q.sub, crf: q.crf, preset: q.preset, shutter: SHUTTER, seg: SEGMENT_SECONDS };
}

/** Default cache dir of a format: <P.outDir()>/.cache/<format>/ */
export const cacheDirOf = (P, format) => join(P.outDir(), '.cache', format);

/**
 * renderFormat({P, format, q, quality, base, browser, out?, onProgress?, cacheDir?}) -> {out, frames, fps, sub, duration, seconds, cached, segments}
 * Seeks sub-frames subframeTime(i) for i < round(duration*fps*sub), screenshots #c and encodes 1 s closed-GOP
 * segments (tmix blends each group of `sub`), reusing cached segments whose pixels are unchanged, then joins them by
 * stream copy. The page is P.pageOpts (bespoke page, variant, cutdown).
 */
export async function renderFormat({ P, format, q, quality = 'draft', base, browser, out, onProgress, cacheDir }) {
  const file = out || join(P.outDir(format), silentName(quality));
  const s = await openPage({ browser, base, project: P.name, format, mode: 'render', ...(P.pageOpts || {}) });
  const t0 = Date.now();
  const cache = openCache(cacheDir || cacheDirOf(P, format));
  const frames = Math.round(s.info.duration * q.fps);
  const plan = segmentPlan(frames, q.fps);
  let r;
  try {
    const settings = await segmentSettings({ W: s.W, H: s.H, q });
    const chrome = s.context.browser() ? s.context.browser().version() : '?';
    const sourceKey = sha([settings, chrome, sourceStamp(P, { format }), +s.info.duration.toFixed(6), !!s.info.loop]);
    r = await renderSegments({ s, q, segs: plan, cache, settings, sourceKey,
      onSegment: onProgress ? (seg) => onProgress({ format, sec: seg.f1 / q.fps, duration: s.info.duration }) : null });
  } catch (e) { throw new Error(`[${format}] render failed: ${e.message}`); }
  finally { await s.close(); }
  await concatSegments({ files: r.keys.map((k) => cache.path(k.key)), out: file });
  cache.idx.films[quality] = { frames, fps: q.fps, sub: q.sub, W: s.W, H: s.H, keys: r.keys.map((k) => k.key) };
  cache.save();
  const meta = await probe(file);
  if (meta.frames !== frames) throw new Error(`[${format}] ${file}: ${meta.frames} frames, expected ${frames}`);
  if (meta.width !== s.W || meta.height !== s.H) throw new Error(`[${format}] ${file}: ${meta.width}x${meta.height}, expected ${s.W}x${s.H}`);
  return { out: file, frames: meta.frames, fps: q.fps, sub: q.sub, duration: s.info.duration, seconds: (Date.now() - t0) / 1000,
    cached: r.cached, segments: plan.length };
}

/**
 * renderStraight({s, q, enc, capture?, onProgress?}) -> frames
 * Every sub-frame of the film in order into one encoder (no segment cache): used by exports that re-render
 * (4k at deviceScaleFactor 2, transparent ProRes). capture(s) returns the PNG of the current frame (default s.shot()).
 */
export async function renderStraight({ s, q, enc, capture, onProgress }) {
  const frames = Math.round(s.info.duration * q.fps);
  const times = subframeTimes(0, frames, q, s.info.duration, s.info.loop), rate = q.fps * q.sub;
  try {
    for (let i = 0; i < times.length; i++) {
      await s.seek(times[i]);
      await enc.write(await (capture ? capture(s) : s.shot()));
      if (onProgress && i % rate === 0) onProgress({ sec: i / rate, duration: s.info.duration });
    }
    await enc.end();
  } catch (e) { enc.abort(); throw e; }
  return frames;
}

/** Run async jobs with a concurrency limit, preserving order of results. */
export async function pool(items, n, fn) {
  const out = new Array(items.length);
  let next = 0;
  const worker = async () => { while (next < items.length) { const i = next++; out[i] = await fn(items[i], i); } };
  await Promise.all(Array.from({ length: Math.max(1, Math.min(n, items.length)) }, worker));
  return out;
}
