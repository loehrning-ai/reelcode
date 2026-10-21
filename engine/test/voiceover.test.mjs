// voice-over + supplied-music fit tests (owner: audio-vo). Line placement on the beat grid, the say / file /
// elevenlabs engines (elevenlabs with an injected fetch: never the network), the ducked voice mix at -14 LUFS,
// and audio.musicStart / audio.fit on a music.py track treated as supplied. About 40 s.
import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { makeGrid } from '../beat.js';
import { placeLines, buildVoiceover, mixVoiceover, synthElevenLabs, ELEVENLABS_ENV, DEFAULT_DUCK_DB } from '../cli/lib/voiceover.mjs';
import { audioPaths, audioSettings, musicStage } from '../cli/lib/audio.mjs';
import { loudness } from '../cli/lib/ffmpeg.mjs';
import { PYTHON } from '../cli/lib/pipeline.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const PY = PYTHON;
const TMP = mkdtempSync(join(tmpdir(), 'reelcode-vo-'));
after(() => rmSync(TMP, { recursive: true, force: true }));
const HAS_SAY = spawnSync('say', ['-v', '?'], { encoding: 'utf8' }).status === 0;
const music = (args) => {
  const r = spawnSync(PY, ['-I', join(ROOT, 'engine/audio/music.py'), ...args.map(String)], { encoding: 'utf8' });
  assert.equal(r.status, 0, r.stdout + r.stderr);
};
const readJ = (f) => JSON.parse(readFileSync(f, 'utf8'));
/** A throwaway project dir + rendition dirs for buildVoiceover (8 s at 120 bpm, nominal grid). */
function proj(name, voiceover, { duration = 8, cut = null } = {}) {
  const dir = join(TMP, name), audio = join(dir, 'audio');
  mkdirSync(audio, { recursive: true });
  const project = { bpm: 120, duration, audio: { voiceover } };
  return { project, dirs: { project: dir, audio, out: join(dir, 'out'), timeline: { duration, cut } } };
}

test('placeLines: at refs snap to 1/16, sequential lines one beat after, overlaps pushed, overruns refused', () => {
  const g = makeGrid({ bpm: 120 }, 8);
  const lines = [{ text: 'a', at: 'bar1' }, { text: 'b' }, { text: 'c', at: 'b9.1' }, { text: 'd', at: 'b9.5' }];
  const r = placeLines(lines, [1.1, 0.4, 0.3, 0.2], g, 8);
  assert.deepEqual(r.items.map((x) => x.start), [2, 3.625, 4.5, 5.375]);
  // b: 'a' ends 3.1s = beat 6.2 -> +1 beat = 7.2 -> up to 7.25 = 3.625s; c: b9.1 -> b9; d: b9.5 overlaps c (ends 4.8s = b9.6) -> b10.75
  assert.equal(r.items[2].beat, 9);
  assert.equal(r.warnings.length, 1); assert.match(r.warnings[0], /line 4 .* overlaps line 3/);
  const first = placeLines([{ text: 'x' }], [0.5], g, 8);
  assert.equal(first.items[0].start, 0.5, 'a first line without at starts on beat 1');
  assert.equal(placeLines([{ text: 'x', at: 's1.3' }], [0.5], g, 8).items[0].start, 1.25, 'seconds refs snap too');
  assert.throws(() => placeLines([{ text: 'too long', at: 'bar3' }], [2.5], g, 8), /ends at 8\.500s, after the film end \(8\.000s\); shorten it/);
  const cut = placeLines([{ text: 'ok' }, { text: 'late', at: 'bar3' }], [0.5, 2.5], g, 8, { drop: true });
  assert.deepEqual(cut.dropped, [1]); assert.match(cut.warnings[0], /dropped in this cutdown/);
  // a measured (non-uniform) grid is honoured
  const mg = makeGrid({ bpm: 120, beats: [0, 0.52, 1.0, 1.5, 2.0, 2.5, 3.0, 3.5] }, 4);
  assert.equal(placeLines([{ text: 'x', at: 1 }], [0.2], mg, 4).items[0].start, 0.52);
});

