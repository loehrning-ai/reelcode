"""Audio tests for reelcode (docs/SPEC.md §6).

Run:  npx reelcode test --py                       (what CI runs)
 or:  .venv/bin/python -I engine/audio/test_audio.py   (prints a results table)

Everything goes through the real CLIs (one JSON line on stdout, exit 0/1),
so the contract make.mjs relies on is what gets tested.
"""
import atexit
import filecmp
import json
import os
import shutil
import subprocess
import sys
import tempfile

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)

import numpy as np  # noqa: E402

import beats as beats_mod  # noqa: E402
from common import SR, band_db, read_wav  # noqa: E402
from sfx import PEAK_AT, SFX, make, peak_at  # noqa: E402

ROOT = os.path.dirname(os.path.dirname(HERE))
PY = sys.executable
# style -> bpm chosen so that 8 s is a whole number of bars
STYLE_BPM = {"minimal-tech": 120, "punchy-pop": 120, "ambient-cinematic": 90, "lofi": 90}
RESULTS = []
_TMP = tempfile.mkdtemp(prefix="reelcode_audio_")
atexit.register(shutil.rmtree, _TMP, True)


def cli(script, *args, expect_ok=True):
    p = subprocess.run([PY, "-I", os.path.join(HERE, script), *map(str, args)],
                       capture_output=True, text=True)
    lines = [ln for ln in p.stdout.strip().splitlines() if ln.strip()]
    assert len(lines) == 1, f"{script}: expected one JSON line, got {p.stdout!r} {p.stderr[-500:]}"
    out = json.loads(lines[0])
    if expect_ok:
        assert p.returncode == 0 and out.get("ok"), f"{script} failed: {out} {p.stderr[-500:]}"
    else:
        assert p.returncode == 1 and out.get("ok") is False, f"{script} should fail: {out}"
    return out


def tmp(name):
    return os.path.join(_TMP, name)


def gen(style, bars=None, bpm=None, loop=False, seed=7, tag="", duration=None):
    wav, bj = tmp(f"{style}{tag}.wav"), tmp(f"{style}{tag}.json")
    args = ["--style", style, "--seed", seed, "--out", wav, "--beats", bj]
    args += ["--bars", bars] if bars else ["--duration", duration]
    if bpm:
        args += ["--bpm", bpm]
    if loop:
        args.append("--loop")
    return cli("music.py", *args), wav, bj


def listen_proxy(x, label):
    """Not silent, not clipped, energy across the spectrum, hit at t=0."""
    assert np.all(np.isfinite(x)), f"{label}: non-finite"
    peak = float(np.max(np.abs(x)))
    rms_db = 20 * np.log10(np.sqrt(np.mean(x ** 2)) + 1e-12)
    clipped = float(np.mean(np.abs(x) >= 0.999))
    assert peak <= 1.0 and clipped < 1e-4, f"{label}: clipped ({clipped:.2e})"
    assert rms_db > -30, f"{label}: too quiet ({rms_db:.1f} dBFS RMS)"
    bands = {"low": band_db(x, 20, 250), "mid": band_db(x, 250, 4000),
             "high": band_db(x, 4000, 16000)}
    for b, v in bands.items():
        assert v > -50, f"{label}: {b} band near-silent ({v:.1f} dB)"
    air = band_db(x, 18000, 24000)
    assert air < -25, f"{label}: hiss/aliasing dominates above 18 kHz ({air:.1f} dB)"
    head = float(np.max(np.abs(x[:, : int(0.03 * SR)])))
    assert head >= 0.2 * peak, f"{label}: no downbeat hit at t=0"
    return {"rms_db": round(rms_db, 1), **{k: round(v, 1) for k, v in bands.items()}}


