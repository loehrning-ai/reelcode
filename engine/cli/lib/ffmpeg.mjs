// ffmpeg.mjs: quality presets, the streaming frame encoder (sub-frame shutter blend), segment concat, mux, tile, loop3,
// loudness, probe, framemd5, ssim.
import { spawn, execFile } from 'node:child_process';
import { mkdirSync, mkdtempSync, copyFileSync, rmSync, writeFileSync, renameSync, readFileSync } from 'node:fs';
import { dirname, join, basename, extname } from 'node:path';

export const QUALITY = Object.freeze({
  draft: Object.freeze({ fps: 30, sub: 1, crf: 23, preset: 'veryfast' }),
  final: Object.freeze({ fps: 60, sub: 4, crf: 16, preset: 'slow' }),
});

function run(args, { input } = {}) {
  return new Promise((ok, fail) => {
    const p = execFile('ffmpeg', args, { maxBuffer: 64 * 1024 * 1024 }, (err, stdout, stderr) => {
      if (err) fail(new Error(`ffmpeg failed: ${String(stderr).trim().split('\n').slice(-4).join(' | ')}`));
      else ok({ stdout: String(stdout), stderr: String(stderr) });
    });
    if (input) { p.stdin.end(input); }
  });
}

/** Run ffmpeg with args (resolves {stdout, stderr}; rejects with the last stderr lines). */
export const ffmpeg = (args, opts) => run(args, opts);

let versionP = null;
/** First line of `ffmpeg -version` (part of every segment key: another x264 build encodes other bytes). */
export function ffmpegVersion() {
  if (!versionP) versionP = run(['-hide_banner', '-version']).then((r) => r.stdout.split('\n')[0].trim());
  return versionP;
}

/** MP4 timescale of segments: divisible by every common frame rate (12, 24, 25, 30, 50, 60), so concat is exact. */
export const SEGMENT_TIMESCALE = 90000;

/**
 * The shutter: average each run of `sub` consecutive sub-frames into one output frame (motion blur).
 * tmix averages a sliding window; dropping the first sub-1 frames and then keeping every sub-th one picks exactly the
 * windows that cover sub-frames [k*sub, k*sub + sub - 1], one per output frame k.
 */
export function shutterFilter(sub, fps) {
  const retime = `setpts=N/${fps}/TB`;
  if (!(sub > 1)) return retime;
  return [`tmix=frames=${sub}`, `trim=start_frame=${sub - 1}`, `framestep=step=${sub}`, retime].join(',');
}

/** Video codec arguments for one encode target. */
function codecArgs({ codec, crf, preset, gop }) {
  if (codec === 'prores-alpha') {
    return { video: ['-c:v', 'prores_ks', '-profile:v', '4444', '-pix_fmt', 'yuva444p10le', '-alpha_bits', '16', '-vendor', 'apl0'], container: [] };
  }
  const closedGop = gop > 0
    ? ['-g', String(gop), '-keyint_min', String(gop), '-sc_threshold', '0', '-x264-params', 'open-gop=0', '-video_track_timescale', String(SEGMENT_TIMESCALE)]
    : [];
  return {
    video: ['-c:v', 'libx264', '-preset', preset, '-crf', String(crf), '-pix_fmt', 'yuv420p', ...closedGop],
    container: ['-movflags', '+faststart'],
  };
}

/**
 * Streaming encoder: PNG frames are written one after another into ffmpeg's stdin (png_pipe demuxer) at fps*sub
 * frames per second; sub > 1 blends them through shutterFilter. gop > 0: fixed closed GOPs of `gop` frames (no
 * scene-cut keyframes, no open GOP) and the segment timescale, so separately encoded segments concatenate losslessly
 * (concatSegments). codec 'prores-alpha' writes ProRes 4444 with a 16-bit alpha plane from RGBA PNGs (a .mov).
 */
export function encoder({ out, fps, sub = 1, crf = 23, preset = 'veryfast', gop = 0, codec = 'h264' }) {
  mkdirSync(dirname(out), { recursive: true });
  const input = ['-f', 'png_pipe', '-framerate', String(fps * sub), '-i', 'pipe:0'];
  const { video, container } = codecArgs({ codec, crf, preset, gop });
  const args = ['-y', '-loglevel', 'error', ...input, '-vf', shutterFilter(sub, fps), '-r', String(fps), ...video, ...container, out];
  const ff = spawn('ffmpeg', args, { stdio: ['pipe', 'ignore', 'pipe'] });
  let err = '';
  ff.stderr.on('data', (d) => { err += d; });
  const tail = (n) => err.trim().split('\n').slice(-n).join(' | ');
  const done = new Promise((ok, fail) => ff.on('close', (code) => (code === 0 ? ok() : fail(new Error(`ffmpeg encode exited ${code}: ${tail(3)}`)))));
  done.catch(() => {});
  return {
    write: (buf) => new Promise((ok, fail) => {
      if (ff.exitCode !== null) return fail(new Error(`ffmpeg exited early: ${err.trim()}`));
      if (ff.stdin.write(buf)) ok(); else ff.stdin.once('drain', ok);
    }),
    end: () => { ff.stdin.end(); return done; },
    abort: () => { try { ff.kill('SIGKILL'); } catch { /* already gone */ } },
  };
}

