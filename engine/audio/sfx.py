"""Deterministic synth SFX library + SFX-layer renderer (docs/SPEC.md §6.2).

Library: click, pop, thump, whoosh, riser, swish, tick. Each is fn(seed, **kw) -> mono float64 normalised to its
own peak. PEAK_AT gives seconds from sample 0 to the perceptual hit.

CLI:
  sfx.py preview --out <dir>
  sfx.py render --cues cues_timed.json --duration S [--loop] --out sfx.wav
"""
import argparse
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import numpy as np  # noqa: E402

from common import (SR, emit, fail, fit_length, norm_peak, onepole_hp,  # noqa: E402
                    onepole_lp, read_json, run_main, stereo, t_axis, write_wav)


def click(seed=1, freq=3200.0):
    """Short UI tick, ~25 ms. Cuts, cursor clicks."""
    rng = np.random.default_rng(seed)
    t = t_axis(0.025)
    tone = np.sin(2 * np.pi * freq * t) * np.exp(-t * 400)
    n = rng.standard_normal(t.size)
    n = onepole_hp(n, 4000) * np.exp(-t * 900) * 0.4
    return norm_peak(tone + n, 0.7)


def pop(seed=2, f0=900.0, f1=300.0):
    """Bubbly pop with a pitch drop, ~90 ms. Elements appearing."""
    rng = np.random.default_rng(seed)
    t = t_axis(0.09)
    f = f1 + (f0 - f1) * np.exp(-t * 60)
    body = np.sin(2 * np.pi * np.cumsum(f) / SR) * np.exp(-t * 45)
    air = rng.standard_normal(t.size) * np.exp(-t * 300) * 0.15
    return norm_peak(body + air, 0.8)


def thump(seed=3, f0=110.0, f1=38.0):
    """Sub impact, ~600 ms. Type slams, logo lands, downbeat scene changes."""
    rng = np.random.default_rng(seed)
    t = t_axis(0.6)
    f = f1 + (f0 - f1) * np.exp(-t * 18)
    body = np.sin(2 * np.pi * np.cumsum(f) / SR) * np.exp(-t * 5)
    n = onepole_lp(rng.standard_normal(t.size), 900) * np.exp(-t * 35) * 0.6
    attack = np.minimum(1, t / 0.0008)
    return norm_peak(np.tanh(2.0 * (body + n)) * attack, 0.95)


def whoosh(seed=4, dur=0.6, peak_at=0.7):
    """Filtered-noise swell to dur*peak_at, then falls off. Transitions."""
    rng = np.random.default_rng(seed)
    t = t_axis(dur)
    u = t / dur
    env = np.where(u < peak_at, (u / peak_at) ** 2,
                   np.exp(-(u - peak_at) / (1 - peak_at) * 4))
    x = onepole_lp(rng.standard_normal(t.size), 300 + 5000 * env)
    x = onepole_hp(x, 150)
    return norm_peak(x * env, 0.8)


def swish(seed=5, dur=0.25, peak_at=0.6):
    """Short, bright whoosh (0.25 s). Fast push/wipe transitions."""
    rng = np.random.default_rng(seed)
    t = t_axis(dur)
    u = t / dur
    env = np.where(u < peak_at, (u / peak_at) ** 1.5,
                   np.exp(-(u - peak_at) / (1 - peak_at) * 5))
    x = onepole_lp(rng.standard_normal(t.size), 2000 + 9000 * env)
    x = onepole_hp(x, 1500)
    return norm_peak(x * env, 0.75)


def riser(seed=6, dur=2.0):
    """Noise sweep + rising tone that ends (its hit) at full length.
    The last 20 ms fade out so a loop seam does not click."""
    rng = np.random.default_rng(seed)
    t = t_axis(dur)
    u = t / dur
    x = onepole_lp(rng.standard_normal(t.size), 400 * (1 + 30 * u ** 2))
    x = onepole_hp(x, 200)
    tone_f = 220 * 2 ** (2 * u)
    tone = np.sin(2 * np.pi * np.cumsum(tone_f) / SR) * 0.15
    env = u ** 2 * np.clip((dur - t) / 0.02, 0, 1)
    return norm_peak((x * 1.5 + tone) * env, 0.8)


