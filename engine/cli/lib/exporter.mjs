// exporter.mjs: extra deliverables from a finished format + range renders with a segment cache (v2, owner: export).
// make.mjs calls exportPresets per format after mux when project.exports is set; render.mjs calls renderRange for
// --from/--to. Derived presets transcode the finished film; 4k and prores-alpha re-render the page.
import { join, dirname } from 'node:path';
import { existsSync, readFileSync, writeFileSync, rmSync, mkdirSync, renameSync } from 'node:fs';
import { ffmpeg, encoder, probe, probeAll, loudness, concatSegments } from './ffmpeg.mjs';
import { openPage, launch } from './browser.mjs';
import { startServer } from './server.mjs';
import { sha256File, stamp } from './pipeline.mjs';
import { FORMATS } from '../../layout.js';
import {
  preset as qualityPreset, silentName, segmentPlan, segmentsFor, openCache, renderSegments, segmentSettings,
  sourceStamp, cacheDirOf, renderStraight, SHUTTER,
} from './video.mjs';

/** Preset ids accepted in project.exports (docs/project.schema.json enum). */
export const EXPORT_PRESETS = Object.freeze(['720p', '4k', 'webm', 'gif', 'prores-alpha', 'tiktok', 'reels', 'youtube', 'linkedin']);

/** Bump when an export's encode changes (part of every export stamp). */
const EXPORT_VERSION = 2;

/**
 * Platform deliverables: which formats fit, the frame size, the H.264 bitrate cap (Mbit/s, by fps), the loudness
 * target (integrated LUFS, true peak dBTP) and the platform's length limit. A format that does not fit is skipped.
 */
export const PLATFORMS = Object.freeze({
  tiktok: Object.freeze({ formats: ['9x16'], size: { '9x16': [1080, 1920] }, mbps: { 30: 8, 60: 12 }, lufs: -14, tp: -1, maxSec: 600, maxMB: 1024 }),
  reels: Object.freeze({ formats: ['9x16'], size: { '9x16': [1080, 1920] }, mbps: { 30: 8, 60: 10 }, lufs: -14, tp: -1, maxSec: 180, maxMB: 1024 }),
  youtube: Object.freeze({ formats: ['16x9'], size: { '16x9': [1920, 1080] }, mbps: { 30: 8, 60: 12 }, lufs: -14, tp: -1, maxSec: 43200, maxMB: 262144 }),
  linkedin: Object.freeze({ formats: ['4x5', '1x1'], size: { '4x5': [1080, 1350], '1x1': [1080, 1080] }, mbps: { 30: 8, 60: 10 }, lufs: -14, tp: -1, maxSec: 600, maxMB: 5120 }),
});

/** File extension of a preset's output. */
export const exportExt = (id) => ({ webm: 'webm', gif: 'gif', 'prores-alpha': 'mov' }[id] || 'mp4');

/** Frame size of a derived preset for a format: 720p = short side 720; 4k = the format at 2x (3840 long side). */
export function exportSize(id, format) {
  const { w, h } = FORMATS[format];
  if (id === '720p') { const k = 720 / Math.min(w, h); return [even(w * k), even(h * k)]; }
  if (id === '4k') return [w * 2, h * 2];
  if (id === 'gif') return [540, even(540 * h / w)];
  if (PLATFORMS[id]) return PLATFORMS[id].size[format] || null;
  return [w, h];
}
const even = (x) => 2 * Math.round(x / 2);

/** Does the rendition allow a transparent render? Its `transparent` (project.json or a variant override), else template.json's. */
export const isTransparent = (P) => {
  // the rendition's own setting (project, or a variant override) wins; otherwise the template's
  const own = P.base && typeof P.base.transparent === 'boolean' ? P.base.transparent
    : P.project && typeof P.project.transparent === 'boolean' ? P.project.transparent : undefined;
  return own !== undefined ? own : !!(P.template && P.template.transparent === true);
};

