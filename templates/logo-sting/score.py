"""logo-sting three-act score: the bed is arranged on the sting's beat plan instead of one trimmed groove loop.

  .venv/bin/python -I templates/logo-sting/score.py projects/<name> [--variant id] [--out assets/score.wav]

The engine's synth styles loop one groove for the whole film (kick on every beat, flat LRA), so a sting cannot
step up on its lock or build under its CTA. This script renders the bed from music.py's instruments in three acts
and the project supplies it as a track (audio.music = the file, audio.fit = "trim"; a variant points at its own
file). Sections come from the project itself (duration, bpm, content.lock, content.endCard.beats), so it needs no
make run first. Same inputs -> same samples.

Act map (film beats; L = content.lock, N = total beats, last = N - 1):
  A    [0, L - 0.5)      no kick: low-passed pad, filtered 8th hats, a soft half-time pulse (the riser sfx is exposed)
  gap  [L - 0.5, L)      gated near-silence (no reverb tail)
  B    [L, last - 2)     the full groove enters on the lock: boom + kick on every beat, clap on the backbeat,
                         16th hats, 8th bass, arp (minimal) or offbeat keys (pop); pad
  build[last - 2, last)  groove kept + a snare roll (8ths -> 16ths, rising) and a riser under the CTA and URL
  hit  last beat         chord stab + boom + kick + crash together, ringing to the end of the film (hard stop)
"""
import argparse
import json
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.abspath(os.path.join(HERE, '..', '..', 'engine', 'audio')))

import numpy as np  # noqa: E402
from scipy.signal import fftconvolve  # noqa: E402

import music as mu  # noqa: E402
from common import (SR, emit, fit_length, master, onepole_hp, onepole_lp, parse_key, place,  # noqa: E402
                    rng_for, run_main, stereo, write_wav)


def read_json(path):
    with open(path, 'r', encoding='utf-8') as fh:
        return json.load(fh)


def merged(base, over):
    """Deep merge (dicts only), like the engine's variant overrides."""
    out = dict(base)
    for k, v in (over or {}).items():
        out[k] = merged(out[k], v) if isinstance(v, dict) and isinstance(out.get(k), dict) else v
    return out


def plan(project, template, variant):
    p = merged(template.get('defaults', {}), project)
    if variant and variant != 'main':
        v = next((x for x in project.get('variants', []) if x.get('id') == variant), None)
        if v is None:
            raise SystemExit(f'score.py: unknown variant {variant!r}')
        p = merged(p, v.get('overrides', {}))
    bpm = float(p.get('bpm', 120))
    total = 4 * int(round(float(p['duration']) * bpm / 240))
    content = p.get('content', {})
    lock = int(content.get('lock', 4))
    audio = p.get('audio', {})
    return {'bpm': bpm, 'total': total, 'lock': lock, 'last': total - 1,
            'key': audio.get('key') or 'A minor', 'style': audio.get('style', 'minimal-tech')}