test('elevenlabs: refuses without the env var (suggests file); with one, an injected fetch is used and the key never leaks', async () => {
  const saved = process.env[ELEVENLABS_ENV];
  try {
    delete process.env[ELEVENLABS_ENV];
    const { project, dirs } = proj('el0', { engine: 'elevenlabs', lines: [{ text: 'Hello.' }] });
    await assert.rejects(buildVoiceover(project, dirs), (e) => e.message.includes(ELEVENLABS_ENV) && /use engine "file"/.test(e.message));
    const secret = 'zz-test-key-not-real';
    process.env[ELEVENLABS_ENV] = secret;
    music(['--style', 'minimal-tech', '--bpm', 120, '--bars', 1, '--out', join(TMP, 'el_tone.wav'), '--beats', join(TMP, 'el_tone.json')]);
    const calls = [];
    const fetchImpl = async (url, init) => {
      calls.push({ url, init });
      const buf = readFileSync(join(TMP, 'el_tone.wav'));
      return { ok: true, status: 200, arrayBuffer: async () => buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.length) };
    };
    const { project: p2, dirs: d2 } = proj('el1', { engine: 'elevenlabs', voice: 'v123', lines: [{ text: 'Hello there.', at: 'bar1' }] });
    const vo = await buildVoiceover(p2, d2, { fetchImpl });
    assert.equal(calls.length, 1);
    assert.match(calls[0].url, /^https:\/\/api\.elevenlabs\.io\/v1\/text-to-speech\/v123\?/);
    assert.equal(calls[0].init.headers['xi-api-key'], secret);
    assert.equal(JSON.parse(calls[0].init.body).text, 'Hello there.');
    assert.equal(vo.segments.length, 1); assert.equal(vo.segments[0].start, 2);
    await buildVoiceover(p2, d2, { fetchImpl });
    assert.equal(calls.length, 1, 'second run is served from audio/.voice-cache');
    const bad = async () => ({ ok: false, status: 401 });
    await assert.rejects(synthElevenLabs('x', 'v', join(TMP, 'el_bad.wav'), { fetchImpl: bad }), (e) => /HTTP 401/.test(e.message) && !e.message.includes(secret));
  } finally {
    if (saved === undefined) delete process.env[ELEVENLABS_ENV]; else process.env[ELEVENLABS_ENV] = saved;
  }
});

test('say: each line synthesized separately, placed on the grid, voiceover.json written, deterministic; ducked mix at -14 LUFS', { skip: !HAS_SAY && 'macOS say not available' }, async () => {
  const lines = [{ text: 'One timeline.', at: 'bar1' }, { text: 'Every frame is seek of t.' }];
  const { project, dirs } = proj('say', { engine: 'say', voice: 'Samantha', lines });
  const vo = await buildVoiceover(project, dirs);
  assert.equal(vo.segments.length, 2);
  assert.equal(vo.segments[0].start, 2);
  assert.ok(vo.segments[0].end > 2.4 && vo.segments[0].end < 4, JSON.stringify(vo.segments));
  const b1 = (vo.segments[0].end / 0.5) + 1;
  assert.equal(vo.segments[1].start, (Math.ceil(b1 * 4 - 1e-6) / 4) * 0.5, 'sequential: one beat after, 1/16 grid');
  assert.deepEqual(readJ(join(dirs.audio, 'voiceover.json')).segments, vo.segments);
  const h1 = readFileSync(vo.wav);
  await buildVoiceover(project, dirs);
  assert.ok(h1.equals(readFileSync(vo.wav)), 'voice.wav is deterministic');
  const bad = proj('sayv', { engine: 'say', voice: 'No Such Voice Zz', lines });
  await assert.rejects(buildVoiceover(bad.project, bad.dirs), /say voice "No Such Voice Zz" is not installed; "say -v \?" lists the installed voices/);

  music(['--style', 'punchy-pop', '--bpm', 120, '--bars', 4, '--out', join(TMP, 'bed_music.wav'), '--beats', join(TMP, 'bed.json')]);
  const mixR = spawnSync(PY, ['-I', join(ROOT, 'engine/audio/mix.py'), '--music', join(TMP, 'bed_music.wav'), '--duration', 8, '--out', join(dirs.audio, 'mix.wav')], { encoding: 'utf8' });
  assert.equal(mixR.status, 0, mixR.stdout);
  const mix = join(dirs.audio, 'mix.wav');
  const r = await mixVoiceover({ mix, voice: vo.wav, segments: vo.segments, duck_db: undefined, lufs: -14, out: mix });
  assert.equal(r.duck_db, DEFAULT_DUCK_DB);
  const m = await loudness(mix);
  assert.ok(Math.abs(m.I + 14) <= 0.5, `I ${m.I}`); assert.ok(m.TP <= -1, `TP ${m.TP}`);
});

