// clips.mjs: pre-extract local video clips to PNG sequences so the page can seek them deterministically
// (v2 interface; owner: media). make.mjs calls prepareClips before lint and render when project.clips is non-empty.
// The page never touches a <video>: engine/media.js loadClips() preloads these PNGs and frameAt(sec) picks one.
//
// Standalone: node engine/cli/lib/clips.mjs projects/<name>   (prepares every clip; prints one line per clip)
import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createReadStream, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync, realpathSync } from 'node:fs';
import { join, resolve, sep, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

/** Bump when the extraction recipe changes (it is part of the cache key). */
export const CLIP_RECIPE = 1;
export const CLIP_DEFAULTS = Object.freeze({ fps: 30, maxWidth: 1280 });
const ID = /^[a-z0-9_][a-z0-9_-]{0,63}$/;
const VIDEO = /\.(mp4|m4v|mov|webm|mkv|avi)$/i;
const PATTERN = '%05d.png';

const run = (cmd, args) => new Promise((ok, fail) => execFile(cmd, args, { maxBuffer: 64 * 1024 * 1024 }, (err, stdout, stderr) => {
  if (err) fail(new Error(`${cmd} failed: ${String(stderr || err.message).trim().split('\n').slice(-3).join(' | ')}`));
  else ok(String(stdout));
}));

/** sha256 of a file, streamed (clips can be large). */
export function sha256Of(file) {
  return new Promise((ok, fail) => {
    const h = createHash('sha256');
    createReadStream(file).on('error', fail).on('data', (d) => h.update(d)).on('end', () => ok(h.digest('hex')));
  });
}

/** ffprobe -> {w, h, duration, fps} of the first video stream. */
export async function probeVideo(src) {
  const out = await run('ffprobe', ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=width,height,r_frame_rate:format=duration', '-of', 'json', src]);
  const j = JSON.parse(out), s = (j.streams || [])[0];
  if (!s) throw new Error(`clips: ${src} has no video stream`);
  const [n, d] = String(s.r_frame_rate || '0/1').split('/').map(Number);
  return { w: s.width, h: s.height, duration: Number(j.format && j.format.duration), fps: d ? n / d : 0 };
}

/** Frames in [from, to) at fps: the count extractClip produces (and checks). */
export const frameCount = (from, to, fps) => Math.max(1, Math.round((to - from) * fps));

/**
 * The extraction parameters with defaults applied and checked -> {from, to, fps, width}.
 * meta = probeVideo(src). width is even and never upscales past the source.
 */
export function clipParams({ from = 0, to, fps = CLIP_DEFAULTS.fps, width }, meta) {
  const dur = meta.duration;
  const end = to === undefined ? dur : to;
  if (!(Number.isFinite(from) && from >= 0)) throw new Error(`clips: from must be a number >= 0 (got ${from})`);
  if (!(Number.isFinite(end) && end > from)) throw new Error(`clips: to (${end}) must be greater than from (${from})`);
  if (Number.isFinite(dur) && end > dur + 1e-3) throw new Error(`clips: to (${end}s) is past the end of the clip (${dur.toFixed(3)}s)`);
  if (!(Number.isInteger(fps) && fps >= 1 && fps <= 120)) throw new Error(`clips: fps must be an integer 1..120 (got ${fps})`);
  let w = width === undefined ? Math.min(meta.w, CLIP_DEFAULTS.maxWidth) : width;
  if (!(Number.isInteger(w) && w >= 16 && w <= 3840)) throw new Error(`clips: width must be an integer 16..3840 (got ${width})`);
  w = Math.min(w, meta.w);
  w -= w % 2;
  return { from, to: end, fps, width: w };
}

/** Cache key: source bytes + the parameters + the recipe (+ ffmpeg's major version, which decides the pixels). */
export const clipKey = ({ sha, from, to, fps, width, ffmpeg }) =>
  createHash('sha256').update(JSON.stringify({ sha, from, to, fps, width, ffmpeg, recipe: CLIP_RECIPE })).digest('hex');

let ffVersion = null;
async function ffmpegVersion() {
  if (ffVersion === null) {
    const out = await run('ffmpeg', ['-version']);
    const m = /ffmpeg version (\S+)/.exec(out);
    ffVersion = m ? m[1].split('.')[0] : 'unknown';
  }
  return ffVersion;
}

const pngs = (dir) => (existsSync(dir) ? readdirSync(dir).filter((f) => /^\d{5}\.png$/.test(f)).sort() : []);
const readJSON = (f) => { try { return JSON.parse(readFileSync(f, 'utf8')); } catch { return null; } };

/**
 * extractClip({src, outDir, fps, from, to, width}) -> Promise<{dir, pattern, frames, fps, w, h, from, to, key, cached}>
 * ffmpeg-decodes src (a local file; never a URL) from `from` to `to` seconds at `fps` into outDir/%05d.png (00000 = the
 * frame at `from`) and writes outDir/clip.json {fps, frames, w, h, pattern, src, from, to, key}. The trim is done in the
 * filter graph (decode everything, keep [from, to)), so the first frame is exact, not the nearest keyframe.
 * Idempotent: skips when clip.json's key (sha256 of src + params + recipe + ffmpeg major) matches and every frame exists.
 */
export async function extractClip({ src, outDir, fps, from, to, width }) {
  if (typeof src !== 'string' || /^[a-z][a-z0-9+.-]*:/i.test(src)) throw new Error(`clips: src must be a local file path (got ${JSON.stringify(src)})`);
  if (!existsSync(src) || !statSync(src).isFile()) throw new Error(`clips: ${src} not found`);
  if (!VIDEO.test(src)) throw new Error(`clips: ${src} is not a video file (${VIDEO.source})`);
  if (typeof outDir !== 'string' || !outDir) throw new Error('clips: outDir is required');
  const meta = await probeVideo(src);
  const p = clipParams({ from, to, fps, width }, meta);
  const sha = await sha256Of(src);
  const key = clipKey({ sha, ...p, ffmpeg: await ffmpegVersion() });
  const want = frameCount(p.from, p.to, p.fps);
  const jsonFile = join(outDir, 'clip.json');
  const old = readJSON(jsonFile);
  if (old && old.key === key && old.frames === want && pngs(outDir).length === want) return { ...old, dir: outDir, cached: true };

  // Only this clip's own outputs are removed (the folder belongs to it).
  mkdirSync(outDir, { recursive: true });
  for (const f of pngs(outDir)) rmSync(join(outDir, f));
  rmSync(jsonFile, { force: true });
  const vf = `trim=start=${p.from}:end=${p.to},setpts=PTS-STARTPTS,fps=${p.fps}:start_time=0:round=near,scale=${p.width}:-2:flags=lanczos,format=rgb24`;
  await run('ffmpeg', ['-y', '-loglevel', 'error', '-nostdin', '-i', src, '-an', '-vf', vf, '-frames:v', String(want),
    '-start_number', '0', '-fps_mode', 'passthrough', join(outDir, PATTERN)]);
  let files = pngs(outDir);
  // fps rounding can leave the last frame out of [from, to): hold the last decoded frame so the count is exact.
  if (files.length && files.length < want) {
    const last = readFileSync(join(outDir, files[files.length - 1]));
    for (let i = files.length; i < want; i++) writeFileSync(join(outDir, `${String(i).padStart(5, '0')}.png`), last);
    files = pngs(outDir);
  }
  if (files.length !== want) throw new Error(`clips: extracted ${files.length} frames from ${src}, expected ${want}`);
  const first = readFileSync(join(outDir, files[0]));
  const w = first.readUInt32BE(16), h = first.readUInt32BE(20);
  const info = { fps: p.fps, frames: want, w, h, pattern: PATTERN, src: relative(outDir, src).split(sep).join('/'), from: p.from, to: p.to, key };
  writeFileSync(jsonFile, JSON.stringify(info, null, 2) + '\n');
  return { ...info, dir: outDir, cached: false };
}

/** Check one project.clips entry -> {src (absolute), from, to, fps, width}. Paths must stay inside the project. */
export function clipSpec(projectDir, id, c) {
  if (!ID.test(id)) throw new Error(`clips: id "${id}" must match ${ID}`);
  if (!c || typeof c !== 'object' || Array.isArray(c)) throw new Error(`clips.${id}: must be an object {src, from?, to?, fps?, width?}`);
  const extra = Object.keys(c).filter((k) => !['src', 'from', 'to', 'fps', 'width'].includes(k));
  if (extra.length) throw new Error(`clips.${id}: unknown key(s) ${extra.join(', ')} (use src, from, to, fps, width)`);
  if (typeof c.src !== 'string' || !c.src) throw new Error(`clips.${id}.src: a project-relative video path is required`);
  if (/^[a-z][a-z0-9+.-]*:/i.test(c.src) || c.src.startsWith('/')) throw new Error(`clips.${id}.src: must be a project-relative path, not ${c.src}`);
  const dir = resolve(projectDir), src = resolve(dir, c.src);
  if (!src.startsWith(dir + sep)) throw new Error(`clips.${id}.src: ${c.src} must be inside the project folder`);
  if (!existsSync(src)) throw new Error(`clips.${id}.src: ${c.src} not found`);
  if (!realpathSync(src).startsWith(realpathSync(dir) + sep)) throw new Error(`clips.${id}.src: ${c.src} resolves outside the project folder`);
  if (src.startsWith(join(dir, 'assets', 'clips') + sep)) throw new Error(`clips.${id}.src: assets/clips/ is the extraction cache; keep sources elsewhere (e.g. assets/)`);
  return { src, from: c.from, to: c.to, fps: c.fps, width: c.width };
}

/**
 * prepareClips(P, {log}) -> Promise<{[id]: clip.json}>
 * Every entry of P.base.clips {id: {src: 'assets/x.webm', from, to, fps, width}} -> <project>/assets/clips/<id>/.
 * (assets/** is part of the video stamp, so new frames re-render the video; unchanged clips are left untouched.)
 */
export async function prepareClips(P, { log } = {}) {
  if (!P || typeof P.dir !== 'string') throw new Error('clips: prepareClips needs a loaded project (P.dir)');
  const clips = (P.base && P.base.clips) || {};
  const out = {};
  for (const [id, c] of Object.entries(clips)) {
    const spec = clipSpec(P.dir, id, c);
    let r;
    try { r = await extractClip({ ...spec, outDir: join(P.dir, 'assets', 'clips', id) }); }
    catch (e) { throw new Error(`clips.${id}: ${e.message.replace(/^clips: /, '')}`); }
    const { dir, cached, ...info } = r;
    out[id] = info;
    if (log) log(`clips: ${id} ${cached ? 'up to date' : 'extracted'} (${info.frames} frames ${info.w}x${info.h} @ ${info.fps}fps, ${info.from}-${info.to}s of ${c.src})`);
  }
  return out;
}

// ---------- standalone ----------
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const { loadProject } = await import('./project.mjs');
  try {
    const arg = process.argv[2];
    if (!arg) throw new Error('usage: node engine/cli/lib/clips.mjs projects/<name>');
    const P = loadProject(arg);
    const r = await prepareClips(P, { log: (m) => console.log(m) });
    if (!Object.keys(r).length) console.log('clips: project.clips is empty');
  } catch (e) { console.error(`error: ${e.message}`); process.exit(1); }
}
