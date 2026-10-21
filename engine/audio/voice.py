"""Voice-over helpers for engine/cli/lib/voiceover.mjs (docs/SPEC.md §6.6, voice-over).

  voice.py prep    --in a.wav [b.wav ...] --out-dir DIR [--lufs -18]
      Per synthesized line (48 kHz stereo): trim leading/trailing silence so a
      segment's start/end are the real speech edges, level each line to --lufs
      (peak-normalise lines too short to gate), write DIR/<basename>.
      Summary: {"ok":true,"lines":[{"file","duration","trim_head","trim_tail"}]}
  voice.py place   --plan plan.json --duration S --out voice.wav
      plan.json = {"items":[{"file","start","text"}]}. Places each line at its
      start (rounded to the sample) in a film-length stereo track; refuses
      overlaps and overruns. Summary: {"ok":true,"segments":[{text,start,end}]}
  voice.py regions --in voice48.wav [--gap 0.35] [--min 0.15]
      Speech regions of a supplied recording: {"ok":true,"regions":[[s,e],...]}
  voice.py fit     --in voice48.wav --duration S --out voice.wav
      Pad/trim a supplied recording to film length (refuses speech past the end).
  voice.py mix     --mix mix.wav --voice voice.wav --segments segs.json
                   [--duck-db -9] [--lufs -14] [--tp -1] [--lift 1] [--loop] --out mix.wav
      Ducks the music+sfx bed under every segment with ffmpeg sidechaincompress,
      keyed by a deterministic segment envelope (80 ms attack before the line,
      250 ms release after it) so the duck depth is exactly --duck-db; sets the
      voice to (bed LUFS + --lift) and masters the sum like mix.py (premaster,
      two-pass loudnorm, ebur128 trim): I = --lufs +-0.5, TP <= --tp.
      --out may equal --mix (replaced in place).

Every subcommand prints one JSON line and exits 0, or {"ok":false,...} and 1.
"""
import argparse
import os
import subprocess
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import numpy as np  # noqa: E402
from scipy.ndimage import maximum_filter1d  # noqa: E402

from common import (SR, ebur128, emit, ffmpeg_bin, fail, lufs, read_json,  # noqa: E402
                    read_wav, run_main, true_peak_db, write_wav)
from mix import TOL_LU, master_to, seam_check  # noqa: E402

RATIO = 20.0          # sidechaincompress ratio; threshold is derived from duck_db
ATTACK_S = 0.08       # duck lead-in before a line starts
RELEASE_S = 0.25      # duck recovery after a line ends
SILENCE_DB = -45.0    # below the line's peak: silence for trimming / regions
PAD_S = 1.0          # sidechain inputs run this far past the film (see sidechain_duck)
HEAD_PAD_S = 0.015
TAIL_PAD_S = 0.040


def _env_db(mono, win_s=0.010):
    """Peak envelope (dBFS) over a sliding window."""
    w = max(1, int(win_s * SR))
    env = maximum_filter1d(np.abs(mono), size=w)
    return 20 * np.log10(np.maximum(env, 1e-9))


def speech_bounds(x):
    """(first, last) sample of speech in x [2, n], or None when silent."""
    mono = np.abs(x).max(axis=0)
    peak = float(mono.max()) if mono.size else 0.0
    if peak <= 1e-6:
        return None
    on = np.flatnonzero(_env_db(mono) > 20 * np.log10(peak) + SILENCE_DB)
    return (int(on[0]), int(on[-1])) if on.size else None


