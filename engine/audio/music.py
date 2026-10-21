"""Parametric, deterministic music synth for reelcode (docs/SPEC.md §6.1).

  music.py --bpm 120 --key "A minor" --bars 8 --style minimal-tech --seed 7 \
           [--loop] --out audio/music.wav --beats audio/beats.json
  (--duration S may replace --bars: bars = round(S*bpm/240), at least 1.)

Guarantees
- Length is exactly bars*4*60/bpm s, 48 kHz stereo PCM_24.
- Beat 0 is a downbeat with a hit on sample 0 (kick or boom).
- --loop: tails wrap onto the start; styles with riser_last_bar build into t=0.
  No --loop: the last downbeat lands on a final hit and the tail is clipped
  with a 30 ms fade.
- Same args -> byte-identical WAV. beats.json is the exact grid (no analysis).
"""
import argparse
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import numpy as np  # noqa: E402
from scipy.signal import fftconvolve  # noqa: E402

from common import (SR, emit, fit_length, lowpass, master, mtof, onepole_hp,  # noqa: E402
                    onepole_lp, parse_key, place, rng_for, run_main, saw,
                    stereo, t_axis, write_json, write_wav)

# 16-step patterns are 1/16 notes across one bar. Motif rhythms are
# (offset_beats, length_beats, chord_tone_index); index 3+ climbs an octave.
STYLES = {
    "minimal-tech": {
        "bpm": 120, "key": "A minor", "prog_degrees": [0, 5, 2, 6], "sevenths": False,
        "kick": [1, 0, 0, 0] * 4,
        "snare": [0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0],
        "hat_div": 8, "hat_open_bars": [3, 7], "bass": "pump", "pad": "saw",
        "lead": "arp", "arp_div": 4, "swing": 0.0, "riser_last_bar": True,
        "drums_from_bar": 0, "snare_from_bar": 1, "lead_from_bar": 1,
        "kick_tone": (150, 45, 7.5), "reverb": 0.12, "duck": 0.55,
        "gains": {"kick": 0.95, "snare": 0.55, "hat": 0.2, "bass": 0.5,
                  "pad": 0.3, "lead": 0.32},
        "master_lp": None, "crackle": 0.0,
    },
    "punchy-pop": {
        "bpm": 128, "key": "C major", "prog_degrees": [0, 4, 5, 3], "sevenths": False,
        "kick": [1, 0, 0, 0, 0, 0, 1, 0, 1, 0, 0, 0, 0, 0, 0, 0],
        "snare": [0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 1],
        "hat_div": 16, "hat_open_bars": [1, 3, 5, 7], "bass": "root", "pad": "saw",
        "lead": "motif", "swing": 0.0, "riser_last_bar": True,
        "drums_from_bar": 0, "snare_from_bar": 0, "lead_from_bar": 1,
        "motif_a": [(0.0, 0.5, 2), (0.5, 0.5, 1), (1.0, 0.75, 2), (2.0, 0.5, 3),
                    (2.5, 0.5, 2), (3.0, 1.0, 1)],
        "motif_b": [(0.0, 0.5, 1), (0.5, 0.5, 2), (1.0, 0.5, 3), (1.5, 0.5, 4),
                    (2.5, 0.5, 3), (3.0, 1.0, 2)],
        "kick_tone": (170, 48, 8.5), "reverb": 0.15, "duck": 0.45,
        "gains": {"kick": 1.0, "snare": 0.75, "hat": 0.16, "bass": 0.55,
                  "pad": 0.28, "lead": 0.42},
        "master_lp": None, "crackle": 0.0,
    },
    "ambient-cinematic": {
        "bpm": 90, "key": "D minor", "prog_degrees": [0, 5, 3, 4], "sevenths": True,
        "kick": [1, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0],
        "snare": [0] * 16,
        "hat_div": 0, "hat_open_bars": [], "bass": "root", "pad": "sine",
        "lead": "arp", "arp_div": 2, "swing": 0.0, "riser_last_bar": True,
        "drums_from_bar": 0, "snare_from_bar": 99, "lead_from_bar": 0,
        "kick_tone": (90, 32, 3.5), "reverb": 0.45, "duck": 0.0, "boom": True,
        "pulse": True,
        "gains": {"kick": 0.9, "snare": 0.0, "hat": 0.0, "bass": 0.45,
                  "pad": 0.45, "lead": 0.3, "pulse": 0.22},
        "master_lp": None, "crackle": 0.0,
    },
    "lofi": {
        "bpm": 90, "key": "F major", "prog_degrees": [1, 4, 0, 5], "sevenths": True,
        "kick": [1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0],
        "snare": [0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0],
        "hat_div": 8, "hat_open_bars": [], "bass": "walk", "pad": "keys",
        "lead": "motif", "swing": 0.16, "riser_last_bar": False,
        "drums_from_bar": 0, "snare_from_bar": 0, "lead_from_bar": 1,
        "motif_a": [(0.5, 0.5, 2), (1.0, 1.0, 3), (2.5, 0.5, 2), (3.0, 1.0, 1)],
        "motif_b": [(0.0, 1.0, 1), (1.5, 0.5, 2), (2.0, 0.5, 1), (2.5, 1.5, 0)],
        "kick_tone": (110, 42, 9.0), "reverb": 0.22, "duck": 0.3,
        "gains": {"kick": 0.85, "snare": 0.5, "hat": 0.14, "bass": 0.5,
                  "pad": 0.4, "lead": 0.28},
        "master_lp": 7500.0, "crackle": 0.02,
    },
}