// ---------- page shims (installed with context.addInitScript before the page's own scripts) ----------
/**
 * Transparent canvas. Adds alpha=1 to the page query: the engine runtime handles it natively (it clears the frame
 * background instead of painting it, sets window.__reelcodeAlphaNative and api.alpha), and then this shim stays out of
 * the way, so a template's own full-frame shape in the bg colour is kept. Only for a page that does not handle
 * alpha=1 natively, a full-canvas fillRect in the brand background colour on #c becomes clearRect.
 */
function alphaShim(bg) {
  const u = new URL(location.href);
  if (u.searchParams.get('alpha') !== '1') { u.searchParams.set('alpha', '1'); history.replaceState(null, '', u.toString()); }
  const P = CanvasRenderingContext2D.prototype, fill = P.fillRect;
  P.fillRect = function fillRect(x, y, w, h) {
    const c = this.canvas;
    if (!window.__reelcodeAlphaNative && c && c.id === 'c' && this.globalCompositeOperation === 'source-over' && typeof this.fillStyle === 'string'
      && this.fillStyle.toLowerCase() === bg && x <= 0 && y <= 0 && x + w >= c.width && y + h >= c.height) return this.clearRect(x, y, w, h);
    return fill.call(this, x, y, w, h);
  };
  window.__reelcodeAlphaShim = true;
}

/**
 * High-DPI canvas for re-rendering at deviceScaleFactor > 1: #c keeps its CSS size (= the format) while its bitmap is
 * dpr times larger; every transform is pre-multiplied by dpr (setTransform/resetTransform/getTransform), and the
 * lengths a transform does not scale (shadowBlur, shadowOffset, filter px) are scaled by hand. The page keeps drawing
 * in format pixels, so text and vectors are re-rasterised at 2x instead of upscaled.
 */
function dprShim(dpr) {
  if (!(dpr > 1)) return;
  const main = (c) => c && c.id === 'c';
  const C = HTMLCanvasElement.prototype, X = CanvasRenderingContext2D.prototype;
  const desc = (o, k) => Object.getOwnPropertyDescriptor(o, k);
  const W = desc(C, 'width'), H = desc(C, 'height'), GC = C.getContext;
  const ST = X.setTransform, GT = X.getTransform;
  const scale = (ctx) => ST.call(ctx, dpr, 0, 0, dpr, 0, 0);
  const dim = (D, css) => ({
    configurable: true, enumerable: true,
    get() { return main(this) ? Math.round(D.get.call(this) / dpr) : D.get.call(this); },
    set(v) {
      if (!main(this)) return D.set.call(this, v);
      D.set.call(this, Math.round(v * dpr)); this.style[css] = `${v}px`;
      if (this.__ctx2d) scale(this.__ctx2d);
    },
  });
  Object.defineProperty(C, 'width', dim(W, 'width'));
  Object.defineProperty(C, 'height', dim(H, 'height'));
  C.getContext = function getContext(type, ...rest) {
    const ctx = GC.call(this, type, ...rest);
    if (main(this) && type === '2d' && ctx && !this.__ctx2d) { this.__ctx2d = ctx; scale(ctx); }
    return ctx;
  };
  X.setTransform = function setTransform(a, b, c, d, e, f) {
    if (!main(this.canvas)) return ST.apply(this, arguments);
    const m = typeof a === 'object' && a !== null ? a : { a, b, c, d, e, f };
    const v = [m.a ?? m.m11 ?? 1, m.b ?? m.m12 ?? 0, m.c ?? m.m21 ?? 0, m.d ?? m.m22 ?? 1, m.e ?? m.m41 ?? 0, m.f ?? m.m42 ?? 0];
    return ST.call(this, ...v.map((x) => x * dpr));
  };
  X.resetTransform = function resetTransform() { return main(this.canvas) ? scale(this) : ST.call(this, 1, 0, 0, 1, 0, 0); };
  X.getTransform = function getTransform() {
    const m = GT.call(this);
    return main(this.canvas) ? new DOMMatrix([m.a / dpr, m.b / dpr, m.c / dpr, m.d / dpr, m.e / dpr, m.f / dpr]) : m;
  };
  for (const k of ['shadowBlur', 'shadowOffsetX', 'shadowOffsetY']) {
    const D = desc(X, k);
    Object.defineProperty(X, k, { configurable: true, enumerable: true,
      get() { return main(this.canvas) ? D.get.call(this) / dpr : D.get.call(this); },
      set(v) { D.set.call(this, main(this.canvas) ? v * dpr : v); } });
  }
  const F = desc(X, 'filter');
  if (F) {
    Object.defineProperty(X, 'filter', { configurable: true, enumerable: true, get() { return F.get.call(this); },
      set(v) { F.set.call(this, main(this.canvas) && typeof v === 'string' ? v.replace(/(-?\d*\.?\d+)px/g, (_, n) => `${Number(n) * dpr}px`) : v); } });
  }
  window.__reelcodeDpr = dpr;
}

