"""Music + SFX -> mastered mix at -14 LUFS / <= -1 dBTP (docs/SPEC.md §6.4).

  mix.py --music audio/music.wav --sfx audio/sfx.wav --cues audio/cues_timed.json \
         --duration S [--loop] [--lufs -14] [--tp -1] --out audio/mix.wav

1. Sum music + SFX; duck music -3 dB for 120 ms under every thump hit.
2. Trim/pad to exactly duration (loop: tails wrap onto the start).
3. Pre-master in numpy: lookahead limiter so peak-to-loudness ratio leaves
   room for the target (TP_target - LUFS_target - 0.8 dB margin), then gain
   to the target. This is what keeps ffmpeg loudnorm in *linear* mode.
4. Two-pass ffmpeg loudnorm (pass 1 measure, pass 2 measured_* + linear=true,
   -ar 48000, PCM_24).
5. Verify with ffmpeg ebur128=peak=true: I = target +-0.5 LU, TP <= tp, else exit 1.
6. With --loop: seam step (last->first sample) must be <= the file's p99 step.
Summary: {"ok":true,"I":-14.0,"TP":-1.3,"LRA":5.1,"seam_ok":true,...}
--sfx and --cues are optional (music-only mix). --music may be omitted for an
SFX-only bed (rare).
"""
import argparse
import json
import os
import re
import subprocess
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import numpy as np  # noqa: E402
from numba import njit  # noqa: E402
from scipy.ndimage import maximum_filter1d, uniform_filter1d  # noqa: E402
from scipy.signal import resample_poly  # noqa: E402

from common import (SR, ebur128, emit, ffmpeg_bin, fail, fit_length, lufs,  # noqa: E402
                    read_json, read_wav, run_main, true_peak_db, write_wav)

TOL_LU = 0.5


@njit(cache=True)
def _release(g, coef):
    """Instant attack (gain may drop at once), exponential recovery."""
    out = np.empty_like(g)
    s = 1.0
    for i in range(g.shape[0]):
        if g[i] < s:
            s = g[i]
        else:
            s = g[i] + (s - g[i]) * coef
        out[i] = s
    return out


def limit(x, ceiling, look_ms=1.5, release_ms=80.0):
    """Lookahead peak limiter on the 4x-oversampled peak. x: [2, n]."""
    os4 = np.abs(resample_poly(x, 4, 1, axis=-1)).max(axis=0)
    peak = os4.reshape(-1, 4).max(axis=1)[: x.shape[1]]
    peak = np.pad(peak, (0, x.shape[1] - peak.size))
    req = np.minimum(1.0, ceiling / np.maximum(peak, 1e-12))
    L = max(1, int(look_ms / 1000 * SR))
    g = -maximum_filter1d(-req, size=2 * L + 1)               # min over +-L
    g = _release(np.ascontiguousarray(g), float(np.exp(-1 / (release_ms / 1000 * SR))))
    g = uniform_filter1d(g, size=L + 1)                       # smooth, stays <= req
    return x * g


def premaster(x, target_lufs, target_tp, margin=0.8):
    """Limit so TP - I <= (target_tp - target_lufs - margin), then gain to target."""
    plr_max = target_tp - target_lufs - margin
    info = {"limited_db": 0.0}
    for _ in range(5):
        I, tp = lufs(x), true_peak_db(x)
        if I <= -69:
            raise RuntimeError("mix is silent")
        if tp - I <= plr_max:
            break
        ceiling = 10 ** ((I + plr_max - 0.3) / 20)
        before = tp
        x = limit(x, ceiling)
        info["limited_db"] = round(info["limited_db"] + (before - true_peak_db(x)), 2)
    I = lufs(x)
    x = x * 10 ** ((target_lufs - I) / 20)
    info["pre_I"], info["pre_TP"] = round(lufs(x), 2), round(true_peak_db(x), 2)
    return x, info


def duck_under(music, cues, loop=False, ms=120.0, db=-3.0):
    """Duck music by db for ms under each thump hit (5 ms in, 20 ms out)."""
    n = music.shape[1]
    env = np.ones(n)
    g = 10 ** (db / 20)
    ramp = int(0.005 * SR)
    shape = np.r_[np.linspace(1, g, ramp), np.full(int(ms / 1000 * SR), g),
                  np.linspace(g, 1, ramp * 4)]
    for c in cues:
        if c.get("sfx") != "thump":
            continue
        idx = np.arange(shape.size) + int(round(float(c["hit_t"]) * SR)) - ramp
        if loop:
            idx, sh = idx % n, shape
        else:
            keep = (idx >= 0) & (idx < n)
            idx, sh = idx[keep], shape[keep]
        env[idx] = np.minimum(env[idx], sh)
    return music * env


def _loudnorm_json(stderr):
    m = re.findall(r"\{[^{}]*\"input_i\"[^{}]*\}", stderr, re.S)
    if not m:
        raise RuntimeError(f"loudnorm: no JSON in ffmpeg output: {stderr[-300:]}")
    return json.loads(m[-1])


