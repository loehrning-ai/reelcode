"""data-story sectioned score: a synthesized cue with an intro, a build, a dropout, a drop, a stripped bed, a second
dropout and drop on the lockup, and a hard stop on the last beat. The engine's music.py styles loop one pattern for
the whole film (LRA ~0.4 LU); this script arranges the same instruments in sections that follow the film's story.

  .venv/bin/python -I templates/data-story/score.py projects/<name> [--out assets/score.flac] [--key "D minor"]

Sections come from the project's own plan (written by make): out/timeline.json (scene start beats) and
audio/cues.json (the race overtake thump and the end-lockup slam thump). Run make once, then this script, then point
project.json at the file (audio.music: "assets/score.flac") and make again. Same inputs -> same samples.

Section map (beats on the film grid):
  intro  [0, 2nd scene)            pad only, one soft boom on beat 0
  build  [2nd scene, drop-1)       pad + pulse + 8th hats rising, riser into the dropout
  gap    [drop-1, drop)            silence (gated, no reverb tail)
  drop   [drop, bed)               kick, pumping bass, clap on 2/4, 16th hats, arp      (drop = race overtake thump)
  bed    [bed, slam-1)             pad + sparse arp + soft pulse, no kick              (bed = 4th scene start)
  gap    [slam-1, slam)            silence
  drop2  [slam, last)              boom, kick, bass, clap, hats                         (slam = end scene's first thump)
  hit    last beat                 stacked final hit, then hard stop
"""
import argparse
import json
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
ENGINE_AUDIO = os.path.join(HERE, '..', '..', 'engine', 'audio')
sys.path.insert(0, os.path.abspath(ENGINE_AUDIO))

import numpy as np  # noqa: E402
import soundfile as sf  # noqa: E402
from scipy.signal import fftconvolve  # noqa: E402

import music as mu  # noqa: E402
from common import (SR, emit, fit_length, master, onepole_hp, parse_key, place,  # noqa: E402
                    rng_for, run_main, stereo)


def read_json(path):
    with open(path, 'r', encoding='utf-8') as fh:
        return json.load(fh)


def section_map(timeline, cues):
    """-> dict of section boundaries in beats, from scene starts and thump cues (fallbacks when a cue is missing)."""
    scenes = timeline['scenes']
    total = int(round(timeline['duration'] * timeline['bpm'] / 60))
    starts = [int(round(s['startBeat'])) for s in scenes]
    thumps = [c for c in cues if c.get('sfx') == 'thump']
    race = next((c['beat'] for c in thumps if c['id'].split(':')[0].endswith('-race')), None)
    second = starts[1] if len(starts) > 1 else 2
    drop = int(round(race)) if race is not None else second + 2
    bed = starts[3] if len(starts) > 3 else drop + 8
    end_start = starts[-1]
    slam = next((int(round(c['beat'])) for c in thumps if c['id'].startswith('end:')), end_start + 1)
    last = total - 1
    drop = max(drop, second + 1)
    bed = max(bed, drop + 1)
    slam = min(max(slam, bed + 2), last - 1)
    return {'total': total, 'intro': 0, 'build': second, 'drop': drop, 'bed': bed, 'slam': slam, 'last': last}