/** A browser-like object for openPage(): its contexts use deviceScaleFactor dpr and the init scripts given. */
function shimmedBrowser(browser, { dpr = 1, alphaBg = null } = {}) {
  return {
    newContext: async (opts) => {
      const ctx = await browser.newContext({ ...opts, deviceScaleFactor: dpr });
      if (dpr > 1) await ctx.addInitScript(dprShim, dpr);
      if (alphaBg) await ctx.addInitScript(alphaShim, alphaBg.toLowerCase());
      return ctx;
    },
  };
}

/** The exact canvas bitmap (alpha included) as a PNG buffer. */
const canvasPNG = async (s) => Buffer.from((await s.page.evaluate(() => document.getElementById('c').toDataURL('image/png'))).split(',')[1], 'base64');

// ---------- stamps ----------
const stampPath = (file) => join(dirname(file), `.${file.split('/').pop()}.stamp`);
const fresh = (file, want) => existsSync(file) && existsSync(stampPath(file)) && readFileSync(stampPath(file), 'utf8').trim() === want;
const writeStamp = (file, want) => writeFileSync(stampPath(file), `${want}\n`);
const tmpOf = (file) => join(dirname(file), `_tmp-${process.pid}-${file.split('/').pop()}`);

// ---------- derived presets (transcode the finished film) ----------
async function audioArgs(src, target) {
  const has = (await probe(src)).audio;
  if (!has) return { args: ['-an'], note: 'no audio' };
  if (!target) return { args: ['-c:a', 'copy'] };
  const m = await loudness(src);
  if (Number.isFinite(m.I) && Math.abs(m.I - target.lufs) <= 0.5 && m.TP <= target.tp) return { args: ['-c:a', 'aac', '-b:a', '256k', '-ar', '48000'], I: m.I };
  const gain = +(target.lufs - m.I).toFixed(2), lim = Math.pow(10, target.tp / 20).toFixed(4);
  return { args: ['-af', `volume=${gain}dB,alimiter=limit=${lim}:level=false`, '-c:a', 'aac', '-b:a', '256k', '-ar', '48000'], I: m.I, gain };
}