# ---------------------------------------------------------------- music
def test_styles_8s_bpm_lufs():
    """Each style for 8 s: exact length + grid, listen proxy, librosa bpm, -14 LUFS mix."""
    for style, bpm in STYLE_BPM.items():
        summ, wav, bj = gen(style, bpm=bpm, duration=8, tag="_8s")
        doc = json.load(open(bj))
        bars = summ["bars"]
        assert abs(bars * 4 * 60 / bpm - 8.0) < 1e-9, (style, bars)
        x = read_wav(wav)
        assert x.shape == (2, round(bars * 4 * 60 / bpm * SR)), x.shape
        spb = 60 / bpm
        assert doc["beats"] == [round(k * spb, 6) for k in range(bars * 4)]
        assert doc["downbeats"] == doc["beats"][::4] and doc["beats"][0] == 0
        assert doc["source"] == "synth" and doc["lag_ms"] == 0 and doc["duration"] == 8.0
        proxy = listen_proxy(x, style)
        # measured tempo + phase with NO hint (as if it were a supplied track)
        m = beats_mod.analyze(wav)
        assert abs(m["measured"]["fit_bpm"] - bpm) / bpm < 0.01, (style, m["measured"])
        assert abs(m["bpm"] - bpm) < 1e-6, (style, m["bpm"])
        assert abs(m["beats"][0]) < 0.005 and m["bar_phase"] == 0, (style, m["beats"][:2])
        mix = cli("mix.py", "--music", wav, "--duration", 8.0, "--out", tmp(f"{style}_mix.wav"))
        assert abs(mix["I"] + 14) <= 0.5 and mix["TP"] <= -1.0, mix
        RESULTS.append({"style": style, "bpm": bpm, "librosa_raw": m["measured"]["bpm"],
                        "fit_bpm": m["measured"]["fit_bpm"], "grid_bpm": m["bpm"],
                        "I": mix["I"], "TP": mix["TP"], "LRA": mix["LRA"],
                        "mode": mix["loudnorm"]["normalization_type"], **proxy})


def test_two_bars_deterministic_and_exact():
    for style in STYLE_BPM:
        _, a, ja = gen(style, bars=2, tag="_d1")
        _, b, jb = gen(style, bars=2, tag="_d2")
        assert filecmp.cmp(a, b, shallow=False), f"{style}: wav not byte-identical"
        assert filecmp.cmp(ja, jb, shallow=False), f"{style}: beats.json differs"
        _, c, _ = gen(style, bars=2, seed=8, tag="_d3")
        assert not filecmp.cmp(a, c, shallow=False), f"{style}: seed has no effect"


def test_non_integer_length_and_keys():
    s, wav, _ = gen("lofi", bars=2, bpm=84, tag="_84")
    assert read_wav(wav).shape[1] == round(2 * 4 * 60 / 84 * SR)
    for key in ("F# major", "Bb minor", "E minor"):
        cli("music.py", "--style", "punchy-pop", "--bars", 1, "--key", key,
            "--out", tmp("k.wav"), "--beats", tmp("k.json"))
    cli("music.py", "--style", "punchy-pop", "--bars", 1, "--key", "H dorian",
        "--out", tmp("k.wav"), "--beats", tmp("k.json"), expect_ok=False)


def test_loop_seam():
    for style in STYLE_BPM:
        _, wav, _ = gen(style, bars=2, loop=True, tag="_loop")
        x = read_wav(wav)
        step = np.max(np.abs(x[:, 0] - x[:, -1]))
        p99 = np.percentile(np.abs(np.diff(x, axis=1)), 99)
        assert step <= p99, f"{style}: seam step {step:.3f} > p99 {p99:.3f}"


# ---------------------------------------------------------------- sfx
def test_sfx_library():
    for name in SFX:
        a, b = make(name, 11), make(name, 11)
        assert np.array_equal(a, b), f"{name}: not deterministic"
        assert np.all(np.isfinite(a)) and 0.3 < np.max(np.abs(a)) <= 1.0, name
        assert not np.array_equal(a, make(name, 12)), f"{name}: seed ignored"
    assert PEAK_AT["click"] == 0 and PEAK_AT["riser"] == 2.0 and peak_at("riser", 1.5) == 1.5
    assert abs(peak_at("whoosh") - 0.42) < 1e-9 and abs(peak_at("swish") - 0.15) < 1e-9
    assert make("tick", 1).size == round(0.012 * SR)
    out = cli("sfx.py", "preview", "--out", tmp("preview"))
    assert set(out["ms"]) == set(SFX)


