"""Fit a SUPPLIED music track to the film (docs/SPEC.md §5.2, audio.musicStart / audio.fit).

  fit.py --in track_src_48k.wav --out audio/track_48k.wav --beats audio/beats.json
         --total-beats N [--start S] [--mode none|trim|loop|fade-bar] [--bpm-hint B] [--film-loop]

1. Cut the track at the in-point --start (seconds, sample-exact).
2. Measure the beat grid on the cut track (beats.analyze, same as beats.py).
3. Fit it to the film, whose length is beat N on that grid (a bar boundary):
   none      only the in-point; mix.py trims/pads as in v1.
   trim      cut at the film end (30 ms fade; a loop film folds the tail onto
             the start instead). Refuses a track shorter than the film.
   loop      repeat whole bars [beat 0, last full bar) until the film is full,
             each copy's ring-over folded onto the next copy's downbeat, then
             as trim. A track longer than the film is just trimmed.
   fade-bar  as loop/trim, then an equal-power fade across the final bar so
             the music lands on the film's last bar line (not for loop films).
4. beats.json is the measured grid extended at the measured tempo over the
   fitted length (the loop period is a whole number of fitted beats, so the
   grid stays exact), with a "fit" block describing what was done.
Summary: {"ok":true,"mode":..,"duration":..,"copies":..,"bars_per_copy":..,"bpm":..}
"""
import argparse
import os
import sys
import tempfile

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import numpy as np  # noqa: E402

from beats import analyze  # noqa: E402
from common import SR, emit, fail, read_wav, run_main, write_json, write_wav  # noqa: E402

MODES = ("none", "trim", "loop", "fade-bar")
TAIL_S = 0.10      # ring-over carried from one loop copy (or the film end) onto the next downbeat
FADE_S = 0.03      # end fade for trim on a non-loop film


def grid_beat(doc, k):
    """Seconds of beat k on the measured grid (extrapolated at the fitted tempo, like engine/beat.js)."""
    b, T = doc["beats"], 60.0 / doc["bpm"]
    last = len(b) - 1
    if k <= 0:
        return b[0] + k * T
    if k >= last:
        return b[last] + (k - last) * T
    return b[k]


def fold_tail(out, tail, at):
    """Add a fading tail into out starting at sample `at` (wrapping for loops is done by the caller)."""
    if tail.shape[1] == 0:
        return
    sh = tail * np.linspace(1, 0, tail.shape[1])
    end = min(out.shape[1], at + sh.shape[1])
    out[:, at:end] += sh[:, : end - at]


def loop_fill(x, doc, n_out):
    """Repeat whole bars of x until n_out samples (+ tail) exist. Returns (y, copies, bars)."""
    s0 = int(round(grid_beat(doc, 0) * SR))
    bars = int(np.floor((x.shape[1] / SR - grid_beat(doc, 0)) / (4 * 60.0 / doc["bpm"]) + 1e-9))
    while bars >= 1 and int(round(grid_beat(doc, 4 * bars) * SR)) > x.shape[1]:
        bars -= 1
    if bars < 1:
        raise RuntimeError("supplied track is shorter than one bar after the in-point; nothing to loop")
    s1 = int(round(grid_beat(doc, 4 * bars) * SR))
    period = s1 - s0
    tail_n = int(TAIL_S * SR)
    need = n_out + tail_n
    y = np.zeros((2, need))
    y[:, : min(s1, need)] = x[:, : min(s1, need)]
    copies, pos = 1, s1
    while pos < need:
        fold_tail(y, x[:, s1: s1 + tail_n], pos)          # previous copy rings into this downbeat
        k = min(period, need - pos)
        y[:, pos: pos + k] += x[:, s0: s0 + k]
        pos += period
        copies += 1
    return y, copies, bars


def finish(y, n_out, film_loop):
    """Cut at n_out: fold the post-cut tail onto the start (loop film) or fade the last 30 ms."""
    out = y[:, :n_out].copy()
    rest = y[:, n_out: n_out + int(TAIL_S * SR)]
    if film_loop:
        fold_tail(out, rest, 0)
    else:
        f = min(n_out, int(FADE_S * SR))
        if rest.shape[1] and f:
            out[:, n_out - f:] *= np.linspace(1, 0, f)
    return out