async function derive(id, { src, format, fps, quality, out }) {
  const tmp = tmpOf(out);
  const [w, h] = exportSize(id, format);
  const draft = quality !== 'final';
  try {
    if (id === '720p') {
      const a = await audioArgs(src, null);
      await ffmpeg(['-y', '-loglevel', 'error', '-i', src, '-map', '0:v:0', ...(a.args[0] === '-an' ? [] : ['-map', '0:a:0']),
        '-vf', `scale=${w}:${h}:flags=lanczos`, '-c:v', 'libx264', '-preset', draft ? 'veryfast' : 'slow', '-crf', draft ? '23' : '18',
        '-pix_fmt', 'yuv420p', ...a.args, '-movflags', '+faststart', '-f', 'mp4', tmp]);
    } else if (id === 'webm') {
      const has = (await probe(src)).audio;
      await ffmpeg(['-y', '-loglevel', 'error', '-i', src, '-map', '0:v:0', ...(has ? ['-map', '0:a:0', '-c:a', 'libopus', '-b:a', '160k'] : ['-an']),
        '-c:v', 'libvpx-vp9', '-b:v', '0', '-crf', draft ? '36' : '28', '-row-mt', '1', '-deadline', 'good', '-cpu-used', draft ? '8' : '2',
        '-pix_fmt', 'yuv420p', '-f', 'webm', tmp]);
    } else if (id === 'gif') {
      const g = `fps=12,scale=${w}:-2:flags=lanczos,split[a][b];[a]palettegen=stats_mode=diff[p];[b][p]paletteuse=dither=bayer:bayer_scale=4:diff_mode=rectangle`;
      await ffmpeg(['-y', '-loglevel', 'error', '-i', src, '-filter_complex', g, '-loop', '0', '-f', 'gif', tmp]);
    } else if (PLATFORMS[id]) {
      const p = PLATFORMS[id], mbps = fps > 30 ? p.mbps[60] : p.mbps[30];
      const a = await audioArgs(src, p);
      await ffmpeg(['-y', '-loglevel', 'error', '-i', src, '-map', '0:v:0', ...(a.args[0] === '-an' ? [] : ['-map', '0:a:0']),
        '-vf', `scale=${w}:${h}:flags=lanczos`, '-c:v', 'libx264', '-preset', draft ? 'veryfast' : 'slow', '-profile:v', 'high',
        '-crf', '18', '-maxrate', `${mbps}M`, '-bufsize', `${2 * mbps}M`, '-g', String(Math.round(fps)), '-pix_fmt', 'yuv420p',
        ...a.args, '-movflags', '+faststart', '-f', 'mp4', tmp]);
      renameSync(tmp, out);
      return { gain: a.gain ?? 0, note: a.note };
    } else throw new Error(`derive: unknown preset ${id}`);
    renameSync(tmp, out);
    return {};
  } catch (e) { rmSync(tmp, { force: true }); throw e; }
}

// ---------- re-rendered presets (4k, prores-alpha) ----------
async function rerender(id, { P, format, quality, src, out, env }) {
  const q = qualityPreset(quality);
  const alpha = id === 'prores-alpha';
  const bg = alpha ? P.resolved(format).brand.colors.bg : null;
  const { base, browser } = await env();
  const s = await openPage({ browser: shimmedBrowser(browser, { dpr: alpha ? 1 : 2, alphaBg: bg }), base, project: P.name, format,
    mode: 'render', quiet: true, ...(P.pageOpts || {}) });
  const tmp = tmpOf(out), vtmp = alpha ? tmp : `${tmp}.video.mp4`;
  try {
    const enc = encoder({ out: vtmp, fps: q.fps, sub: q.sub, crf: alpha ? 0 : Math.max(q.crf - 2, 0), preset: q.preset, codec: alpha ? 'prores-alpha' : 'h264' });
    await renderStraight({ s, q, enc, capture: alpha ? canvasPNG : null });
    if (!alpha) {
      const has = src && (await probe(src)).audio;
      if (has) {
        await ffmpeg(['-y', '-loglevel', 'error', '-i', vtmp, '-i', src, '-map', '0:v:0', '-map', '1:a:0', '-c', 'copy', '-movflags', '+faststart', '-f', 'mp4', tmp]);
        rmSync(vtmp, { force: true });
      } else renameSync(vtmp, tmp);
    }
    renameSync(tmp, out);
  } catch (e) { rmSync(tmp, { force: true }); rmSync(vtmp, { force: true }); throw e; } finally { await s.close(); }
  return { frames: Math.round(s.info.duration * q.fps) };
}

/** Check the written file against the preset: decodable, the right size, the right codec. Throws on mismatch. */
export async function verifyExport(id, file, format) {
  const j = await probeAll(file), v = (j.streams || []).find((x) => x.codec_type === 'video');
  if (!v) throw new Error(`${id}: ${file} has no video stream`);
  const want = { webm: 'vp9', gif: 'gif', 'prores-alpha': 'prores' }[id] || 'h264';
  if (v.codec_name !== want) throw new Error(`${id}: codec ${v.codec_name}, expected ${want}`);
  const size = exportSize(id, format);
  if (id !== 'gif' && size && (v.width !== size[0] || v.height !== size[1])) throw new Error(`${id}: ${v.width}x${v.height}, expected ${size.join('x')}`);
  if (id === 'gif' && v.width !== 540) throw new Error(`gif: width ${v.width}, expected 540`);
  if (id === 'prores-alpha' && !/^yuva/.test(v.pix_fmt)) throw new Error(`prores-alpha: pix_fmt ${v.pix_fmt} has no alpha`);
  return { codec: v.codec_name, width: v.width, height: v.height, pix_fmt: v.pix_fmt, duration: Number(j.format.duration), bytes: Number(j.format.size) };
}