# ---------------------------------------------------------------- cues
def _cues(cues, total=16, loop=False, beats=None, bpm=120):
    cj, bj, oj = tmp("c.json"), tmp("b.json"), tmp("ct.json")
    json.dump({"bpm": bpm, "totalBeats": total, "loop": loop, "cues": cues}, open(cj, "w"))
    spb = 60 / bpm
    json.dump(beats or {"bpm": bpm, "beats": [k * spb for k in range(total)]}, open(bj, "w"))
    return cj, bj, oj


def test_cues_snap_and_peak():
    cj, bj, oj = _cues([{"beat": 4.0, "sfx": "whoosh", "gain_db": -6, "pan": 0, "id": "feat1:0"},
                        {"beat": 4.0, "sfx": "pop", "id": "feat1:1"},
                        {"beat": 6.02, "sfx": "click", "id": "x:0"},
                        {"beat": 99, "sfx": "click", "id": "late:0"}])
    s = cli("cues.py", "--cues", cj, "--beats", bj, "--out", oj)
    assert s["dropped"] == 1 and s["max_offgrid_ms"] <= 10
    c = {q["id"]: q for q in json.load(open(oj))["cues"]}
    assert c["feat1:0"]["hit_t"] == 2.0 and abs(c["feat1:0"]["t"] - (2.0 - 0.42)) < 1e-6
    assert c["feat1:1"]["t"] == 2.0
    assert c["x:0"]["hit_t"] == 3.0                     # 6.02 beats snaps to 6.0
    import zlib
    assert c["feat1:0"]["seed"] == zlib.crc32(b"feat1:0")
    # measured (offset, non-uniform) grid: interpolation + extrapolation
    cj, bj, oj = _cues([{"beat": 1.5, "sfx": "click", "id": "a"},
                        {"beat": 5.0, "sfx": "click", "id": "b"}], total=8,
                       beats={"bpm": 120, "beats": [0.03, 0.53, 1.04, 1.53]})
    cli("cues.py", "--cues", cj, "--beats", bj, "--out", oj)
    c = {q["id"]: q for q in json.load(open(oj))["cues"]}
    assert abs(c["a"]["hit_t"] - 0.785) < 1e-6 and abs(c["b"]["hit_t"] - 2.53) < 1e-6
    cj, bj, oj = _cues([{"beat": 1, "sfx": "kaboom", "id": "z"}])
    cli("cues.py", "--cues", cj, "--beats", bj, "--out", oj, expect_ok=False)


def test_loop_riser_wraps():
    cj, bj, oj = _cues([{"beat": 16, "sfx": "riser", "id": "loop:riser"}], loop=True)
    cli("cues.py", "--cues", cj, "--beats", bj, "--out", oj)
    q = json.load(open(oj))["cues"][0]
    assert q["hit_t"] == 0.0 and abs(q["t"] + 2.0) < 1e-6 and q["dur"] == 2.0
    cli("sfx.py", "render", "--cues", oj, "--duration", 8, "--loop", "--out", tmp("r.wav"))
    x = read_wav(tmp("r.wav"))
    tail, head = np.abs(x[:, -int(0.5 * SR):]).max(), np.abs(x[:, : int(0.5 * SR)]).max()
    assert tail > 0.1 and head < 0.01, (tail, head)   # riser sits at the end, into the wrap