def prep_line(x, target_lufs):
    b = speech_bounds(x)
    if b is None:
        raise RuntimeError("line is silent")
    a = max(0, b[0] - int(HEAD_PAD_S * SR))
    e = min(x.shape[1], b[1] + int(TAIL_PAD_S * SR))
    y = x[:, a:e].copy()
    f = min(int(0.005 * SR), y.shape[1] // 4)
    if f > 0:
        y[:, :f] *= np.linspace(0, 1, f)
        y[:, -f:] *= np.linspace(1, 0, f)
    I = lufs(y)
    if I > -69:
        y = y * 10 ** ((target_lufs - I) / 20)
    else:
        y = y * (10 ** (-6 / 20) / max(float(np.max(np.abs(y))), 1e-9))
    tp = true_peak_db(y)
    if tp > -3:
        y = y * 10 ** ((-3 - tp) / 20)
    return y, a, x.shape[1] - e


def cmd_prep(a):
    os.makedirs(a.out_dir, exist_ok=True)
    out = []
    for p in a.inp:
        y, head, tail = prep_line(read_wav(p), a.lufs)
        dst = os.path.join(a.out_dir, os.path.basename(p))
        write_wav(dst, y)
        out.append({"file": os.path.abspath(dst), "duration": round(y.shape[1] / SR, 6),
                    "samples": int(y.shape[1]), "trim_head": round(head / SR, 4),
                    "trim_tail": round(tail / SR, 4)})
    emit({"ok": True, "lines": out})


def cmd_place(a):
    plan = read_json(a.plan)
    n = int(round(a.duration * SR))
    buf = np.zeros((2, n))
    segs, prev_end = [], -1
    for i, it in enumerate(plan.get("items", [])):
        y = read_wav(it["file"])
        s = int(round(float(it["start"]) * SR))
        e = s + y.shape[1]
        if s < 0 or e > n:
            raise RuntimeError(f"line {i + 1} [{s / SR:.3f}, {e / SR:.3f}] s is outside the film (0..{a.duration:.3f} s)")
        if s < prev_end:
            raise RuntimeError(f"line {i + 1} starts at {s / SR:.3f} s, before line {i} ends ({prev_end / SR:.3f} s)")
        buf[:, s:e] += y
        prev_end = e
        segs.append({"text": it.get("text", ""), "start": round(s / SR, 6), "end": round(e / SR, 6)})
    write_wav(a.out, buf)
    emit({"ok": True, "out": os.path.abspath(a.out), "segments": segs, "duration": round(n / SR, 6)})


def regions(x, gap=0.35, min_len=0.15):
    mono = np.abs(x).max(axis=0)
    peak = float(mono.max()) if mono.size else 0.0
    if peak <= 1e-6:
        return []
    on = _env_db(mono, 0.02) > 20 * np.log10(peak) + SILENCE_DB
    idx = np.flatnonzero(np.diff(np.r_[0, on.astype(np.int8), 0]))
    runs = [[int(s), int(e)] for s, e in zip(idx[::2], idx[1::2])]
    merged = []
    for s, e in runs:
        if merged and s - merged[-1][1] < gap * SR:
            merged[-1][1] = e
        else:
            merged.append([s, e])
    return [[round(s / SR, 4), round(e / SR, 4)] for s, e in merged if e - s >= min_len * SR]


def cmd_regions(a):
    emit({"ok": True, "regions": regions(read_wav(a.inp), a.gap, a.min)})


def cmd_fit(a):
    x = read_wav(a.inp)
    n = int(round(a.duration * SR))
    if x.shape[1] > n:
        b = speech_bounds(x)
        if b and b[1] >= n:
            raise RuntimeError(f"the recording has speech until {b[1] / SR:.3f} s, after the film end ({a.duration:.3f} s)")
        x = x[:, :n]
    elif x.shape[1] < n:
        x = np.concatenate([x, np.zeros((2, n - x.shape[1]))], axis=1)
    write_wav(a.out, x)
    emit({"ok": True, "out": os.path.abspath(a.out), "duration": round(n / SR, 6)})


def duck_key(n, segments, loop=False):
    """Sidechain key: 1.0 under every segment (raised-cosine attack/release), else 0."""
    key = np.zeros(n)
    att, rel = int(ATTACK_S * SR), int(RELEASE_S * SR)
    up = 0.5 - 0.5 * np.cos(np.linspace(0, np.pi, att))
    down = up[::-1] if rel == att else 0.5 + 0.5 * np.cos(np.linspace(0, np.pi, rel))
    for sg in segments:
        s, e = int(round(float(sg["start"]) * SR)), int(round(float(sg["end"]) * SR))
        shape = np.r_[up, np.ones(max(0, e - s)), down]
        idx = np.arange(shape.size) + s - att
        if loop:
            idx = idx % n
            key[idx] = np.maximum(key[idx], shape)
        else:
            keep = (idx >= 0) & (idx < n)
            key[idx[keep]] = np.maximum(key[idx[keep]], shape[keep])
    return key


def sidechain_duck(bed, key, duck_db, work):
    """ffmpeg sidechaincompress keyed by `key`; gain reduction is exactly duck_db where key == 1.
    bed [2, n], key [n] -> ducked [2, n]. Both inputs run PAD_S past the film: the filter's final block
    depends on which input reaches EOF first, so it must fall outside the samples we keep (determinism)."""
    n = bed.shape[1]
    if duck_db >= -0.01:
        return bed.copy()
    thr = 10 ** (duck_db / (1 - 1 / RATIO) / 20)
    bp, kp, op = work + ".bed.wav", work + ".key.wav", work + ".ducked.wav"
    pad = int(PAD_S * SR)
    k = np.r_[key, np.zeros(pad)]
    write_wav(bp, np.concatenate([bed, np.zeros((2, pad))], axis=1), subtype="FLOAT")
    write_wav(kp, np.stack([k, k]), subtype="FLOAT")
    try:
        f = (f"[0:a][1:a]sidechaincompress=threshold={thr:.8f}:ratio={RATIO:g}:attack=5:release=60"
             ":knee=1:makeup=1:mix=1:detection=peak:level_sc=1[o]")
        p = subprocess.run([ffmpeg_bin(), "-y", "-hide_banner", "-loglevel", "error", "-threads", "1",
                            "-i", bp, "-i", kp, "-filter_complex", f, "-map", "[o]", "-ar", str(SR), "-ac", "2",
                            "-c:a", "pcm_f32le", op], capture_output=True, text=True)
        if p.returncode:
            raise RuntimeError(f"sidechaincompress failed: {p.stderr[-300:]}")
        out = read_wav(op)
        if out.shape[1] < n:
            raise RuntimeError(f"sidechaincompress returned {out.shape[1]} samples, expected >= {n}")
        return out[:, :n]
    finally:
        for q in (bp, kp, op):
            if os.path.exists(q):
                os.remove(q)


def _fit(x, n):
    if x.shape[1] >= n:
        return x[:, :n]
    return np.concatenate([x, np.zeros((2, n - x.shape[1]))], axis=1)


def cmd_mix(a):
    for p in (a.mix, a.voice, a.segments):
        if not os.path.isfile(p):
            fail(f"missing input {p}")
    bed = read_wav(a.mix)
    n = bed.shape[1]
    voice = _fit(read_wav(a.voice), n)
    doc = read_json(a.segments)
    segs = doc["segments"] if isinstance(doc, dict) else doc
    bed_I = lufs(bed)
    ducked = sidechain_duck(bed, duck_key(n, segs, a.loop), a.duck_db, a.out)
    v_I = lufs(voice)
    if v_I <= -69:
        raise RuntimeError("voice track is silent")
    voice_gain_db = (bed_I + a.lift) - v_I
    x = ducked + voice * 10 ** (voice_gain_db / 20)
    meas, ln, pre, trim = master_to(x, a.out, a.lufs, a.tp)
    seam_ok, seam_step, p99 = seam_check(a.out) if a.loop else (None, None, None)
    ok = abs(meas["I"] - a.lufs) <= TOL_LU and meas["TP"] <= a.tp and (seam_ok is not False)
    summary = {"ok": ok, "out": os.path.abspath(a.out), "I": meas["I"], "TP": meas["TP"],
               "LRA": meas["LRA"], "duck_db": a.duck_db, "segments": len(segs),
               "voice_gain_db": round(voice_gain_db, 2), "bed_I": round(bed_I, 2),
               "seam_ok": seam_ok, "seam_step": seam_step, "p99_step": p99,
               "premaster": pre, "loudnorm": ln, "trim_db": trim}
    if not ok:
        fail("voice mix loudness/peak/seam verification failed", **summary)
    emit(summary)


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = ap.add_subparsers(dest="cmd", required=True)
    p = sub.add_parser("prep")
    p.add_argument("--in", dest="inp", nargs="+", required=True)
    p.add_argument("--out-dir", required=True)
    p.add_argument("--lufs", type=float, default=-18.0)
    p = sub.add_parser("place")
    p.add_argument("--plan", required=True)
    p.add_argument("--duration", type=float, required=True)
    p.add_argument("--out", required=True)
    p = sub.add_parser("regions")
    p.add_argument("--in", dest="inp", required=True)
    p.add_argument("--gap", type=float, default=0.35)
    p.add_argument("--min", type=float, default=0.15)
    p = sub.add_parser("fit")
    p.add_argument("--in", dest="inp", required=True)
    p.add_argument("--duration", type=float, required=True)
    p.add_argument("--out", required=True)
    p = sub.add_parser("mix")
    p.add_argument("--mix", required=True)
    p.add_argument("--voice", required=True)
    p.add_argument("--segments", required=True)
    p.add_argument("--duck-db", type=float, default=-9.0)
    p.add_argument("--lufs", type=float, default=-14.0)
    p.add_argument("--tp", type=float, default=-1.0)
    p.add_argument("--lift", type=float, default=1.0)
    p.add_argument("--loop", action="store_true")
    p.add_argument("--out", required=True)
    a = ap.parse_args()
    if a.cmd == "mix" and not (-40 <= a.duck_db <= 0):
        fail("--duck-db must be in [-40, 0]")
    {"prep": cmd_prep, "place": cmd_place, "regions": cmd_regions, "fit": cmd_fit, "mix": cmd_mix}[a.cmd](a)


if __name__ == "__main__":
    run_main(main)
