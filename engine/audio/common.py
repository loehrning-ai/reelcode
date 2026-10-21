"""Shared audio helpers for reelcode (docs/SPEC.md §6).

Everything is 48 kHz. Music and mix are stereo PCM_24, SFX stems are mono.

Every CLI in engine/audio prints exactly one JSON summary line on stdout and
exits 0 on success, 1 on failure (see `emit` / `fail`).
"""
import json
import os
import re
import shutil
import subprocess
import sys
import zlib

import numpy as np
import soundfile as sf
from numba import njit
from scipy.signal import butter, lfilter, resample_poly, sosfilt

SR = 48_000

NOTE_PC = {"C": 0, "D": 2, "E": 4, "F": 5, "G": 7, "A": 9, "B": 11}
SCALES = {"major": [0, 2, 4, 5, 7, 9, 11], "minor": [0, 2, 3, 5, 7, 8, 10]}


# ---------- CLI plumbing ----------
def emit(obj):
    """Print the one-line JSON summary and exit 0."""
    sys.stdout.write(json.dumps(obj, separators=(",", ":")) + "\n")
    sys.stdout.flush()
    sys.exit(0)


def fail(msg, **extra):
    """Print a one-line JSON failure summary and exit 1."""
    sys.stdout.write(json.dumps({"ok": False, "error": str(msg), **extra},
                                separators=(",", ":")) + "\n")
    sys.stdout.flush()
    sys.exit(1)


def run_main(fn):
    """Wrap a CLI main so any exception becomes a JSON failure line."""
    try:
        fn()
    except SystemExit:
        raise
    except Exception as e:  # noqa: BLE001 - CLI boundary
        fail(f"{type(e).__name__}: {e}")


def read_json(path):
    with open(path, "r", encoding="utf-8") as fh:
        return json.load(fh)


def write_json(path, obj):
    d = os.path.dirname(os.path.abspath(path))
    os.makedirs(d, exist_ok=True)
    tmp = path + ".tmp"
    with open(tmp, "w", encoding="utf-8") as fh:
        json.dump(obj, fh, indent=1)
        fh.write("\n")
    os.replace(tmp, path)


def stable_seed(*parts):
    """Deterministic 32-bit seed from strings/ints (crc32)."""
    return zlib.crc32("|".join(str(p) for p in parts).encode("utf-8")) & 0xFFFFFFFF


def rng_for(seed, *tags):
    """Independent RNG per (seed, tag...) so edits never cascade."""
    return np.random.default_rng([int(seed) & 0xFFFFFFFF, stable_seed(*tags)])


# ---------- music theory ----------
def parse_key(key):
    """'A minor' / 'F# major' / 'Bb minor' -> (pitch_class, scale_intervals)."""
    m = re.fullmatch(r"\s*([A-Ga-g])([#b]?)\s+(major|minor)\s*", key or "")
    if not m:
        raise ValueError(f'key must be "<A-G>[#|b] major|minor", got {key!r}')
    pc = NOTE_PC[m.group(1).upper()] + {"#": 1, "b": -1, "": 0}[m.group(2)]
    return pc % 12, SCALES[m.group(3)]


def mtof(m):
    return 440.0 * 2 ** ((np.asarray(m, dtype=float) - 69) / 12)


# ---------- signal helpers ----------
def t_axis(sec):
    return np.arange(int(round(sec * SR))) / SR


def place(buf, sig, start_sec, gain=1.0):
    """Add sig ([2,n] or [n]) into buf at start_sec; clips to buf bounds."""
    i = int(round(start_sec * SR))
    n = sig.shape[-1]
    a, b = max(i, 0), min(i + n, buf.shape[-1])
    if b <= a:
        return
    buf[..., a:b] += gain * sig[..., a - i:b - i]


def stereo(mono, pan=0.0):
    """Constant-power pan, pan in [-1, 1]."""
    a = (float(pan) + 1) * np.pi / 4
    return np.stack([mono * np.cos(a), mono * np.sin(a)])


@njit(cache=True)
def _onepole(x, a):
    y = np.empty_like(x)
    s = 0.0
    for i in range(x.shape[0]):
        s += a[i] * (x[i] - s)
        y[i] = s
    return y


def onepole_lp(x, cutoff):
    """One-pole low-pass. cutoff is a scalar or a per-sample array (Hz)."""
    x = np.ascontiguousarray(x, dtype=np.float64)
    if np.ndim(cutoff) == 0:
        a = 1 - np.exp(-2 * np.pi * float(cutoff) / SR)
        return lfilter([a], [1, -(1 - a)], x)
    c = np.broadcast_to(np.asarray(cutoff, dtype=np.float64), x.shape)
    return _onepole(x, np.ascontiguousarray(1 - np.exp(-2 * np.pi * c / SR)))


def onepole_hp(x, cutoff):
    return x - onepole_lp(x, cutoff)


_SOS = {}


def lowpass(x, cutoff, order=4):
    """Butterworth low-pass (steep; use where a one-pole leaves hiss)."""
    key = (float(cutoff), int(order))
    if key not in _SOS:
        _SOS[key] = butter(order, cutoff, btype="low", fs=SR, output="sos")
    return sosfilt(_SOS[key], x)


def saw(freq, t, max_h=16):
    """Band-limited-ish saw from a few harmonics (no aliasing)."""
    out = np.zeros_like(t)
    for k in range(1, max_h + 1):
        if freq * k > SR / 2.5:
            break
        out += ((-1) ** (k + 1)) * np.sin(2 * np.pi * freq * k * t) / k
    return out * (2 / np.pi)


def norm_peak(x, peak=0.9):
    m = float(np.max(np.abs(x))) if x.size else 0.0
    return x * (peak / m) if m > 0 else x