# ---------------------------------------------------------------- mix
def test_mix_4bars_3cues():
    _, wav, bj = gen("minimal-tech", bars=4, tag="_mix")
    cj = tmp("mc.json")
    json.dump({"bpm": 120, "totalBeats": 16, "loop": False, "cues": [
        {"beat": 0, "sfx": "thump", "gain_db": -4, "pan": 0, "id": "hook:0"},
        {"beat": 4, "sfx": "whoosh", "gain_db": -6, "pan": -0.3, "id": "s2:0"},
        {"beat": 8.5, "sfx": "pop", "gain_db": -6, "pan": 0.3, "id": "s3:0"}]}, open(cj, "w"))
    cli("cues.py", "--cues", cj, "--beats", bj, "--out", tmp("mct.json"))
    cli("sfx.py", "render", "--cues", tmp("mct.json"), "--duration", 8, "--out", tmp("msfx.wav"))
    m = cli("mix.py", "--music", wav, "--sfx", tmp("msfx.wav"), "--cues", tmp("mct.json"),
            "--duration", 8, "--out", tmp("mmix.wav"))
    assert abs(m["I"] + 14) <= 0.5 and m["TP"] <= -1.0, m
    x = read_wav(tmp("mmix.wav"))
    assert x.shape == (2, 8 * SR)
    listen_proxy(x, "mix")