def tick(seed=7, freq=5200.0):
    """12 ms high blip. Counters, 1/16 ticks."""
    rng = np.random.default_rng(seed)
    t = t_axis(0.012)
    ramp = np.minimum(1, t / 0.0005)
    tone = np.sin(2 * np.pi * freq * t) * np.exp(-t * 500)
    n = onepole_hp(rng.standard_normal(t.size), 6000) * np.exp(-t * 1200) * 0.2
    return norm_peak((tone + n) * ramp, 0.6)


SFX = {"click": click, "pop": pop, "thump": thump, "whoosh": whoosh,
       "riser": riser, "swish": swish, "tick": tick}
DEFAULT_DUR = {"whoosh": 0.6, "swish": 0.25, "riser": 2.0}


def peak_at(name, dur=None):
    """Seconds from sample 0 to the perceptual hit."""
    if name not in SFX:
        raise ValueError(f"unknown sfx {name!r}")
    d = float(dur) if dur else DEFAULT_DUR.get(name, 0.0)
    if name == "whoosh":
        return d * 0.7
    if name == "swish":
        return d * 0.6
    if name == "riser":
        return d
    return 0.0


# seconds to the hit at each SFX's default duration (spec's PEAK_AT[name])
PEAK_AT = {name: peak_at(name) for name in SFX}


def make(name, seed, dur=None):
    """Build one SFX; dur only applies to whoosh/swish/riser."""
    if name not in SFX:
        raise ValueError(f"unknown sfx {name!r}")
    if name in DEFAULT_DUR:
        return SFX[name](seed=seed, dur=float(dur) if dur else DEFAULT_DUR[name])
    return SFX[name](seed=seed)


def render_layer(cues, duration, loop=False):
    """Stereo SFX layer [2, n] from cues_timed['cues']."""
    n = int(round(duration * SR))
    pad = int(5 * SR)
    buf = np.zeros((2, n + 2 * pad))       # pad on both sides for wrap/clip
    for c in cues:
        sig = make(c["sfx"], int(c["seed"]), c.get("dur"))
        g = 10 ** (float(c.get("gain_db", -6)) / 20)
        st = stereo(sig, float(c.get("pan", 0)))
        i = int(round(float(c["t"]) * SR)) + pad
        buf[:, i:i + sig.size] += g * st
    if loop:
        # fold every sample onto [0, n): pre-roll before t=0 lands at the end,
        # tails past the end land at the start
        idx = (np.arange(buf.shape[1]) - pad) % n
        return np.stack([np.bincount(idx, weights=ch, minlength=n) for ch in buf])
    return fit_length(buf[:, pad:], n, loop=False, fade_ms=10)


def cmd_preview(a):
    os.makedirs(a.out, exist_ok=True)
    out = {}
    for name in SFX:
        x, y = make(name, 1), make(name, 1)
        if not np.array_equal(x, y):
            fail(f"{name} not deterministic")
        p = os.path.join(a.out, f"{name}.wav")
        write_wav(p, x)
        out[name] = round(x.size / SR * 1000, 1)
    emit({"ok": True, "out": os.path.abspath(a.out), "ms": out})


def cmd_render(a):
    data = read_json(a.cues)
    cues = data.get("cues", [])
    if a.duration <= 0:
        fail("--duration must be > 0")
    layer = render_layer(cues, a.duration, a.loop)
    write_wav(a.out, layer)
    peak = float(np.max(np.abs(layer))) if layer.size else 0.0
    emit({"ok": True, "out": os.path.abspath(a.out), "cues": len(cues),
          "duration": a.duration, "loop": a.loop,
          "peak_dbfs": round(20 * np.log10(peak), 2) if peak > 0 else None})


def main():
    ap = argparse.ArgumentParser(description=__doc__)
    sub = ap.add_subparsers(dest="cmd", required=True)
    p = sub.add_parser("preview")
    p.add_argument("--out", required=True)
    r = sub.add_parser("render")
    r.add_argument("--cues", required=True)
    r.add_argument("--duration", type=float, required=True)
    r.add_argument("--loop", action="store_true")
    r.add_argument("--out", required=True)
    a = ap.parse_args()
    {"preview": cmd_preview, "render": cmd_render}[a.cmd](a)


if __name__ == "__main__":
    run_main(main)