/**
 * Concatenate closed-GOP segments (encoder({gop})) into one MP4 by stream copy (concat demuxer, no re-encode):
 * the decoded frames are exactly the segments' frames, in order.
 */
export async function concatSegments({ files, out }) {
  if (!files.length) throw new Error('concatSegments: no segments');
  mkdirSync(dirname(out), { recursive: true });
  const dir = mkdtempSync(join(dirname(out), '_concat-'));
  try {
    const list = join(dir, 'list.txt');
    writeFileSync(list, files.map((f) => `file '${f.replace(/'/g, "'\\''")}'`).join('\n') + '\n');
    const tmp = join(dir, `out${extname(out) || '.mp4'}`);
    await run(['-y', '-loglevel', 'error', '-f', 'concat', '-safe', '0', '-i', list, '-map', '0:v:0', '-c', 'copy', '-movflags', '+faststart', tmp]);
    renameSync(tmp, out);
    return out;
  } finally { rmSync(dir, { recursive: true, force: true }); }
}

/**
 * Mux video + audio: -c:v copy -c:a aac -b:a 256k, the audio padded with silence (apad) so -shortest always
 * ends on the video. The mix is beat-exact (totalBeats * spb) while the video is round(duration * fps) frames,
 * so the mix can be a few ms shorter than the picture; without apad, -shortest cut the last frames.
 */
export const mux = ({ video, audio, out }) => run(['-y', '-loglevel', 'error', '-i', video, '-i', audio,
  '-map', '0:v:0', '-map', '1:a:0', '-c:v', 'copy', '-af', 'apad', '-c:a', 'aac', '-b:a', '256k', '-shortest', '-movflags', '+faststart', out]);

/** [w, h] of a PNG file (IHDR). */
const pngInfo = (f) => {
  const b = readFileSync(f), deep = b[24] === 16, alpha = b[25] === 6 || b[25] === 4;
  return { w: b.readUInt32BE(16), h: b.readUInt32BE(20), pix: alpha ? (deep ? 'rgba64be' : 'rgba') : (deep ? 'rgb48be' : 'rgb24') };
};

/**
 * Tile frames (PNG paths, row-major) into one PNG of cols x rows tiles of width x height each. Grid slots after the
 * last frame get a grey checkerboard ("no frame here"), never black, so a short last row cannot read as black frames
 * at the end of the film.
 */
export async function tile({ frames, cols, width, height, out }) {
  if (!frames.length) throw new Error('tile: no frames');
  mkdirSync(dirname(out), { recursive: true });
  const dir = mkdtempSync(join(dirname(out), '_tile-'));
  try {
    frames.forEach((f, i) => copyFileSync(f, join(dir, `${String(i).padStart(4, '0')}.png`)));
    const c = Math.max(1, Math.min(cols, frames.length)), rows = Math.ceil(frames.length / c);
    const empty = c * rows - frames.length;
    if (empty > 0) {
      // same size and pixel format as the frames (a format change mid-sequence would reset the tile filter)
      const { w, h, pix } = pngInfo(frames[0]), sq = Math.max(8, Math.round(Math.min(w, h) / 9));
      const blank = join(dir, 'empty.png');
      await run(['-y', '-loglevel', 'error', '-f', 'lavfi', '-i', `color=c=gray:s=${w}x${h}:d=1`, '-vf',
        `format=rgb24,geq=r='if(mod(floor(X/${sq})+floor(Y/${sq}),2),150,104)':g='if(mod(floor(X/${sq})+floor(Y/${sq}),2),150,104)':b='if(mod(floor(X/${sq})+floor(Y/${sq}),2),150,104)'`,
        '-pix_fmt', pix, '-frames:v', '1', '-update', '1', blank]);
      for (let k = 0; k < empty; k++) copyFileSync(blank, join(dir, `${String(frames.length + k).padStart(4, '0')}.png`));
      rmSync(blank, { force: true });
    }
    const scale = width && height ? `scale=${width}:${height}:flags=lanczos,` : width ? `scale=${width}:-2:flags=lanczos,` : '';
    await run(['-y', '-loglevel', 'error', '-framerate', '1', '-i', join(dir, '%04d.png'), '-vf', `${scale}tile=${c}x${rows}`, '-frames:v', '1', '-update', '1', out]);
    return { out, cols: c, rows };
  } finally { rmSync(dir, { recursive: true, force: true }); }
}