test('file: a supplied recording with a segments sidecar, or detected regions paired with lines', async () => {
  const { project, dirs } = proj('file', { engine: 'file', file: 'vo/take1.wav', lines: [{ text: 'first' }, { text: 'second' }] });
  mkdirSync(join(dirs.project, 'vo'), { recursive: true });
  const gen = spawnSync(PY, ['-I', '-c', `
import sys; sys.path.insert(0, ${JSON.stringify(join(ROOT, 'engine/audio'))})
import numpy as np
from common import SR, write_wav
t = np.arange(int(0.8 * SR)) / SR
b = 0.2 * np.sin(2 * np.pi * 300 * t) * (0.6 + 0.4 * np.sin(2 * np.pi * 4 * t))
z = lambda s: np.zeros(int(s * SR))
x = np.r_[z(1.0), b, z(1.2), b[: int(0.5 * SR)], z(1.0)]
write_wav(${JSON.stringify(join(dirs.project, 'vo/take1.wav'))}, np.stack([x, x]))
`], { encoding: 'utf8' });
  assert.equal(gen.status, 0, gen.stderr);
  const vo = await buildVoiceover(project, dirs);
  assert.deepEqual(vo.segments.map((s) => s.text), ['first', 'second']);
  assert.ok(Math.abs(vo.segments[0].start - 1.0) < 0.05 && Math.abs(vo.segments[1].start - 3.0) < 0.06, JSON.stringify(vo.segments));
  writeFileSync(join(dirs.project, 'vo/take1.segments.json'), JSON.stringify({ segments: [{ text: 'exact', start: 1.0, end: 1.8 }, { text: 'two', start: 3.0, end: 3.5 }] }));
  const vo2 = await buildVoiceover(project, dirs);
  assert.deepEqual(vo2.segments, [{ text: 'exact', start: 1, end: 1.8 }, { text: 'two', start: 3, end: 3.5 }]);
  rmSync(join(dirs.project, 'vo/take1.segments.json'));
  project.audio.voiceover.lines = [{ text: 'only one' }];
  await assert.rejects(buildVoiceover(project, dirs), /found 2 speech regions but 1 lines/);
  project.audio.voiceover.file = '../escape.wav';
  await assert.rejects(buildVoiceover(project, dirs), /must be a path inside the project/);
});

test('supplied music: audio.musicStart + audio.fit (trim | loop | fade-bar) fit the film on a bar boundary', async () => {
  const dir = join(TMP, 'sup');
  mkdirSync(join(dir, 'audio'), { recursive: true });
  music(['--style', 'punchy-pop', '--bpm', 120, '--bars', 3, '--seed', 3, '--out', join(dir, 'audio/track.wav'), '--beats', join(TMP, 'sup.json')]);
  const P = (audio, extra = {}) => ({ dir, rel: (p) => p.replace(`${dir}/`, ''), audioDir: join(dir, 'audio', 'r'), base: { bpm: 120, duration: 16, audio: { music: 'audio/track.wav', ...audio }, ...extra } });
  const logs = [], log = (m) => logs.push(m);
  for (const [fit, start] of [['loop', 0], ['fade-bar', 2], ['trim', 2]]) {
    const p = P({ fit, musicStart: start }, fit === 'trim' ? { duration: 2 } : {});
    const A = audioPaths(p), S = audioSettings(p);
    const r = await musicStage(p, A, S, log);
    assert.equal(r.fit.mode, fit); assert.equal(r.fit.start, start);
    const b = readJ(A.beats), want = fit === 'trim' ? 2 : 16;
    assert.equal(b.duration, want); assert.equal(b.beats.length, want * 2);
    assert.equal(makeGrid(b, S.duration).duration, want, 'page grid length == fitted track length');
    assert.ok(!existsSync(join(A.dir, 'track_src_48k.wav')));
  }
  await assert.rejects(musicStage(P({ fit: 'trim' }), audioPaths(P({})), audioSettings(P({ fit: 'trim' })), log), /use audio\.fit "loop"/);
  await assert.rejects(musicStage(P({ fit: 'stretch' }), audioPaths(P({})), audioSettings(P({ fit: 'stretch' })), log), /audio\.fit must be one of "trim", "loop", "fade-bar"/);
  await assert.rejects(musicStage(P({ musicStart: -1 }), audioPaths(P({})), audioSettings(P({ musicStart: -1 })), log), /musicStart must be a number of seconds >= 0/);
  const synth = { dir, rel: (p) => p, audioDir: join(dir, 'audio', 's'), base: { bpm: 120, duration: 8, audio: { fit: 'loop' } } };
  await assert.rejects(musicStage(synth, audioPaths(synth), audioSettings(synth), log), /supplied track only/);
  const mid = P({ fit: 'loop', musicStart: 0.5 });
  await musicStage(mid, audioPaths(mid), audioSettings(mid), log);
  assert.ok(logs.some((m) => /not on a downbeat/.test(m)), logs.join('\n'));
});
