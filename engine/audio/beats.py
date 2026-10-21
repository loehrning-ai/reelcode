"""Beat grid for a SUPPLIED track (docs/SPEC.md §6.5). Synth music never needs it.

  beats.py --in <track> --out audio/beats.json [--bpm-hint N]

A plain beat tracker is not good enough to cut picture on. This one adds four corrections:
  1. beats near the edges   -> beat_track(trim=False), then the grid is extrapolated to [0, dur)
  2. bar phase              -> chosen from chord changes and low-band onsets, not "every 4th beat"
  3. tracker lag (10-20 ms) -> measured against sample-accurate attacks and removed
  4. tempo jitter           -> one constant-tempo grid, fitted by least squares
Known-grid correction: with --bpm-hint, octave errors are folded onto the hint
and a fit within 1.5 % of it snaps to the hint exactly; a near-integer BPM
(|bpm - round| < 0.15) snaps to the integer. If the fit fails (too few beats or
large residuals) the hint grid is used with measured phase ("fallback": true).
"""
import argparse
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import numpy as np  # noqa: E402

from common import emit, run_main, write_json  # noqa: E402

HOP = 256


def _attacks(y, sr, onset_times, search=0.045):
    """Refine each onset to the sample where a causal 4 ms peak envelope first
    crosses half-way between the pre-onset floor and the local peak. Independent
    of the onset envelope's frame lag and of low-frequency cycle ripple."""
    from scipy.ndimage import maximum_filter1d
    k = max(2, int(sr * 0.004))
    env = np.roll(maximum_filter1d(np.abs(y), size=k), k // 2)
    out = []
    for to in onset_times:
        a = int(max(0, (to - search) * sr))
        b = int(min(y.size - 1, (to + 0.03) * sr))
        if b - a < 8:
            continue
        w = env[a:b]
        floor = float(w[: max(1, int(0.005 * sr))].min())
        pk = float(w.max())
        if pk <= floor * 1.2:
            continue
        i = int(np.argmax(w >= floor + 0.5 * (pk - floor)))
        out.append((a + i) / sr)
    return np.unique(np.asarray(out))


def _fold_octave(bpm, hint):
    cands = [bpm * r for r in (0.5, 2 / 3, 1.0, 1.5, 2.0)]
    if hint:
        return min(cands, key=lambda c: abs(np.log(c / hint)))
    while bpm < 70:
        bpm *= 2
    while bpm > 180:
        bpm /= 2
    return bpm


def _sync_novelty(feat, grid, sr, hop):
    """Per-beat change of a beat-synchronous (median) feature; beat 0 = nan."""
    import librosa
    fr = np.clip(librosa.time_to_frames(grid, sr=sr, hop_length=hop), 0, feat.shape[1] - 1)
    bounds = [int(f) for f in fr] + [feat.shape[1]]
    lead = bounds[0] > 0
    if lead:
        bounds = [0] + bounds
    seg = librosa.util.sync(feat, bounds, aggregate=np.median)
    if lead:
        seg = seg[:, 1:]
    seg = seg[:, : len(grid)]
    seg = seg / (np.linalg.norm(seg, axis=0, keepdims=True) + 1e-12)
    return np.r_[np.nan, np.linalg.norm(np.diff(seg, axis=1), axis=0)]


def _downbeat_phase(y, sr, grid):
    """Bar phase 0..3: the beats where harmony changes most. Bass-register
    chroma (C1..B3) carries the bar's root change; full chroma and low-band
    onset are weaker tie-breakers. Beat 0 has no predecessor and is ignored."""
    import librosa
    if len(grid) < 8:
        return 0, [0.0, 0.0, 0.0, 0.0]
    hop = 512
    bass = librosa.feature.chroma_cqt(y=y, sr=sr, hop_length=hop, n_octaves=3,
                                      fmin=librosa.note_to_hz("C1"), bins_per_octave=36)
    full = librosa.feature.chroma_stft(y=y, sr=sr, hop_length=hop)
    S = np.abs(librosa.stft(y, hop_length=hop, n_fft=2048))
    low = S[librosa.fft_frequencies(sr=sr, n_fft=2048) < 150].sum(axis=0)
    low_on = np.r_[0, np.maximum(0, np.diff(low))]
    i = np.clip(np.round(np.asarray(grid) * sr / hop).astype(int), 0, low_on.size - 1)
    lo = np.array([low_on[max(0, j - 2):j + 3].max() for j in i])

    def z(v):
        m = np.isfinite(v)
        out = np.full(v.shape, np.nan)
        out[m] = (v[m] - v[m].mean()) / (v[m].std() + 1e-12)
        return out
    score = (z(_sync_novelty(bass, grid, sr, hop)) + 0.25 * z(_sync_novelty(full, grid, sr, hop))
             + 0.25 * np.nan_to_num(z(lo)))
    sums = [float(np.nanmean(score[p::4])) if np.isfinite(score[p::4]).any() else -9.0
            for p in range(4)]
    return int(np.argmax(sums)), [round(v, 3) for v in sums]


def _grid_fit(att, w, T0, span=0.02, tol=0.010):
    """Hough-style constant-tempo fit on true attack times.

    For each candidate period T in T0*(1 +- span) and each attack as phase
    anchor, score = summed weight of attacks within tol of the grid. Off-grid
    events (8th hats, syncopation, invented tail beats) simply do not score.
    The winner is refined by least squares on its inliers.
    Returns (a, T, median_abs_residual, n_inliers) or None."""
    if att.size < 4:
        return None
    best = (-1.0, None, None)
    d = att[None, :] - att[:, None]                 # anchor x attack
    for T in np.linspace(T0 * (1 - span), T0 * (1 + span), 801):
        r = ((d + T / 2) % T) - T / 2
        sc = ((np.abs(r) < tol) * w[None, :]).sum(axis=1)
        i = int(np.argmax(sc))
        if sc[i] > best[0] + 1e-9:
            best = (float(sc[i]), T, att[i])
    _, T, anchor = best
    k = np.round((att - anchor) / T)
    res = att - (anchor + T * k)
    keep = np.abs(res) < tol
    if keep.sum() < 4 or np.unique(k[keep]).size < 4:
        return None
    T, a = np.polyfit(k[keep], att[keep], 1)
    res = att[keep] - (a + T * k[keep])
    return float(a), float(T), float(np.median(np.abs(res))), int(keep.sum())


def _onset_peaks(env, frame_rate, reach_ms=15.0, lead_ms=15.0, lag_ms=25.0, rise=0.3, gap_ms=20.0):
    """Onset frames: a frame is kept when it is the largest value within +-reach_ms, beats the mean of the window
    [-lead_ms, +lag_ms] around it by `rise`, and comes at least gap_ms after the previous kept frame.
    Windows are given in milliseconds so the picker behaves the same at any sample rate and hop."""
    env = np.asarray(env, dtype=float)
    n = env.size
    if n == 0:
        return np.zeros(0, dtype=int)
    frames = lambda ms: max(1, int(round(ms * frame_rate / 1000.0)))  # noqa: E731
    reach, lead, lag, gap = frames(reach_ms), frames(lead_ms), frames(lag_ms), frames(gap_ms)
    padded = np.pad(env, (reach, reach), mode='edge')
    windows = np.lib.stride_tricks.sliding_window_view(padded, 2 * reach + 1)
    is_top = env >= windows.max(axis=1)
    csum = np.concatenate([[0.0], np.cumsum(env)])
    lo = np.clip(np.arange(n) - lead, 0, n)
    hi = np.clip(np.arange(n) + lag + 1, 0, n)
    local_mean = (csum[hi] - csum[lo]) / np.maximum(hi - lo, 1)
    candidates = np.flatnonzero(is_top & (env >= local_mean + rise))
    kept, last = [], -gap - 1
    for i in candidates:
        if i - last > gap:
            kept.append(i)
            last = i
    return np.asarray(kept, dtype=int)


def analyze(path, bpm_hint=None):
    import librosa
    y, sr = librosa.load(path, sr=None, mono=True)
    duration = y.size / sr
    onset = librosa.onset.onset_strength(y=y, sr=sr, hop_length=HOP)
    tempo, frames = librosa.beat.beat_track(onset_envelope=onset, sr=sr, hop_length=HOP,
                                            trim=False, start_bpm=bpm_hint or 120.0,
                                            units="frames")
    raw_bpm = float(np.atleast_1d(tempo)[0])
    raw_beats = librosa.frames_to_time(frames, sr=sr, hop_length=HOP)
    peaks = _onset_peaks(onset, sr / HOP)
    onset_t = librosa.frames_to_time(peaks, sr=sr, hop_length=HOP)
    attacks = _attacks(y, sr, onset_t)

    bpm0 = _fold_octave(raw_bpm, bpm_hint) if raw_bpm > 0 else (bpm_hint or 0)
    if not bpm0:
        raise RuntimeError("no tempo found; pass --bpm-hint")
    T0 = 60.0 / bpm0
    # lag: tracker beat minus the true (sample-accurate) attack it sits on
    matched, lags = [], []
    for b in raw_beats:
        if attacks.size:
            j = int(np.argmin(np.abs(attacks - b)))
            if abs(attacks[j] - b) < 0.05:
                matched.append(attacks[j])
                lags.append(b - attacks[j])
    lag = float(np.median(lags)) if len(lags) >= 3 else 0.0
    matched = np.unique(np.asarray(matched))
    w = np.ones(attacks.size)
    if matched.size:
        w[np.isin(attacks, matched)] = 2.0          # the tracker's beats count double
    fit = _grid_fit(attacks, w, T0)
    fallback, resid, n_fit = False, None, 0
    if fit is not None:
        a, T, resid, n_fit = fit
        bpm = 60.0 / T
        if resid > 0.03 or (bpm_hint and abs(bpm - bpm_hint) / bpm_hint > 0.08):
            fallback = True
    else:
        fallback = True
    if fallback:
        if not bpm_hint:
            raise RuntimeError("could not fit a beat grid; pass --bpm-hint")
        bpm, a = float(bpm_hint), 0.0
    fit_bpm = bpm
    # known-grid corrections
    if bpm_hint and abs(bpm - bpm_hint) / bpm_hint <= 0.015:
        bpm = float(bpm_hint)
    elif abs(bpm - round(bpm)) < 0.15:
        bpm = float(round(bpm))
    T = 60.0 / bpm
    # phase with T fixed: median offset of attacks lying near grid beats
    ref = matched if matched.size >= 4 else (attacks if attacks.size else raw_beats - lag)
    if ref.size:
        off = ((ref - a + T / 2) % T) - T / 2
        near = off[np.abs(off) < 0.03]
        a += float(np.median(near if near.size >= 3 else off))
    phase = a % T
    if phase > T - 0.003:
        phase -= T
    if abs(phase) < 0.002:
        phase = 0.0
    n = int(np.floor((duration - phase) / T - 1e-9)) + 1
    grid = np.round(phase + T * np.arange(n), 4)
    grid = grid[(grid >= -1e-9) & (grid < duration - 1e-6)]

    p, bar_scores = _downbeat_phase(y, sr, grid)
    hits = attacks if attacks.size else onset_t - lag
    q = T / 4
    snapped = sorted(set([0.0] + [round(phase + q * round((h - phase) / q), 4)
                                  for h in hits if 0 <= h < duration]))
    snapped = [s for s in snapped if 0 <= s < duration]
    return {
        "bpm": round(bpm, 4), "beats": [float(g) for g in grid],
        "downbeats": [float(g) for g in grid[p::4]], "duration": round(duration, 6),
        "source": "measured", "lag_ms": round(lag * 1000, 1), "style": None,
        "key": None, "seed": None, "fallback": fallback, "bar_phase": p,
        "measured": {"bpm": round(raw_bpm, 3), "fit_bpm": round(fit_bpm, 4),
                     "beats": [round(float(b), 4) for b in raw_beats],
                     "fit_residual_ms": None if resid is None else round(resid * 1000, 2),
                     "fit_beats": n_fit,
                     "bar_phase_scores": bar_scores},
        "hits_snapped": snapped,
    }


def main():
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--in", dest="inp", required=True)
    ap.add_argument("--out", required=True)
    ap.add_argument("--bpm-hint", type=float, default=None)
    a = ap.parse_args()
    if not os.path.isfile(a.inp):
        raise FileNotFoundError(a.inp)
    doc = analyze(a.inp, a.bpm_hint)
    write_json(a.out, doc)
    emit({"ok": True, "out": os.path.abspath(a.out), "bpm": doc["bpm"],
          "measured_bpm": doc["measured"]["bpm"], "beats": len(doc["beats"]),
          "first_beat": doc["beats"][0] if doc["beats"] else None,
          "lag_ms": doc["lag_ms"], "bar_phase": doc["bar_phase"],
          "fallback": doc["fallback"]})


if __name__ == "__main__":
    run_main(main)