# ---------------- instruments (all take an rng so they're seeded) ----------------
def kick(rng, tone):
    f_hi, f_lo, dec = tone
    t = t_axis(0.5)
    f = f_lo + (f_hi - f_lo) * np.exp(-t * 28)
    body = np.sin(2 * np.pi * np.cumsum(f) / SR) * np.exp(-t * dec)
    click = onepole_lp(rng.standard_normal(t.size), 6000) * np.exp(-t * 400) * 0.35
    attack = np.minimum(1, t / 0.0008)            # sub-ms ramp, no hard step
    return np.tanh(1.6 * (body + click)) * attack


def boom(rng):
    """Cinematic impact: sub drop + dark noise bloom."""
    t = t_axis(2.2)
    f = 30 + 60 * np.exp(-t * 9)
    body = np.sin(2 * np.pi * np.cumsum(f) / SR) * np.exp(-t * 1.8)
    n = onepole_lp(rng.standard_normal(t.size), 500) * np.exp(-t * 3.0) * 0.5
    return np.tanh(1.4 * (body + n)) * np.minimum(1, t / 0.001)


def snare(rng, clap=True):
    t = t_axis(0.35)
    tone = np.sin(2 * np.pi * 190 * t) * np.exp(-t * 30) * 0.5
    white = lowpass(rng.standard_normal(t.size), 10000) * 1.3
    noise = onepole_hp(white, 1200) * np.exp(-t * 16)
    out = tone + 0.8 * noise
    if clap:
        c = np.zeros_like(t)
        for d in (0.0, 0.011, 0.022):
            i = int(d * SR)
            c[i:] += np.exp(-t[: t.size - i] * 90)
        out = out + c * lowpass(rng.standard_normal(t.size), 9000) * 0.7
    return 0.7 * out * np.minimum(1, t / 0.0005)


def rim(rng):
    """Lofi side-stick: short, woody, band-passed."""
    t = t_axis(0.12)
    tone = np.sin(2 * np.pi * 820 * t) * np.exp(-t * 60)
    n = lowpass(onepole_hp(rng.standard_normal(t.size), 1500), 6000)
    return (tone + n * np.exp(-t * 50) * 0.7) * np.minimum(1, t / 0.0005)


def hat(rng, open_=False):
    t = t_axis(0.25 if open_ else 0.05)
    n = onepole_hp(rng.standard_normal(t.size), 7000)
    n = lowpass(n, 13000)                             # no hiss above ~16 kHz
    return 1.3 * n * np.exp(-t * (14 if open_ else 80)) * np.minimum(1, t / 0.0003)


def bass_note(m, length, bright=1600.0):
    t = t_axis(length)
    f = float(mtof(m))
    x = saw(f, t) * 0.6 + np.sin(2 * np.pi * f * t) * 0.7
    env = np.minimum(1, t / 0.004) * np.exp(-t * 3.0)
    x = onepole_lp(x, 250 + bright * np.exp(-t * 14))
    rel = np.clip((length - t) / 0.012, 0, 1)
    return np.tanh(1.3 * x * env * rel)