def fade_last_bar(y, doc, total_beats):
    a = int(round(grid_beat(doc, total_beats - 4) * SR))
    b = y.shape[1]
    if b - a <= 0:
        return y
    g = np.cos(np.linspace(0, np.pi / 2, b - a)) ** 2        # equal-power-ish, holds early, lands at 0
    y = y.copy()
    y[:, a:b] *= g
    return y


def extend_doc(doc, n_out, mode, start, copies, bars):
    T = 60.0 / doc["bpm"]
    dur = n_out / SR
    phase = doc["beats"][0] if doc["beats"] else 0.0
    k = int(np.floor((dur - phase) / T - 1e-9)) + 1
    grid = np.round(phase + T * np.arange(max(k, 0)), 4)
    grid = grid[(grid >= -1e-9) & (grid < dur - 1e-6)]
    p = int(doc.get("bar_phase", 0))
    new = dict(doc)
    new.update({"beats": [float(g) for g in grid], "downbeats": [float(g) for g in grid[p::4]],
                "duration": round(dur, 6),
                "hits_snapped": [h for h in doc.get("hits_snapped", []) if h < dur],
                "fit": {"mode": mode, "start": start, "copies": copies, "bars_per_copy": bars,
                        "source_duration": doc["duration"]}})
    return new


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--in", dest="inp", required=True)
    ap.add_argument("--out", required=True)
    ap.add_argument("--beats", required=True)
    ap.add_argument("--total-beats", type=int, required=True)
    ap.add_argument("--start", type=float, default=0.0)
    ap.add_argument("--mode", default="none", choices=MODES)
    ap.add_argument("--bpm-hint", type=float, default=None)
    ap.add_argument("--film-loop", action="store_true")
    a = ap.parse_args()
    if a.start < 0:
        fail("--start (audio.musicStart) must be >= 0")
    if a.total_beats < 4 or a.total_beats % 4:
        fail("--total-beats must be a positive whole number of bars")
    if a.mode == "fade-bar" and a.film_loop:
        fail('audio.fit "fade-bar" fades the ending out, which breaks a loop:true film; use "loop" or "trim"')
    x = read_wav(a.inp)
    s = int(round(a.start * SR))
    if s >= x.shape[1] - SR:
        fail(f"audio.musicStart {a.start}s leaves less than 1 s of a {x.shape[1] / SR:.3f} s track")
    x = x[:, s:]
    fd, cut = tempfile.mkstemp(suffix=".wav", dir=os.path.dirname(os.path.abspath(a.out)))
    os.close(fd)
    try:
        write_wav(cut, x)
        doc = analyze(cut, a.bpm_hint)
    finally:
        os.remove(cut)
    if a.mode == "none":
        write_wav(a.out, x)
        doc["fit"] = {"mode": "none", "start": a.start, "copies": 1, "bars_per_copy": None,
                      "source_duration": doc["duration"]}
        write_json(a.beats, doc)
        emit({"ok": True, "mode": "none", "out": os.path.abspath(a.out), "duration": doc["duration"],
              "bpm": doc["bpm"], "start": a.start, "copies": 1, "bars_per_copy": None})
    n_out = int(round(grid_beat(doc, a.total_beats) * SR))
    copies, bars = 1, None
    if x.shape[1] >= n_out:
        y = x
    elif a.mode == "trim":
        fail(f'supplied track is {x.shape[1] / SR:.3f} s after the in-point but the film needs '
             f'{n_out / SR:.3f} s; use audio.fit "loop" or "fade-bar", or a shorter film')
    else:
        y, copies, bars = loop_fill(x, doc, n_out)
    y = finish(y, n_out, a.film_loop)
    if a.mode == "fade-bar":
        y = fade_last_bar(y, doc, a.total_beats)
    write_wav(a.out, y)
    new = extend_doc(doc, n_out, a.mode, a.start, copies, bars)
    write_json(a.beats, new)
    emit({"ok": True, "mode": a.mode, "out": os.path.abspath(a.out), "duration": new["duration"],
          "bpm": new["bpm"], "start": a.start, "copies": copies, "bars_per_copy": bars,
          "beats": len(new["beats"])})


if __name__ == "__main__":
    run_main(main)