/**
 * exportPresets({P, format, video, silent, quality, presets, outDir, log, base?, browser?}) -> Promise<[{preset, file, ...}]>
 * P        loadProject() result for the rendition (P.base, P.outDir(), P.rel)
 * format   '9x16' | '1x1' | '4x5' | '16x9'
 * video    abs path of the muxed film (null when there is no audio yet) ; silent: abs path of the silent video
 * presets  the subset of project.exports to build ; outDir: P.outDir(format) — writes <outDir>/export/<preset>.<ext>
 * Platform presets check the format's aspect and the platform's length/size limits and skip with a warning when the
 * format does not fit. prores-alpha needs transparent: true (template.json or project) and skips otherwise.
 * Each output has a stamp (.<file>.stamp): an unchanged source skips the work. base/browser are optional (a server
 * and chromium are started on demand for the re-rendered presets).
 */
export async function exportPresets({ P, format, video, silent, quality = 'draft', presets, outDir, log = () => {}, base, browser }) {
  if (!P || !FORMATS[format]) throw new Error(`exportPresets: bad format ${format}`);
  const want = [...new Set(presets || [])];
  for (const id of want) if (!EXPORT_PRESETS.includes(id)) throw new Error(`exportPresets: unknown preset "${id}" (use ${EXPORT_PRESETS.join(', ')})`);
  const src = video || silent;
  if (!src || !existsSync(src)) throw new Error(`exportPresets [${format}]: no finished video to export from`);
  const dir = join(outDir || P.outDir(format), 'export');
  mkdirSync(dir, { recursive: true });
  const meta = await probe(src);
  let own = null;
  const env = async () => {
    if (base && browser) return { base, browser };
    if (!own) {
      const srv = await startServer();
      // a failed browser launch must not leave the server listening: it would keep the process alive
      let b; try { b = await launch(); } catch (e) { await srv.close(); throw e; }
      own = { srv, base: srv.base, browser: b };
    }
    return own;
  };
  const done = [];
  try {
    for (const id of want) {
      const file = join(dir, `${id}.${exportExt(id)}`);
      const skip = (why) => { log(`[${format}] warning: export ${id} skipped (${why})`); rmSync(file, { force: true }); rmSync(stampPath(file), { force: true }); };
      const plat = PLATFORMS[id];
      if (plat && !plat.formats.includes(format)) { log(`[${format}] export ${id}: not for ${format} (needs ${plat.formats.join(' or ')})`); continue; }
      if (plat && meta.duration > plat.maxSec + 1e-3) { skip(`${meta.duration.toFixed(1)}s is over the ${id} limit of ${plat.maxSec}s`); continue; }
      if (id === 'prores-alpha' && !isTransparent(P)) { skip('needs transparent: true in template.json or project.json'); continue; }
      if (id === 'prores-alpha' && P.page) { skip('bespoke pages draw their own background'); continue; }
      const rer = id === '4k' || id === 'prores-alpha';
      const key = rer
        ? sourceStamp(P, { export: id, v: EXPORT_VERSION, format, quality, shutter: SHUTTER, audio: video ? sha256File(video) : null })
        : stamp([], { export: id, v: EXPORT_VERSION, format, quality, src: sha256File(src) });
      if (fresh(file, key)) { log(`[${format}] export ${id} up to date (${P.rel(file)})`); done.push({ preset: id, file, cached: true }); continue; }
      rmSync(stampPath(file), { force: true });
      const t0 = Date.now();
      const r = rer ? await rerender(id, { P, format, quality, src: video, out: file, env })
        : await derive(id, { src, format, fps: meta.fps, quality, out: file });
      const info = await verifyExport(id, file, format);
      if (plat && info.bytes > plat.maxMB * 1024 * 1024) log(`[${format}] warning: export ${id} is ${(info.bytes / 1048576).toFixed(0)} MB, over the ${plat.maxMB} MB limit`);
      if (plat && r.note) log(`[${format}] warning: export ${id} has no audio (${r.note})`);
      writeStamp(file, key);
      log(`[${format}] export ${id}: ${P.rel(file)} (${info.width}x${info.height} ${info.codec}${r.gain ? `, audio ${r.gain > 0 ? '+' : ''}${r.gain} dB to ${plat.lufs} LUFS` : ''}, ${((Date.now() - t0) / 1000).toFixed(1)}s)`);
      done.push({ preset: id, file, width: info.width, height: info.height, codec: info.codec });
    }
  } finally {
    if (own) { await own.browser.close(); await own.srv.close(); }
  }
  return done;
}