class Score:
    def __init__(self, bpm, key, sec, seed):
        self.bpm, self.sec, self.seed = bpm, sec, seed
        self.spb = 60.0 / bpm
        self.n = int(round(sec['total'] * self.spb * SR))
        self.pc, self.scale = parse_key(key)
        self.prog = [0, 5, 3, 4]
        self.bus = {k: np.zeros((2, self.n + 3 * SR)) for k in ('drums', 'bass', 'music', 'fx')}

    def t(self, beat):
        return beat * self.spb

    def rng(self, *tags):
        return rng_for(self.seed, 'score', *tags)

    def chord(self, beat):
        return mu.chord_notes(self.pc, self.scale, self.prog[(int(beat) // 4) % 4], True)

    def root(self, beat):
        return mu.bass_root(self.pc, self.scale, self.prog[(int(beat) // 4) % 4])

    def section(self, beat):
        s = self.sec
        if beat >= s['last']:
            return 'hit'
        if beat >= s['slam']:
            return 'drop2'
        if beat >= s['slam'] - 1:
            return 'gap'
        if beat >= s['bed']:
            return 'bed'
        if beat >= s['drop']:
            return 'drop'
        if beat >= s['drop'] - 1:
            return 'gap'
        if beat >= s['build']:
            return 'build'
        return 'intro'

    def pads(self):
        # one pad per bar segment, cut at every section edge so dropouts are clean
        s, edges = self.sec, sorted({0, *range(0, self.sec['total'], 4), self.sec['build'], self.sec['drop'] - 1,
                                     self.sec['drop'], self.sec['bed'], self.sec['slam'] - 1, self.sec['slam'], self.sec['last']})
        gain = {'intro': 0.30, 'build': 0.34, 'drop': 0.30, 'bed': 0.36, 'drop2': 0.30}
        for a, b in zip(edges, edges[1:] + [s['total']]):
            kind = self.section(a)
            if kind in ('gap', 'hit') or b <= a:
                continue
            sig = mu.pad_sine(self.chord(a), self.t(b - a) + 0.05)
            place(self.bus['music'], stereo(sig, -0.2) * 0.75 + stereo(sig, 0.2) * 0.25, self.t(a), gain[kind])

    def drums(self):
        s, d = self.sec, self.bus['drums']
        place(d, stereo(mu.boom(self.rng('boom0'))), 0.0, 0.35)
        for b16 in range(s['build'] * 4, s['last'] * 4):
            beat = b16 / 4
            kind, st = self.section(beat), b16 % 4
            t0 = self.t(beat)
            if kind == 'build':
                u = (beat - s['build']) / max(1, (s['drop'] - 1) - s['build'])
                if st == 0:
                    place(d, stereo(mu.kick(self.rng('pulse', b16), (70, 40, 14))), t0, 0.35 + 0.25 * u)
                if st in (0, 2) or (u > 0.5 and st in (1, 3)):
                    place(d, stereo(mu.hat(self.rng('hat', b16)), 0.25 if st % 2 else -0.25), t0, (0.06 + 0.12 * u) * (1.0 if st == 2 else 0.7))
            elif kind in ('drop', 'drop2'):
                if st == 0:
                    sig = mu.boom(self.rng('dboom', b16)) if beat in (s['drop'], s['slam']) else mu.kick(self.rng('kick', b16), (150, 45, 7.5))
                    place(d, stereo(sig), t0, 0.95)
                    if int(beat) % 2 == 1:
                        place(d, stereo(mu.snare(self.rng('clap', b16)), 0.05), t0, 0.5)
                place(d, stereo(mu.hat(self.rng('hat', b16), st == 2 and int(beat) % 4 == 3), 0.25 if st % 2 else -0.25), t0, 0.16 if st == 2 else 0.1)
            elif kind == 'bed' and st == 0 and int(beat) % 2 == 0:
                place(d, stereo(mu.kick(self.rng('bpulse', b16), (70, 40, 14))), t0, 0.28)
        # the final hit: boom + kick + crash + low chord, the loudest moment of the film
        t_last = self.t(s['last'])
        place(d, stereo(mu.boom(self.rng('fboom'))), t_last, 1.0)
        place(d, stereo(mu.kick(self.rng('fkick'), (160, 45, 6.0))), t_last, 1.0)
        place(d, stereo(onepole_hp(mu.hat(self.rng('crash'), True), 3000)), t_last, 0.7)
        # riser into the first dropout (ends on the gap so the silence lands hard)
        ln = self.t(min(2, s['drop'] - 1 - s['build']))
        if ln > 0:
            place(self.bus['fx'], stereo(mu.riser_fx(self.rng('riser'), ln)), self.t(s['drop'] - 1) - ln, 0.35)
        ln2 = self.t(min(2, s['slam'] - 1 - s['bed']))
        if ln2 > 0:
            place(self.bus['fx'], stereo(mu.riser_fx(self.rng('riser2'), ln2)), self.t(s['slam'] - 1) - ln2, 0.3)

    def bass(self):
        s, b = self.sec, self.bus['bass']
        for b8 in range(s['drop'] * 2, s['last'] * 2):
            beat = b8 / 2
            kind = self.section(beat)
            if kind not in ('drop', 'drop2'):
                continue
            m = self.root(beat) + (12 if b8 % 4 == 3 else 0)
            place(b, stereo(mu.bass_note(m, self.spb * 0.45)), self.t(beat), 0.5)
        place(b, stereo(mu.bass_note(self.root(s['last']), self.spb * 1.0, 900)), self.t(s['last']), 0.7)
        place(self.bus['music'], stereo(mu.pad_saw(self.chord(s['last']), self.spb)), self.t(s['last']), 0.6)

    def arp(self):
        s, m = self.sec, self.bus['music']
        for b8 in range(s['build'] * 2, s['last'] * 2):
            beat = b8 / 2
            kind = self.section(beat)
            if kind == 'bed' and b8 % 2:
                continue
            if kind not in ('drop', 'drop2', 'bed'):
                continue
            tones = [x + 24 for x in self.chord(beat)]
            note = tones[[0, 2, 1, 3][b8 % 4]]
            place(m, stereo(mu.pluck(note, self.spb * 0.45, self.rng('arp', b8), 2500), -0.35 if b8 % 2 else 0.35),
                  self.t(beat), 0.22 if kind == 'bed' else 0.26)

    def gate(self):
        """1 everywhere except the two dropout beats (10 ms ramps): reverb tails do not leak into the silence."""
        g = np.ones(self.n + 3 * SR)
        r = int(0.01 * SR)
        for a in (self.sec['drop'] - 1, self.sec['slam'] - 1):
            i0, i1 = int(self.t(a) * SR), int(self.t(a + 1) * SR)
            g[i0:i1] = 0.0
            g[max(0, i0 - r):i0] = np.linspace(1, 0, i0 - max(0, i0 - r))
            g[i1 - r:i1] = np.linspace(0, 1, r)  # back up exactly on the drop sample
        return g

    def render(self):
        self.pads()
        self.drums()
        self.bass()
        self.arp()
        ir = mu.reverb_ir(self.rng('ir'), 2.0)
        mus = self.bus['music']
        wet = np.stack([fftconvolve(mus[c], ir[c])[: mus.shape[1]] for c in range(2)])
        mix = self.bus['drums'] + self.bus['bass'] + mus + wet * 0.35 + self.bus['fx']
        mix = mix * self.gate()[None, :]
        return master(fit_length(mix, self.n, loop=False, fade_ms=30), -1.0)


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('project')
    ap.add_argument('--out', default='assets/score.flac')
    ap.add_argument('--key', default='D minor')
    ap.add_argument('--seed', type=int, default=7)
    a = ap.parse_args()
    pdir = os.path.abspath(a.project)
    tl = read_json(os.path.join(pdir, 'out', 'timeline.json'))
    cues = read_json(os.path.join(pdir, 'audio', 'cues.json'))['cues']
    sec = section_map(tl, cues)
    y = Score(float(tl['bpm']), a.key, sec, a.seed).render()
    out = os.path.join(pdir, a.out)
    os.makedirs(os.path.dirname(out), exist_ok=True)
    sf.write(out, y.T, SR, subtype='PCM_24')
    emit({'ok': True, 'out': out, 'sections': sec, 'bpm': tl['bpm'], 'seconds': round(y.shape[1] / SR, 6)})


if __name__ == '__main__':
    run_main(main)