/** Any supplied audio file -> 48 kHz stereo PCM_24 WAV (what the audio CLIs read). */
export const toWav48 = ({ input, out }) => run(['-y', '-loglevel', 'error', '-i', input, '-vn', '-ar', '48000', '-ac', '2', '-c:a', 'pcm_s24le', out]);

/** The film three times back to back, stream copied. */
export const loop3 = ({ input, out }) => run(['-y', '-loglevel', 'error', '-stream_loop', '2', '-i', input, '-c', 'copy', '-movflags', '+faststart', out]);

/** Integrated loudness, true peak and LRA via ebur128=peak=true. */
export async function loudness(file) {
  const { stderr } = await run(['-hide_banner', '-nostats', '-i', file, '-filter_complex', 'ebur128=peak=true', '-f', 'null', '-']);
  const tail = stderr.slice(stderr.lastIndexOf('Summary:'));
  const num = (re) => { const m = re.exec(tail); return m ? Number(m[1]) : NaN; };
  return { I: num(/I:\s+(-?[\d.]+) LUFS/), TP: num(/Peak:\s+(-?[\d.]+) dBFS/), LRA: num(/LRA:\s+(-?[\d.]+) LU/) };
}

/** ffprobe a video: {frames, width, height, fps, duration, audio:boolean} */
export function probe(file) {
  return new Promise((ok, fail) => execFile('ffprobe', ['-v', 'error', '-count_frames', '-show_entries',
    'stream=codec_type,width,height,nb_read_frames,r_frame_rate:format=duration', '-of', 'json', file], (err, stdout) => {
    if (err) return fail(new Error(`ffprobe ${basename(file)}: ${err.message}`));
    const j = JSON.parse(stdout), v = (j.streams || []).find((s) => s.codec_type === 'video') || {};
    const [n, d] = String(v.r_frame_rate || '0/1').split('/').map(Number);
    ok({ frames: Number(v.nb_read_frames), width: v.width, height: v.height, fps: d ? n / d : 0,
      duration: Number(j.format && j.format.duration), audio: (j.streams || []).some((s) => s.codec_type === 'audio') });
  }));
}

/** Per-frame MD5 lines of raw RGBA frames decoded from a list of PNG buffers (render-twice check). */
export async function framemd5(pngs) {
  const { stdout } = await run(['-loglevel', 'error', '-f', 'image2pipe', '-framerate', '30', '-i', '-', '-f', 'framemd5', '-pix_fmt', 'rgba', '-'], { input: Buffer.concat(pngs) });
  return stdout.split('\n').filter((l) => l && !l.startsWith('#')).map((l) => l.split(',').pop().trim());
}

/** Per-frame MD5s of a video file's decoded frames (framemd5 muxer; identical decodes give identical lists). */
export async function framemd5File(file, { pixFmt } = {}) {
  const { stdout } = await run(['-loglevel', 'error', '-i', file, '-map', '0:v:0', ...(pixFmt ? ['-pix_fmt', pixFmt] : []), '-f', 'framemd5', '-']);
  return stdout.split('\n').filter((l) => l && !l.startsWith('#')).map((l) => l.split(',').pop().trim());
}

/**
 * ssim({a, b, frameA, frameB}) -> All SSIM between frame frameA of video a and frame frameB of video b
 * (frame indices; the two frames are decoded once each, so the result does not depend on timestamps).
 */
export async function ssim({ a, b, frameA = 0, frameB = 0 }) {
  const pick = (n) => `select='eq(n\\,${n})',setpts=PTS-STARTPTS`;
  const { stderr } = await run(['-hide_banner', '-nostats', '-i', a, '-i', b, '-filter_complex',
    `[0:v]${pick(frameA)}[x];[1:v]${pick(frameB)}[y];[x][y]ssim`, '-frames:v', '1', '-f', 'null', '-']);
  const m = /All:([\d.]+)/.exec(stderr);
  if (!m) throw new Error(`ssim: no result (${stderr.trim().split('\n').slice(-2).join(' | ')})`);
  return Number(m[1]);
}

/** ffprobe streams + format of any media file: {format:{duration,size,format_name,bit_rate}, streams:[...]} */
export function probeAll(file) {
  return new Promise((ok, fail) => execFile('ffprobe', ['-v', 'error', '-show_entries',
    'stream=codec_type,codec_name,profile,width,height,pix_fmt,r_frame_rate,nb_frames,sample_rate,channels:format=duration,size,format_name,bit_rate',
    '-of', 'json', file], (err, stdout) => {
    if (err) return fail(new Error(`ffprobe ${basename(file)}: ${err.message}`));
    try { ok(JSON.parse(stdout)); } catch (e) { fail(new Error(`ffprobe ${basename(file)}: bad JSON (${e.message})`)); }
  }));
}