def test_mix_loop_hot_input_stays_linear():
    """A very hot, crest-heavy input still lands at -14 / <= -1 dBTP in linear mode."""
    _, wav, _ = gen("punchy-pop", bars=2, loop=True, tag="_hot")
    x = read_wav(wav)
    x[:, SR // 6:: SR // 3] = 1.0                        # inject sharp transients (off the seam)
    from common import write_wav
    write_wav(tmp("hot.wav"), x, subtype="FLOAT")
    m = cli("mix.py", "--music", tmp("hot.wav"), "--duration", 4.0, "--loop",
            "--out", tmp("hotmix.wav"))
    assert abs(m["I"] + 14) <= 0.5 and m["TP"] <= -1.0 and m["seam_ok"], m
    assert m["loudnorm"]["normalization_type"] == "linear", m["loudnorm"]


# ---------------------------------------------------------------- beats.py
def test_beats_recovers_known_grid():
    """An 8-bar, 120 bpm synth track has a grid we know exactly: every beat on k * 0.5 s, bars on every 4th beat.
    The measured grid must land on it within 3 ms, with the tracker's lag removed."""
    _, wav, _ = gen("minimal-tech", bars=8, bpm=120, tag="_grid")
    out = cli("beats.py", "--in", wav, "--out", tmp("grid_beats.json"))
    d = json.load(open(tmp("grid_beats.json")))
    assert d["bpm"] == 120.0 and len(d["beats"]) == 32, out
    assert np.max(np.abs(np.array(d["beats"]) - np.arange(32) * 0.5)) < 0.003
    assert d["downbeats"][:3] == [0.0, 2.0, 4.0] and d["source"] == "measured"
    assert 0.0 in d["hits_snapped"]
    RESULTS.append({"style": "minimal-tech 8 bars (beats.py)", "bpm": 120,
                    "librosa_raw": d["measured"]["bpm"], "fit_bpm": d["measured"]["fit_bpm"],
                    "grid_bpm": d["bpm"], "I": None, "TP": None, "LRA": None,
                    "mode": f"lag {d['lag_ms']} ms removed"})


def test_beats_offset_and_odd_tempo():
    _, wav, _ = gen("punchy-pop", bars=4, bpm=117.3, tag="_odd")
    x = read_wav(wav)
    from common import write_wav
    off = np.concatenate([np.zeros((2, int(0.037 * SR))), x], axis=1)
    write_wav(tmp("off.wav"), off)
    cli("beats.py", "--in", tmp("off.wav"), "--out", tmp("off.json"))
    d = json.load(open(tmp("off.json")))
    assert abs(d["bpm"] - 117.3) < 0.05, d["bpm"]
    assert abs(d["beats"][0] - 0.037) < 0.003, d["beats"][:2]
    assert d["bar_phase"] == 0
    # octave error folded by the hint
    cli("beats.py", "--in", tmp("off.wav"), "--out", tmp("off2.json"), "--bpm-hint", 117.3)
    assert json.load(open(tmp("off2.json")))["bpm"] == 117.3


# ---------- v2: voice-over (voice.py) and supplied-music fitting (fit.py) ----------
def _speechy(sec, f0=180.0, seed=1, lead=0.25, tail=0.3):
    """A deterministic speech-like burst (AM harmonic tone) with silent lead/tail, stereo 48 kHz."""
    rng = np.random.default_rng(seed)
    t = np.arange(int(sec * SR)) / SR
    tone = sum(np.sin(2 * np.pi * f0 * k * t) / k for k in range(1, 6))
    am = 0.55 + 0.45 * np.sin(2 * np.pi * 4.0 * t + rng.uniform(0, 6))
    x = 0.2 * tone * am * np.hanning(t.size) ** 0.2
    x = np.r_[np.zeros(int(lead * SR)), x, np.zeros(int(tail * SR))]
    return np.stack([x, x])


def _rms_db(x):
    return 20 * np.log10(np.sqrt(np.mean(np.asarray(x) ** 2)) + 1e-12)


def test_voice_prep_place_exact_segments():
    from common import write_wav
    a, b = tmp("l1.wav"), tmp("l2.wav")
    write_wav(a, _speechy(1.2, seed=1, lead=0.25))
    write_wav(b, _speechy(0.6, seed=2, lead=0.10))
    pr = cli("voice.py", "prep", "--in", a, b, "--out-dir", tmp("prep"))
    d = [ln["duration"] for ln in pr["lines"]]
    assert abs(pr["lines"][0]["trim_head"] - 0.235) < 0.02, pr["lines"][0]
    assert abs(d[0] - 1.2) < 0.08 and abs(d[1] - 0.6) < 0.08, d
    plan = tmp("plan.json")
    json.dump({"items": [{"file": pr["lines"][0]["file"], "start": 0.5, "text": "one"},
                         {"file": pr["lines"][1]["file"], "start": 2.25, "text": "two"}]}, open(plan, "w"))
    r = cli("voice.py", "place", "--plan", plan, "--duration", 4, "--out", tmp("voice.wav"))
    segs = r["segments"]
    assert [s["start"] for s in segs] == [0.5, 2.25], segs
    assert abs(segs[0]["end"] - (0.5 + d[0])) < 1e-5 and segs[1]["text"] == "two"
    v = read_wav(tmp("voice.wav"))
    assert v.shape[1] == 4 * SR
    s0 = int(0.5 * SR)
    assert np.abs(v[:, : s0 - 1]).max() == 0.0, "silence before the first segment"
    assert np.abs(v[:, s0: s0 + int(0.03 * SR)]).max() > 0.01, "speech starts at the segment start"
    # overlap and overrun are refused
    json.dump({"items": [{"file": pr["lines"][0]["file"], "start": 0.5},
                         {"file": pr["lines"][1]["file"], "start": 1.0}]}, open(plan, "w"))
    assert "before line 1 ends" in cli("voice.py", "place", "--plan", plan, "--duration", 4, "--out", tmp("x.wav"), expect_ok=False)["error"]
    json.dump({"items": [{"file": pr["lines"][0]["file"], "start": 3.5}]}, open(plan, "w"))
    assert "outside the film" in cli("voice.py", "place", "--plan", plan, "--duration", 4, "--out", tmp("x.wav"), expect_ok=False)["error"]


def test_voice_regions_and_fit():
    from common import write_wav
    x = np.concatenate([_speechy(0.8, seed=3, lead=0.5, tail=0.6), _speechy(0.5, seed=4, lead=0.0, tail=0.4)], axis=1)
    write_wav(tmp("rec.wav"), x)
    reg = cli("voice.py", "regions", "--in", tmp("rec.wav"))["regions"]
    assert len(reg) == 2, reg
    assert abs(reg[0][0] - 0.5) < 0.05 and abs(reg[1][0] - 1.9) < 0.06, reg
    cli("voice.py", "fit", "--in", tmp("rec.wav"), "--duration", 4, "--out", tmp("recfit.wav"))
    assert read_wav(tmp("recfit.wav")).shape[1] == 4 * SR
    assert "after the film end" in cli("voice.py", "fit", "--in", tmp("rec.wav"), "--duration", 1.5, "--out", tmp("x.wav"), expect_ok=False)["error"]


def test_voice_sidechain_duck_depth():
    import voice
    n = 4 * SR
    t = np.arange(n) / SR
    bed = np.stack([0.3 * np.sin(2 * np.pi * 220 * t)] * 2)
    key = voice.duck_key(n, [{"start": 1.5, "end": 2.5}])
    assert key[int(1.5 * SR) - int(voice.ATTACK_S * SR) - 1] == 0 and key[int(2.0 * SR)] == 1.0
    for db in (-9.0, -4.0, -18.0):
        y = voice.sidechain_duck(bed, key, db, tmp(f"duck{db}"))
        assert y.shape == bed.shape
        win = slice(int(1.6 * SR), int(2.4 * SR))
        got = _rms_db(y[:, win]) - _rms_db(bed[:, win])
        assert abs(got - db) < 0.2, (db, got)
        assert abs(_rms_db(y[:, : SR]) - _rms_db(bed[:, : SR])) < 0.05, "no duck outside the voice"
    y1 = voice.sidechain_duck(bed, key, -9.0, tmp("dA"))
    y2 = voice.sidechain_duck(bed, key, -9.0, tmp("dB"))
    assert np.array_equal(y1, y2), "sidechain duck is deterministic"


def test_voice_mix_masters_and_ducks():
    from common import write_wav
    _, wav, bj = gen("punchy-pop", bars=4, bpm=120, tag="_vo")
    cli("mix.py", "--music", wav, "--duration", 8, "--out", tmp("bed.wav"))
    v = np.zeros((2, 8 * SR))
    seg = _speechy(1.5, f0=900.0, seed=5, lead=0, tail=0)
    s0 = int(2.0 * SR)
    v[:, s0: s0 + seg.shape[1]] = seg
    write_wav(tmp("vo.wav"), v)
    json.dump({"segments": [{"text": "x", "start": 2.0, "end": 2.0 + seg.shape[1] / SR}]}, open(tmp("vo.json"), "w"))
    outs = []
    for i in (1, 2):
        out = tmp(f"vomix{i}.wav")
        shutil.copy(tmp("bed.wav"), out)        # in place, like make
        r = cli("voice.py", "mix", "--mix", out, "--voice", tmp("vo.wav"), "--segments", tmp("vo.json"),
                "--duck-db", -9, "--out", out)
        assert abs(r["I"] + 14) <= 0.5 and r["TP"] <= -1.0, r
        outs.append(out)
    assert filecmp.cmp(outs[0], outs[1], shallow=False), "voice mix is deterministic"
    m, bed = read_wav(outs[0]), read_wav(tmp("bed.wav"))
    win = slice(int(2.3 * SR), int(3.2 * SR))
    voice_band = band_db(m[:, win], 850, 950) - band_db(bed[:, win], 850, 950)
    assert voice_band > 6, f"voice not on top of the bed ({voice_band:.1f} dB)"
    RESULTS.append({"style": "voice mix (duck -9)", "I": r["I"], "TP": r["TP"], "LRA": r["LRA"]})


def test_fit_supplied_track_modes():
    """A music.py track treated as SUPPLIED (3 bars, 120 bpm): in-point, trim, loop and fade-bar on bar lines."""
    _, src, _ = gen("punchy-pop", bars=3, bpm=120, seed=3, tag="_supplied")
    x = read_wav(src)
    spb = 0.5

    def fit(mode, beats, start=0.0, loop=False, ok=True):
        args = ["--in", src, "--out", tmp(f"fit_{mode}.wav"), "--beats", tmp(f"fit_{mode}.json"),
                "--total-beats", beats, "--start", start, "--mode", mode, "--bpm-hint", 120]
        return cli("fit.py", *(args + (["--film-loop"] if loop else [])), expect_ok=ok)

    # in-point on a downbeat (bar 1 = 2.0 s) + trim to 1 bar: sample-exact cut, bar-exact length, grid from 0
    r = fit("trim", 4, start=2.0)
    y, b = read_wav(tmp("fit_trim.wav")), json.load(open(tmp("fit_trim.json")))
    assert y.shape[1] == 4 * spb * SR and r["bars_per_copy"] is None
    assert np.allclose(y[:, : SR], x[:, 2 * SR: 3 * SR], atol=1e-6), "in-point is sample exact"
    assert b["beats"][0] == 0.0 and b["bar_phase"] == 0 and len(b["beats"]) == 4 and b["fit"]["start"] == 2.0
    # trim refuses a track that is too short
    assert 'use audio.fit "loop"' in fit("trim", 32, ok=False)["error"]
    # loop: 3 whole bars repeated to 8 bars; copies are bit-identical away from the folded ring-over
    r = fit("loop", 32)
    y, b = read_wav(tmp("fit_loop.wav")), json.load(open(tmp("fit_loop.json")))
    per = int(12 * spb * SR)
    assert y.shape[1] == 16 * SR and r["bars_per_copy"] == 3 and r["copies"] == 3, r
    seg = slice(int(0.2 * SR), int(1.0 * SR))
    assert np.allclose(y[:, per + seg.start: per + seg.stop], x[:, seg], atol=1e-6), "copy 2 == copy 1"
    assert len(b["beats"]) == 32 and abs(b["beats"][-1] - 15.5) < 1e-6 and b["downbeats"][4] == 8.0
    # the fitted loop measures back to the same grid (the period is whole beats)
    cli("beats.py", "--in", tmp("fit_loop.wav"), "--out", tmp("fit_loop_m.json"), "--bpm-hint", 120)
    m = json.load(open(tmp("fit_loop_m.json")))
    assert m["bpm"] == 120 and abs(m["beats"][0]) < 0.003 and len(m["beats"]) == 32, m["beats"][:3]
    # fade-bar: loud through bar 7, silent at the last sample, length on the bar line
    fit("fade-bar", 32)
    y = read_wav(tmp("fit_fade-bar.wav"))
    assert y.shape[1] == 16 * SR
    assert _rms_db(y[:, int(13 * SR): int(14 * SR)]) > _rms_db(y[:, int(15 * SR): int(16 * SR)]) + 6
    assert np.abs(y[:, -64:]).max() < 1e-3
    assert "breaks a loop:true film" in fit("fade-bar", 32, loop=True, ok=False)["error"]
    # mid-bar in-point is measured (bar_phase != 0) and still fills bar-exact
    fit("loop", 16, start=0.5)
    assert json.load(open(tmp("fit_loop.json")))["bar_phase"] == 3
    # the fitted track masters like any other (mix.py is a no-op length-wise)
    mx = cli("mix.py", "--music", tmp("fit_fade-bar.wav"), "--duration", 16, "--out", tmp("fit_mix.wav"))
    assert abs(mx["I"] + 14) <= 0.5 and mx["TP"] <= -1.0
    RESULTS.append({"style": "supplied fit fade-bar", "bpm": 120, "I": mx["I"], "TP": mx["TP"], "LRA": mx["LRA"]})


def _table():
    cols = ["style", "bpm", "librosa_raw", "fit_bpm", "grid_bpm", "I", "TP", "LRA", "mode",
            "rms_db", "low", "mid", "high"]
    rows = [[("" if r.get(c) is None else str(r.get(c))) for c in cols] for r in RESULTS]
    w = [max(len(c), *(len(r[i]) for r in rows)) for i, c in enumerate(cols)] if rows else []
    line = lambda v: "| " + " | ".join(s.ljust(w[i]) for i, s in enumerate(v)) + " |"  # noqa: E731
    print(line(cols))
    print("|" + "|".join("-" * (x + 2) for x in w) + "|")
    for r in rows:
        print(line(r))


def run_all():
    tests = [(k, v) for k, v in globals().items() if k.startswith("test_") and callable(v)]
    failed = 0
    for name, fn in tests:
        try:
            fn()
            print(f"PASS {name}")
        except AssertionError as e:
            failed += 1
            print(f"FAIL {name}: {e}")
    print()
    _table()
    shutil.rmtree(_TMP, ignore_errors=True)
    print(f"\n{len(tests) - failed}/{len(tests)} passed")
    return failed


if __name__ == "__main__":
    sys.exit(1 if run_all() else 0)