class Score:
    def __init__(self, sec, seed=7):
        self.sec, self.seed = sec, seed
        self.spb = 60.0 / sec['bpm']
        self.n = int(round(sec['total'] * self.spb * SR))
        self.pc, self.scale = parse_key(sec['key'])
        self.pop = sec['style'] in ('punchy-pop', 'pop')
        self.prog = [0, 5, 3, 4] if not self.pop else [0, 4, 5, 3]
        self.bus = {k: np.zeros((2, self.n + 3 * SR)) for k in ('a', 'drums', 'bass', 'music', 'fx')}

    def t(self, beat):
        return beat * self.spb

    def rng(self, *tags):
        return rng_for(self.seed, 'sting-score', *tags)

    def chord(self, beat):
        return mu.chord_notes(self.pc, self.scale, self.prog[(int(beat) // 4) % 4], True)

    def root(self, beat):
        return mu.bass_root(self.pc, self.scale, self.prog[(int(beat) // 4) % 4])

    def act_a(self):
        """Pre-lock: filtered, no kick, a half-time pulse; ends half a beat before the lock."""
        s, a = self.sec, self.bus['a']
        end = s['lock'] - 0.5
        sig = mu.pad_sine(self.chord(0), self.t(end) + 0.3)
        place(a, stereo(sig, -0.2) * 0.7 + stereo(sig, 0.2) * 0.3, 0.0, 0.32)
        for b8 in range(int(end * 2)):
            beat = b8 / 2
            place(a, stereo(mu.hat(self.rng('ahat', b8)), 0.3 if b8 % 2 else -0.3), self.t(beat), 0.05 + 0.03 * (b8 % 2))
            if b8 % 4 == 0:   # half-time pulse: a soft low tom every 2 beats
                place(a, stereo(mu.kick(self.rng('apulse', b8), (75, 45, 16))), self.t(beat), 0.22)
        self.bus['a'] = np.stack([onepole_lp(a[c], 1800) for c in range(2)])

    def groove(self):
        s, d, b, m = self.sec, self.bus['drums'], self.bus['bass'], self.bus['music']
        L, last = s['lock'], s['last']
        place(d, stereo(mu.boom(self.rng('lockboom'))), self.t(L), 0.2)
        for b16 in range(L * 4, last * 4):
            beat, st = b16 / 4, b16 % 4
            rel = int(beat) - L
            if st == 0:
                place(d, stereo(mu.kick(self.rng('kick', b16), (150, 45, 7.5))), self.t(beat), 0.95)
                if rel % 2 == 1:
                    place(d, stereo(mu.snare(self.rng('clap', b16)), 0.05), self.t(beat), 0.5)
            place(d, stereo(mu.hat(self.rng('hat', b16)), 0.25 if st % 2 else -0.25), self.t(beat), 0.15 if st == 2 else 0.09)
        for b8 in range(L * 2, last * 2):
            beat = b8 / 2
            place(b, stereo(mu.bass_note(self.root(beat) + (12 if b8 % 4 == 3 else 0), self.spb * 0.45)), self.t(beat), 0.5)
            if self.pop:
                if b8 % 2 == 1:
                    place(m, stereo(mu.keys_chord([x + 12 for x in self.chord(beat)], self.spb * 0.4), 0.2), self.t(beat), 0.32)
            else:
                tones = [x + 24 for x in self.chord(beat)]
                place(m, stereo(mu.pluck(tones[[0, 2, 1, 3][b8 % 4]], self.spb * 0.45, self.rng('arp', b8), 2500),
                                -0.35 if b8 % 2 else 0.35), self.t(beat), 0.26)
        for a0 in range(L, last, 4):
            a1 = min(a0 + 4, last)
            sig = mu.pad_sine(self.chord(a0), self.t(a1 - a0) + 0.05)
            place(m, stereo(sig, -0.2) * 0.75 + stereo(sig, 0.2) * 0.25, self.t(a0), 0.3)

    def build(self):
        """A snare roll and a riser through the two beats before the last one (under the CTA and URL)."""
        s, d = self.sec, self.bus['drums']
        b0 = max(s['lock'] + 1, s['last'] - 2)
        steps = [(b0 + i / 2) for i in range(int((s['last'] - b0) * 2) // 2)] + \
                [(b0 + (s['last'] - b0) / 2 + i / 4) for i in range(int((s['last'] - b0) * 2))]
        for i, beat in enumerate(sorted(set(steps))):
            u = (beat - b0) / max(1e-6, s['last'] - b0)
            place(d, stereo(mu.snare(self.rng('roll', i), clap=False), 0.1 if i % 2 else -0.1), self.t(beat), 0.22 + 0.4 * u)
        ln = self.t(s['last'] - b0)
        place(self.bus['fx'], stereo(mu.riser_fx(self.rng('riser'), ln)), self.t(s['last']) - ln, 0.45)

    def hit(self):
        """The last beat: chord stab + boom + kick + crash together, the loudest moment of the film."""
        s, d = self.sec, self.bus['drums']
        t0 = self.t(s['last'])
        ring = self.t(1) + 0.4
        place(d, stereo(mu.boom(self.rng('fboom'))), t0, 1.0)
        place(d, stereo(mu.kick(self.rng('fkick'), (160, 45, 6.0))), t0, 1.0)
        place(d, stereo(onepole_hp(mu.hat(self.rng('crash'), True), 3000)), t0, 0.9)
        place(self.bus['bass'], stereo(mu.bass_note(self.root(0), ring, 900)), t0, 0.75)
        stab = mu.pad_saw([x + 12 for x in self.chord(0)], ring)
        place(self.bus['music'], stereo(stab, -0.15) * 0.6 + stereo(stab, 0.15) * 0.6, t0, 0.95)

    def gate(self):
        g = np.ones(self.n + 3 * SR)
        r = int(0.01 * SR)
        i0, i1 = int(self.t(self.sec['lock'] - 0.5) * SR), int(self.t(self.sec['lock']) * SR)
        g[i0:i1] = 0.0
        g[max(0, i0 - r):i0] = np.linspace(1, 0, i0 - max(0, i0 - r))
        return g

    def render(self):
        self.act_a()
        self.groove()
        self.build()
        self.hit()
        ir = mu.reverb_ir(self.rng('ir'), 1.6)
        mus = self.bus['music'] + self.bus['a'] * 0.6
        wet = np.stack([fftconvolve(mus[c], ir[c])[: mus.shape[1]] for c in range(2)])
        mix = self.bus['a'] + wet * 0.25 + self.bus['drums'] + self.bus['bass'] + self.bus['music'] + self.bus['fx']
        mix = mix * self.gate()[None, :]
        return master(fit_length(mix, self.n, loop=False, fade_ms=30), -1.0)


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('project')
    ap.add_argument('--variant', default='main')
    ap.add_argument('--out', default=None)
    ap.add_argument('--seed', type=int, default=7)
    a = ap.parse_args()
    pdir = os.path.abspath(a.project)
    project = read_json(os.path.join(pdir, 'project.json'))
    template = read_json(os.path.join(HERE, 'template.json'))
    sec = plan(project, template, a.variant)
    y = Score(sec, a.seed).render()
    out = os.path.join(pdir, a.out or ('assets/score.wav' if a.variant == 'main' else f'assets/score-{a.variant}.wav'))
    write_wav(out, y)
    emit({'ok': True, 'out': out, 'sections': sec, 'seconds': round(y.shape[1] / SR, 6)})


if __name__ == '__main__':
    run_main(main)