def sub_note(m, length):
    t = t_axis(length)
    f = float(mtof(m))
    env = np.minimum(1, t / 0.03) * np.clip((length - t) / 0.08, 0, 1)
    return np.sin(2 * np.pi * f * t) * env


def pad_saw(notes, length):
    t = t_axis(length)
    x = np.zeros_like(t)
    for m in notes:
        for det in (-0.1, 0.1):
            x += saw(float(mtof(m)) * (1 + det / 100), t, 10)
    x = onepole_lp(x, 1300) / (len(notes) * 2)
    return x * np.minimum(1, t / 0.03) * np.clip((length - t) / 0.15, 0, 1)


def pad_sine(notes, length):
    """Warm, slow-moving pad (sine + soft 2nd/3rd harmonic, slow LFO)."""
    t = t_axis(length)
    x = np.zeros_like(t)
    for j, m in enumerate(notes):
        f = float(mtof(m))
        lfo = 1 + 0.25 * np.sin(2 * np.pi * (0.21 + 0.07 * j) * t + j)
        x += (np.sin(2 * np.pi * f * t) + 0.25 * np.sin(4 * np.pi * f * t)
              + 0.08 * np.sin(6 * np.pi * f * t)) * lfo
    x /= len(notes)
    return x * np.minimum(1, t / 0.25) * np.clip((length - t) / 0.4, 0, 1)


def keys_chord(notes, length):
    """Electric-piano-ish: FM bell attack, tremolo, soft decay."""
    t = t_axis(length)
    x = np.zeros_like(t)
    for m in notes:
        f = float(mtof(m))
        mod = np.sin(2 * np.pi * f * 2 * t) * 1.2 * np.exp(-t * 6)
        x += np.sin(2 * np.pi * f * t + mod)
    trem = 1 + 0.12 * np.sin(2 * np.pi * 4.5 * t)
    env = np.minimum(1, t / 0.004) * np.exp(-t * 0.9) * np.clip((length - t) / 0.1, 0, 1)
    return x / len(notes) * trem * env


def pluck(m, length, rng, bright=4000.0):
    t = t_axis(length + 0.4)
    f = float(mtof(m))
    x = saw(f, t, 12) * 0.7 + np.sin(2 * np.pi * f * t) * 0.5
    x += rng.standard_normal(t.size) * np.exp(-t * 300) * 0.05
    x = onepole_lp(x, 300 + bright * np.exp(-t * 9))
    env = np.minimum(1, t / 0.002) * np.exp(-t * 5.0)
    return x * env * np.clip((length + 0.4 - t) / 0.05, 0, 1)


def lead_note(m, length):
    t = t_axis(length + 0.25)
    f = float(mtof(m))
    vib = 1 + 0.003 * np.sin(2 * np.pi * 5.5 * t) * np.clip(t / 0.25, 0, 1)
    ph = 2 * np.pi * np.cumsum(f * vib) / SR
    # band-limited: a few harmonics only (a tanh/square here aliases badly)
    x = np.sin(ph) + 0.35 * np.sin(2 * ph) + 0.12 * np.sin(3 * ph) + 0.05 * np.sin(5 * ph)
    env = np.minimum(1, t / 0.006) * np.exp(-t * 3.5)
    return x * env * np.clip((length + 0.25 - t) / 0.25, 0, 1) * 0.5


def riser_fx(rng, length):
    t = t_axis(length)
    u = t / length
    x = onepole_hp(onepole_lp(rng.standard_normal(t.size), 400 * (1 + 30 * u ** 2)), 200)
    tone = np.sin(2 * np.pi * np.cumsum(220 * 2 ** (2 * u)) / SR) * 0.15
    return (x * 1.5 + tone) * u ** 2 * np.clip((length - t) / 0.02, 0, 1)


def reverb_ir(rng, sec=1.8, damp=3500.0):
    """Seeded synthetic stereo IR (decaying filtered noise)."""
    t = t_axis(sec)
    env = np.exp(-t * 6.9 / sec) * np.minimum(1, t / 0.01)
    ir = np.stack([onepole_lp(rng.standard_normal(t.size), damp) * env for _ in range(2)])
    return ir / np.sqrt(np.sum(ir ** 2, axis=1, keepdims=True))