// ---------- range renders ----------
/**
 * renderRange({P, format, q, quality, base, browser, from, to, out, cacheDir}) -> Promise<{out, full, frames, fps, from, to, cached, rendered}>
 * Renders seconds [from, to) of one format (refs: seconds, or "b3" / "bar2" / "s1.5") with the same sub-frame shutter
 * as renderFormat. The range is widened to whole 1 s segments (closed GOPs), cached under cacheDir (=
 * <P.outDir()>/.cache/<format>/). out (default <fmt>/[draft_]range.mp4) holds just the range. When the cache holds the
 * last full film of this quality, the new segments are spliced into it by stream copy and the full silent video is
 * rewritten (full = its path) — its make stamp is removed, so the next make re-checks every segment.
 */
export async function renderRange({ P, format, q, quality = 'draft', base, browser, from, to, out, cacheDir }) {
  const s = await openPage({ browser, base, project: P.name, format, mode: 'render', quiet: true, ...(P.pageOpts || {}) });
  const cache = openCache(cacheDir || cacheDirOf(P, format));
  const fps = q.fps, D = s.info.duration, frames = Math.round(D * fps);
  let segs, r, t0, t1;
  try {
    const time = (ref) => s.page.evaluate((x) => window.__reelcode.time(x), String(ref));
    t0 = from === undefined ? 0 : await time(from);
    t1 = to === undefined ? D : await time(to);
    if (!(t1 > t0)) throw new Error(`--from ${from ?? 0} (${t0.toFixed(3)}s) must be before --to ${to ?? 'end'} (${t1.toFixed(3)}s)`);
    const plan = segmentPlan(frames, fps);
    segs = segmentsFor(plan, Math.round(t0 * fps), Math.max(Math.round(t0 * fps) + 1, Math.round(t1 * fps)));
    const settings = await segmentSettings({ W: s.W, H: s.H, q });
    r = await renderSegments({ s, q, segs, cache, settings, sourceKey: null });
    const dir = P.outDir(format);
    const file = out || join(dir, `${quality === 'final' ? '' : 'draft_'}range.mp4`);
    await concatSegments({ files: r.keys.map((k) => cache.path(k.key)), out: file });
    cache.idx.range = r.keys.map((k) => k.key);
    const film = cache.idx.films[quality];
    let full = null;
    if (film && film.frames === frames && film.fps === fps && film.sub === q.sub && film.W === s.W && film.H === s.H
      && film.keys.length === plan.length && film.keys.every((k) => cache.has(k))) {
      const keys = film.keys.slice();
      for (const k of r.keys) keys[k.index] = k.key;
      full = join(dir, silentName(quality));
      rmSync(join(dir, `.${silentName(quality)}.stamp`), { force: true });
      await concatSegments({ files: keys.map((k) => cache.path(k)), out: full });
      cache.idx.films[quality] = { ...film, keys };
      const m = await probe(full);
      if (m.frames !== frames) throw new Error(`[${format}] spliced ${full}: ${m.frames} frames, expected ${frames}`);
    }
    cache.save();
    const m = await probe(file);
    const f0 = segs[0].f0, f1 = segs[segs.length - 1].f1;
    if (m.frames !== f1 - f0) throw new Error(`[${format}] ${file}: ${m.frames} frames, expected ${f1 - f0}`);
    return { out: full || file, range: file, full, frames: m.frames, fps, from: f0 / fps, to: f1 / fps, cached: r.cached, rendered: r.rendered };
  } finally { await s.close(); }
}