def loudnorm_2pass(src, dst, I, TP, LRA=11.0):
    ff = ffmpeg_bin()
    base = f"loudnorm=I={I}:TP={TP}:LRA={LRA}"
    p1 = subprocess.run([ff, "-hide_banner", "-nostats", "-i", src, "-af",
                         base + ":print_format=json", "-f", "null", "-"],
                        capture_output=True, text=True)
    if p1.returncode:
        raise RuntimeError(f"loudnorm pass 1 failed: {p1.stderr[-300:]}")
    m = _loudnorm_json(p1.stderr)
    lra = max(LRA, min(20.0, float(m["input_lra"]) + 1.0))   # keep linear mode legal
    f2 = (f"loudnorm=I={I}:TP={TP}:LRA={lra}:measured_I={m['input_i']}"
          f":measured_TP={m['input_tp']}:measured_LRA={m['input_lra']}"
          f":measured_thresh={m['input_thresh']}:offset={m['target_offset']}"
          ":linear=true:print_format=json")
    p2 = subprocess.run([ff, "-hide_banner", "-nostats", "-y", "-i", src, "-af", f2,
                         "-ar", str(SR), "-ac", "2", "-c:a", "pcm_s24le", dst],
                        capture_output=True, text=True)
    if p2.returncode:
        raise RuntimeError(f"loudnorm pass 2 failed: {p2.stderr[-300:]}")
    m2 = _loudnorm_json(p2.stderr)
    return {"pass1": {k: m[k] for k in ("input_i", "input_tp", "input_lra")},
            "normalization_type": m2.get("normalization_type")}


def seam_check(path):
    x = read_wav(path)
    step = float(np.max(np.abs(x[:, 0] - x[:, -1])))
    p99 = float(np.percentile(np.abs(np.diff(x, axis=1)), 99))
    return step <= p99, round(step, 4), round(p99, 4)


def master_to(x, out, target_lufs, target_tp):
    """Steps 3-5 for any summed bed x [2, n]: premaster, two-pass loudnorm, ebur128 trim.
    Shared by mix.py and voice.py mix. Returns (meas, loudnorm_info, premaster_info, trim_db)."""
    x, pre = premaster(x, target_lufs, target_tp)
    tmp = out + ".pre.wav"
    write_wav(tmp, x, subtype="FLOAT")
    try:
        ln = loudnorm_2pass(tmp, out, target_lufs, target_tp)
    finally:
        if os.path.exists(tmp):
            os.remove(tmp)
    meas = ebur128(out)
    trim = round(target_lufs - meas["I"], 2)
    if 0.15 <= abs(trim) <= 2.0 and meas["TP"] + trim <= target_tp - 0.1:
        # loudnorm's internal meter and ebur128 can disagree by a few tenths;
        # ebur128 is the verifier, so trim once with a pure linear gain
        x2 = read_wav(out) * 10 ** (trim / 20)
        write_wav(out, x2)
        meas = ebur128(out)
    else:
        trim = 0.0
    return meas, ln, pre, trim


def build_mix(a):
    n = int(round(a.duration * SR))
    music = fit_length(read_wav(a.music), n, loop=a.loop) if a.music else np.zeros((2, n))
    cues = read_json(a.cues).get("cues", []) if a.cues else []
    music = duck_under(music, cues, a.loop) if cues else music
    sfx = fit_length(read_wav(a.sfx), n, loop=a.loop) if a.sfx else np.zeros((2, n))
    return music + sfx


def main():
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--music")
    ap.add_argument("--sfx")
    ap.add_argument("--cues")
    ap.add_argument("--duration", type=float, required=True)
    ap.add_argument("--loop", action="store_true")
    ap.add_argument("--lufs", type=float, default=-14.0)
    ap.add_argument("--tp", type=float, default=-1.0)
    ap.add_argument("--out", required=True)
    a = ap.parse_args()
    if not a.music and not a.sfx:
        fail("need --music and/or --sfx")
    for p in (a.music, a.sfx, a.cues):
        if p and not os.path.isfile(p):
            fail(f"missing input {p}")
    if a.duration <= 0.5:
        fail("--duration must be > 0.5 s (loudness gating needs 400 ms blocks)")
    meas, ln, pre, trim = master_to(build_mix(a), a.out, a.lufs, a.tp)
    seam_ok, seam_step, p99 = seam_check(a.out) if a.loop else (None, None, None)
    ok = abs(meas["I"] - a.lufs) <= TOL_LU and meas["TP"] <= a.tp
    if a.loop:
        ok = ok and bool(seam_ok)
    summary = {"ok": ok, "out": os.path.abspath(a.out), "I": meas["I"], "TP": meas["TP"],
               "LRA": meas["LRA"], "seam_ok": seam_ok, "seam_step": seam_step,
               "p99_step": p99, "target": {"I": a.lufs, "TP": a.tp},
               "loudnorm": ln, "premaster": pre, "trim_db": trim}
    if not ok:
        fail("loudness/peak/seam verification failed", **summary)
    emit(summary)


if __name__ == "__main__":
    run_main(main)