def wrap_tail(x, n):
    """Fold anything after sample n back onto the start (seamless loop)."""
    out = x[..., :n].copy()
    rest = x[..., n:]
    while rest.shape[-1] > 0:
        k = min(n, rest.shape[-1])
        out[..., :k] += rest[..., :k]
        rest = rest[..., k:]
    return out


def fit_length(x, n, loop=False, fade_ms=30.0):
    """Trim/pad to exactly n samples. Loop wraps tails; else clip + fade."""
    if x.shape[-1] < n:
        pad = np.zeros(x.shape[:-1] + (n - x.shape[-1],))
        return np.concatenate([x, pad], axis=-1)
    if loop:
        return wrap_tail(x, n)
    out = x[..., :n].copy()
    f = min(n, int(fade_ms / 1000 * SR))
    if f > 0 and x.shape[-1] > n:
        out[..., n - f:] *= np.linspace(1, 0, f)
    return out


def master(x, peak_db=-1.0, drive=1.1):
    """Gentle tanh glue then normalise to peak_db dBFS."""
    x = np.tanh(x * drive) / np.tanh(drive)
    p = float(np.max(np.abs(x)))
    return x * (10 ** (peak_db / 20) / p) if p > 0 else x


def write_wav(path, x, subtype="PCM_24"):
    """x is [n] mono or [2, n] stereo float. Writes atomically."""
    os.makedirs(os.path.dirname(os.path.abspath(path)), exist_ok=True)
    data = x.T if x.ndim == 2 else x
    if not np.all(np.isfinite(data)):
        raise ValueError(f"non-finite samples, refusing to write {path}")
    tmp = path + ".tmp.wav"
    sf.write(tmp, np.ascontiguousarray(data), SR, subtype=subtype)
    os.replace(tmp, path)


def read_wav(path, channels=2):
    """Read -> float64 [channels, n] at SR (errors on other rates)."""
    data, sr = sf.read(path, dtype="float64", always_2d=True)
    if sr != SR:
        raise ValueError(f"{path}: sample rate {sr}, expected {SR}")
    x = data.T
    if channels == 2 and x.shape[0] == 1:
        x = np.vstack([x, x])
    if channels == 1 and x.shape[0] > 1:
        x = x.mean(axis=0, keepdims=True)
    return x


# ---------- loudness (python side; ffmpeg ebur128 is the authority) ----------
_K1 = ([1.53512485958697, -2.69169618940638, 1.19839281085285],
       [1.0, -1.69065929318241, 0.73248077421585])
_K2 = ([1.0, -2.0, 1.0], [1.0, -1.99004745483398, 0.99007225036621])


def lufs(x):
    """BS.1770-4 integrated loudness of [ch, n] at 48 kHz (gated)."""
    x = np.atleast_2d(x)
    z = lfilter(*_K2, lfilter(*_K1, x, axis=-1), axis=-1) ** 2
    blk, hop = int(0.4 * SR), int(0.1 * SR)
    if z.shape[-1] < blk:
        return -70.0
    starts = np.arange(0, z.shape[-1] - blk + 1, hop)
    cs = np.concatenate([np.zeros((z.shape[0], 1)), np.cumsum(z, axis=-1)], axis=-1)
    ms = (cs[:, starts + blk] - cs[:, starts]) / blk          # [ch, blocks]
    power = ms.sum(axis=0)
    with np.errstate(divide="ignore"):
        lk = -0.691 + 10 * np.log10(np.maximum(power, 1e-20))
    g = power[lk > -70]
    if g.size == 0:
        return -70.0
    rel = -0.691 + 10 * np.log10(g.mean()) - 10
    g = power[(lk > -70) & (lk > rel)]
    return float(-0.691 + 10 * np.log10(g.mean()))


def true_peak_db(x):
    """4x oversampled peak in dBTP."""
    os4 = resample_poly(np.atleast_2d(x), 4, 1, axis=-1)
    p = float(np.max(np.abs(os4)))
    return 20 * np.log10(p) if p > 0 else -120.0


def band_db(x, lo, hi):
    """Energy (dB, relative to full-scale sine-ish) in [lo, hi) Hz."""
    mono = np.atleast_2d(x).mean(axis=0)
    spec = np.abs(np.fft.rfft(mono * np.hanning(mono.size))) ** 2
    f = np.fft.rfftfreq(mono.size, 1 / SR)
    e = spec[(f >= lo) & (f < hi)].sum() / max(spec.sum(), 1e-30)
    return float(10 * np.log10(max(e, 1e-30)))


# ---------- ffmpeg ----------
def ffmpeg_bin():
    b = shutil.which("ffmpeg")
    if not b:
        raise RuntimeError("ffmpeg not found on PATH")
    return b


def ebur128(path):
    """Authoritative measurement via ffmpeg ebur128=peak=true -> {I, TP, LRA}."""
    p = subprocess.run([ffmpeg_bin(), "-hide_banner", "-nostats", "-i", path,
                        "-filter_complex", "ebur128=peak=true", "-f", "null", "-"],
                       capture_output=True, text=True)
    if p.returncode != 0:
        raise RuntimeError(f"ebur128 failed: {p.stderr[-400:]}")
    s = p.stderr[p.stderr.rfind("Summary:"):]
    def grab(pat):
        m = re.search(pat, s, re.S)
        if not m:
            raise RuntimeError(f"ebur128: could not parse {pat!r}")
        return float(m.group(1))
    return {"I": grab(r"I:\s+(-?[\d.]+|-inf) LUFS"),
            "LRA": grab(r"LRA:\s+(-?[\d.]+) LU"),
            "TP": grab(r"True peak:.*?Peak:\s+(-?[\d.]+|-inf) dBFS")}
