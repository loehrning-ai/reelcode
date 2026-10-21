"""Beat-domain SFX cues -> timed cues on the measured grid (docs/SPEC.md §6.3).

  cues.py --cues audio/cues.json --beats audio/beats.json --out audio/cues_timed.json
          [--div 4]

Input (frozen contract, written by the page via __reelcode.cues()):
  {"bpm":120,"totalBeats":32,"loop":false,
   "cues":[{"beat":4.0,"sfx":"whoosh","gain_db":-6,"pan":0,"id":"feat1:0"}]}
  Optional per cue: "dur" (s) for whoosh/swish/riser (scenes set it as a time
  ref, engine/runtime.js deriveCues). A riser without dur is one bar long, or,
  in a non-loop film, shortened so it starts at t=0 (not before the film).

For each cue:
  1. snap the beat to 1/div of a beat (div=4 -> 1/16 notes, matching
     grid.snap(t, div=4) in engine/beat.js),
  2. convert to seconds against beats.json (interpolate between listed beats,
     extrapolate with 60/bpm past either end)  -> hit_t,
  3. t = hit_t - PEAK_AT[sfx] so the perceptual hit lands on the grid,
  4. seed = crc32(id).
With loop:true, beats outside [0, totalBeats) wrap. Without it, cues past the
end are dropped (reported in "dropped").
Output: {cues:[{t, hit_t, sfx, gain_db, pan, seed, id, dur?, beat}], max_offgrid_ms, ...}
Exits 1 if any hit_t is > 10 ms off the 1/div grid, or a cue is malformed.
"""
import argparse
import math
import os
import sys
import zlib

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import numpy as np  # noqa: E402

from common import emit, fail, read_json, run_main, write_json  # noqa: E402
from sfx import DEFAULT_DUR, SFX, peak_at  # noqa: E402

MAX_OFFGRID_MS = 10.0
MIN_RISER_S = 0.25


class Grid:
    """beats.json -> beat<->seconds mapping (mirrors engine/beat.js makeGrid)."""

    def __init__(self, doc):
        self.bpm = float(doc["bpm"])
        if self.bpm <= 0:
            raise ValueError("beats.json bpm must be > 0")
        self.spb = 60.0 / self.bpm
        b = np.asarray(doc.get("beats") or [0.0], dtype=float)
        if b.size > 1 and np.any(np.diff(b) <= 0):
            raise ValueError("beats.json beats must be strictly increasing")
        self.b = b

    def offgrid_ms(self, t, div):
        b = self.b
        if b.size > 1 and b[0] <= t <= b[-1]:
            i = min(int(np.searchsorted(b, t, side="right")) - 1, b.size - 2)
            step = (b[i + 1] - b[i]) / div
            return float(abs(t - (b[i] + round((t - b[i]) / step) * step)) * 1000)
        ref = b[0] if t < b[0] else b[-1]
        step = self.spb / div
        return float(abs(t - (ref + round((t - ref) / step) * step)) * 1000)

    def sec(self, beat):
        b, n = self.b, self.b.size
        if beat <= 0 or n == 1:
            return float(b[0] + beat * self.spb)
        if beat >= n - 1:
            return float(b[-1] + (beat - (n - 1)) * self.spb)
        i = int(math.floor(beat))
        return float(b[i] + (beat - i) * (b[i + 1] - b[i]))


def time_cues(cdoc, bdoc, div=4):
    grid = Grid(bdoc)
    total = float(cdoc.get("totalBeats") or 0)
    loop = bool(cdoc.get("loop", False))
    out, dropped, offgrid = [], [], 0.0
    for i, c in enumerate(cdoc.get("cues", [])):
        sfx = c.get("sfx")
        if sfx not in SFX:
            raise ValueError(f"cue {i}: unknown sfx {sfx!r} (allowed: {sorted(SFX)})")
        if not isinstance(c.get("beat"), (int, float)) or not math.isfinite(c["beat"]):
            raise ValueError(f"cue {i}: beat must be a finite number")
        cid = str(c.get("id") or f"cue:{i}")
        beat = round(float(c["beat"]) * div) / div
        if total > 0:
            if loop:
                beat = beat % total
            elif beat < 0 or beat > total:
                dropped.append(cid)
                continue
        hit_t = grid.sec(beat)
        # independent check in the seconds domain: distance of hit_t to the
        # nearest 1/div subdivision of the listed (possibly non-uniform) beats
        offgrid = max(offgrid, grid.offgrid_ms(hit_t, div))
        dur = c.get("dur")
        if sfx == "riser" and not dur:
            dur = min(4 * grid.spb, 4.0)           # one bar, capped
            if not loop and hit_t - dur < 0:
                # a riser into an early hit starts at t=0 instead of being cut off
                # before the film (an explicit dur is kept as given)
                dur = max(hit_t, MIN_RISER_S)
        if sfx in DEFAULT_DUR and not dur:
            dur = DEFAULT_DUR[sfx]
        cue = {"t": round(hit_t - peak_at(sfx, dur), 6), "hit_t": round(hit_t, 6),
               "sfx": sfx, "gain_db": float(c.get("gain_db", -6)),
               "pan": max(-1.0, min(1.0, float(c.get("pan", 0)))),
               "seed": zlib.crc32(cid.encode("utf-8")) & 0xFFFFFFFF, "id": cid,
               "beat": beat}
        if sfx in DEFAULT_DUR:
            cue["dur"] = round(float(dur), 6)
        out.append(cue)
    out.sort(key=lambda c: (c["hit_t"], c["id"]))
    return {"bpm": grid.bpm, "totalBeats": total, "loop": loop, "div": div,
            "duration": round(grid.sec(total), 6) if total > 0 else None,
            "cues": out, "max_offgrid_ms": round(offgrid, 3), "dropped": dropped}


def main():
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--cues", required=True)
    ap.add_argument("--beats", required=True)
    ap.add_argument("--out", required=True)
    ap.add_argument("--div", type=int, default=4, help="grid subdivisions per beat")
    a = ap.parse_args()
    if a.div < 1:
        fail("--div must be >= 1")
    doc = time_cues(read_json(a.cues), read_json(a.beats), a.div)
    write_json(a.out, doc)
    summary = {"ok": doc["max_offgrid_ms"] <= MAX_OFFGRID_MS,
               "out": os.path.abspath(a.out), "cues": len(doc["cues"]),
               "dropped": len(doc["dropped"]), "max_offgrid_ms": doc["max_offgrid_ms"]}
    if not summary["ok"]:
        fail(f"cue off grid by {doc['max_offgrid_ms']} ms (> {MAX_OFFGRID_MS})", **summary)
    emit(summary)


if __name__ == "__main__":
    run_main(main)