# ---------------- arrangement ----------------
def chord_notes(pc, scale, degree, sevenths, low=55):
    """Triad (or 7th) on a scale degree, close-voiced upward from >= low."""
    steps = [0, 2, 4, 6] if sevenths else [0, 2, 4]
    out = []
    for s in steps:
        d = degree + s
        out.append(pc + scale[d % 7] + 12 * (d // 7))
    shift = 12 * int(np.ceil((low - out[0]) / 12))
    return [n + shift for n in out]


def bass_root(pc, scale, degree):
    return 36 + ((pc + scale[degree % 7]) % 12)  # C2..B2


class Song:
    def __init__(self, style, bpm, key, bars, seed, loop):
        self.s, self.bpm, self.bars, self.seed, self.loop = style, bpm, bars, seed, loop
        self.spb = 60.0 / bpm
        self.step = self.spb / 4
        self.n = int(round(bars * 4 * self.spb * SR))
        self.tail = int(3 * SR)
        self.pc, self.scale = parse_key(key)
        self.prog = style["prog_degrees"]
        self.bus = {k: np.zeros((2, self.n + self.tail))
                    for k in ("drums", "bass", "music", "fx")}

    def rng(self, *tags):
        return rng_for(self.seed, *tags)

    def t_of(self, bar, step16):
        """Seconds for a 1/16 step, with swing on odd 8ths (step 2, 6, ...)."""
        sw = self.s["swing"] * self.step * 2 if step16 % 4 == 2 else 0.0
        sw += self.s["swing"] * self.step if step16 % 2 == 1 else 0.0
        return (bar * 16 + step16) * self.step + sw

    def chord(self, bar):
        return chord_notes(self.pc, self.scale, self.prog[bar % len(self.prog)],
                           self.s["sevenths"])

    def is_final_bar(self, bar):
        return (not self.loop) and bar == self.bars - 1 and self.bars > 1

    def drums(self):
        s, g, d = self.s, self.s["gains"], self.bus["drums"]
        for bar in range(self.bars):
            if bar < s["drums_from_bar"]:
                continue
            final = self.is_final_bar(bar)
            for st in range(16):
                t0 = self.t_of(bar, st)
                if final and st > 0:
                    break
                if s["kick"][st]:
                    r = self.rng("kick", bar, st)
                    sig = boom(r) if s.get("boom") and st == 0 else kick(r, s["kick_tone"])
                    place(d, stereo(sig), t0, g["kick"])
                if s.get("pulse") and st % 4 == 0 and not (st == 0 or s["kick"][st]):
                    place(d, stereo(kick(self.rng("pulse", bar, st), (70, 40, 14))),
                          t0, g["pulse"])
                if s["snare"][st] and bar >= s["snare_from_bar"]:
                    r = self.rng("snare", bar, st)
                    sig = rim(r) if s["pad"] == "keys" else snare(r)
                    place(d, stereo(sig, 0.05), t0, g["snare"])
                hd = s["hat_div"]
                if hd and st % (16 // hd) == 0:
                    open_ = bar in s["hat_open_bars"] and st % 8 == 6
                    accent = 1.0 if st % 4 == 2 else 0.6
                    place(d, stereo(hat(self.rng("hat", bar, st), open_), 0.25 if st % 8 else -0.25),
                          t0, g["hat"] * accent * (0.9 if open_ else 1.0))
            if final:
                place(d, stereo(onepole_hp(hat(self.rng("crash", bar), True), 3000)), self.t_of(bar, 0), 0.5)
        if s["riser_last_bar"] and self.loop and s["snare_from_bar"] < 99:
            bar = self.bars - 1
            for i in range(8):                      # 1/16 roll into the wrap point
                place(d, stereo(snare(self.rng("roll", i)), 0.05),
                      self.t_of(bar, 8 + i), 0.12 + 0.05 * i)

    def bass(self):
        s, g, b = self.s, self.s["gains"], self.bus["bass"]
        for bar in range(self.bars):
            deg = self.prog[bar % len(self.prog)]
            root = bass_root(self.pc, self.scale, deg)
            if self.is_final_bar(bar):
                place(b, stereo(bass_note(root, 4 * self.spb, 900)), self.t_of(bar, 0), g["bass"])
                continue
            mode = s["bass"]
            if mode == "pump":
                for st in range(0, 16, 2):
                    m = root + (12 if st == 14 else 0)
                    place(b, stereo(bass_note(m, self.step * 1.8)), self.t_of(bar, st), g["bass"])
            elif mode == "root" and s["pad"] == "sine":
                place(b, stereo(sub_note(root, 4 * self.spb)), self.t_of(bar, 0), g["bass"])
            elif mode == "root":
                for st, ln in ((0, 3), (4, 2), (6, 2), (8, 3), (12, 2), (14, 2)):
                    m = root + (12 if st == 14 else 0)
                    place(b, stereo(bass_note(m, self.step * ln * 0.9, 2200)),
                          self.t_of(bar, st), g["bass"])
            elif mode == "walk":
                nxt = bass_root(self.pc, self.scale, self.prog[(bar + 1) % len(self.prog)])
                ch = self.chord(bar)
                line = [root, root + (ch[1] - ch[0]), root + (ch[2] - ch[0]), nxt - 1]
                for i, m in enumerate(line):
                    place(b, stereo(bass_note(m, self.spb * 0.85, 700)),
                          self.t_of(bar, i * 4), g["bass"])

    def harmony(self):
        s, g, mu = self.s, self.s["gains"], self.bus["music"]
        bar_len = 4 * self.spb
        for bar in range(self.bars):
            notes = self.chord(bar)
            t0 = bar * bar_len
            if s["pad"] == "saw":
                sig = pad_saw(notes, bar_len)
            elif s["pad"] == "sine":
                sig = pad_sine(notes, bar_len + 0.4)
            elif s["pad"] == "keys":
                sig = keys_chord(notes, 2 * self.spb)
                place(mu, stereo(keys_chord(notes, 2 * self.spb), 0.1),
                      self.t_of(bar, 10), g["pad"] * 0.7)
            else:
                continue
            place(mu, stereo(sig, -0.2) * 0.75 + stereo(sig, 0.2) * 0.25, t0, g["pad"])

    def melody(self):
        s, g, mu = self.s, self.s["gains"], self.bus["music"]
        for bar in range(s["lead_from_bar"], self.bars):
            if self.is_final_bar(bar):
                break
            tones = [n + 12 for n in self.chord(bar)]
            if s["lead"] == "arp":
                div = s["arp_div"]
                order = [0, 1, 2, len(tones) - 1, 2, 1] if div >= 4 else [0, 2, 1, len(tones) - 1]
                per = 4 * div
                for i in range(per):
                    st = i * (16 // per)
                    m = tones[order[i % len(order)]] + (12 if s["pad"] == "sine" else 0)
                    sig = pluck(m, self.step * (16 // per) * 0.9, self.rng("arp", bar, i),
                                2500 if s["pad"] == "sine" else 4000)
                    place(mu, stereo(sig, -0.35 if i % 2 else 0.35), self.t_of(bar, st), g["lead"])
            elif s["lead"] == "motif":
                motif = s["motif_a"] if (bar - s["lead_from_bar"]) % 2 == 0 else s["motif_b"]
                r = self.rng("motif", bar)
                for off, ln, idx in motif:
                    m = tones[idx % len(tones)] + 12 * (idx // len(tones))
                    if r.random() < 0.15:          # seeded passing-tone variation
                        m = self.pc + 72 + self.scale[int(r.integers(0, 7))]
                    st = int(round(off * 4))
                    place(mu, stereo(lead_note(m, ln * self.spb), 0.15),
                          self.t_of(bar, st), g["lead"])

    def fx(self):
        s = self.s
        if s["riser_last_bar"] and self.loop:
            ln = 4 * self.spb if self.bars > 1 else 2 * self.spb
            place(self.bus["fx"], stereo(riser_fx(self.rng("riser"), ln)),
                  self.n / SR - ln, 0.3)
        if s["crackle"] > 0:
            r = self.rng("crackle")
            x = np.zeros(self.n)
            hits = r.integers(0, self.n, size=int(self.n / SR * 9))
            x[hits] = r.standard_normal(hits.size)
            x = onepole_hp(x, 1500) + onepole_lp(r.standard_normal(self.n), 3000) * 0.04
            self.bus["fx"][:, :self.n] += stereo(x) * s["crackle"] * 10

    def render(self):
        self.drums()
        self.bass()
        self.harmony()
        self.melody()
        self.fx()
        s = self.s
        tt = np.arange(self.n + self.tail) / SR
        duck = 1.0
        if s["duck"] > 0:                           # sidechain keyed to the kick pattern
            kick_steps = [i for i, k in enumerate(s["kick"]) if k]
            dist = np.full(tt.shape, 1e9)
            for bar in range(self.bars + 2):
                for st in kick_steps:
                    k0 = self.t_of(bar, st)
                    d = tt - k0
                    dist = np.where((d >= 0) & (d < dist), d, dist)
            duck = 1 - s["duck"] * np.exp(-dist / (self.spb * 0.11))
        music = self.bus["music"]
        if s["reverb"] > 0:
            ir = reverb_ir(self.rng("ir"), 2.4 if s["pad"] == "sine" else 1.6)
            wet = np.stack([fftconvolve(music[c], ir[c])[: music.shape[1]] for c in range(2)])
            music = music + wet * s["reverb"]
        mix = self.bus["drums"] + (self.bus["bass"] + music) * duck + self.bus["fx"]
        if s["master_lp"]:
            mix = np.stack([onepole_lp(ch, s["master_lp"]) for ch in mix])
        out = fit_length(mix, self.n, loop=self.loop, fade_ms=30)
        return master(out, -1.0)


def beats_doc(bpm, bars, style_name, key, seed, loop):
    spb = 60.0 / bpm
    nb = bars * 4
    beats = [round(k * spb, 6) for k in range(nb)]
    return {"bpm": float(bpm), "beats": beats, "downbeats": beats[::4],
            "duration": round(nb * spb, 6), "source": "synth", "lag_ms": 0,
            "style": style_name, "key": key, "seed": seed, "bars": bars, "loop": loop}


def synth(style="minimal-tech", bpm=None, key=None, bars=8, seed=7, loop=False):
    if style not in STYLES:
        raise ValueError(f"unknown style {style!r}; one of {sorted(STYLES)}")
    s = STYLES[style]
    bpm = float(bpm or s["bpm"])
    key = key or s["key"]
    if not (40 <= bpm <= 220):
        raise ValueError("bpm must be in 40..220")
    if bars < 1:
        raise ValueError("bars must be >= 1")
    y = Song(s, bpm, key, int(bars), int(seed), bool(loop)).render()
    return y, beats_doc(bpm, int(bars), style, key, int(seed), bool(loop))


def main():
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--style", default="minimal-tech", choices=sorted(STYLES))
    ap.add_argument("--bpm", type=float, default=None)
    ap.add_argument("--key", default=None)
    ap.add_argument("--bars", type=int, default=None)
    ap.add_argument("--duration", type=float, default=None,
                    help="seconds; snapped to whole bars (overridden by --bars)")
    ap.add_argument("--seed", type=int, default=7)
    ap.add_argument("--loop", action="store_true")
    ap.add_argument("--out", required=True)
    ap.add_argument("--beats", required=True)
    a = ap.parse_args()
    bpm = a.bpm or STYLES[a.style]["bpm"]
    bars = a.bars
    if bars is None:
        if a.duration is None:
            raise ValueError("give --bars or --duration")
        bars = max(1, int(round(a.duration * bpm / 240)))
    y, doc = synth(a.style, bpm, a.key, bars, a.seed, a.loop)
    write_wav(a.out, y)
    write_json(a.beats, doc)
    emit({"ok": True, "out": os.path.abspath(a.out), "beats": os.path.abspath(a.beats),
          "style": a.style, "bpm": doc["bpm"], "key": doc["key"], "bars": bars,
          "duration": doc["duration"], "samples": int(y.shape[1]),
          "peak_dbfs": round(20 * np.log10(np.max(np.abs(y))), 2), "loop": a.loop})


if __name__ == "__main__":
    run_main(main)
