"""example-morph music bed: the engine's minimal-tech synth with an arrangement arc baked in.

  .venv/bin/python -I projects/example-morph/assets/bed.py   (writes assets/bed.wav next to this file)

The film is 28 beats at 120 bpm (14 s, 7 bars, loop). engine/audio/music.py has no arrangement hook, so the bed is
rendered here from the same Song class and supplied to the project as a track (audio.music = assets/bed.wav):
  0.0 -  8.0 s  full bed (card punch, chart, tooltip, menu, toast, button)
  8.0 - 10.5 s  filter close: the mix crossfades into a 450 Hz low-pass and drops 7 dB (field typing, loader)
 10.5 - 11.5 s  the bed is muted for 2 beats; only the template's riser sfx plays into the bloom
 11.5 s         full band back on the bloom with a sub boom + open-hat crash (the lockup hit)
 11.5 - 14.0 s  full bed through the lockup; the snare roll of the last bar runs into the loop downbeat
Deterministic: same file every run (seeded synth, no randomness here).
"""
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, '..', '..', '..', 'engine', 'audio'))

import numpy as np  # noqa: E402

import music as MU  # noqa: E402
from common import SR, fit_length, master, onepole_hp, onepole_lp, place, stereo, write_wav  # noqa: E402

BPM, BARS, SEED, KEY = 120, 7, 7, 'A minor'
SPB = 60.0 / BPM
CLOSE_FROM, CLOSE_TO, MUTE_TO = 16 * SPB, 21 * SPB, 23 * SPB   # beats 16 / 21 / 23
LP_HZ, CLOSED_DB = 450.0, -7.0


def smooth(x):
    x = np.clip(x, 0.0, 1.0)
    return x * x * (3 - 2 * x)


class Bed(MU.Song):
    def fx(self):
        """No last-bar riser: the riser goes into the bloom (template sfx) and the loop riser comes from the cues."""

    def render(self):
        self.drums(); self.bass(); self.harmony(); self.melody(); self.fx()
        s = self.s
        tt = np.arange(self.n + self.tail) / SR
        kick_steps = [i for i, k in enumerate(s['kick']) if k]
        dist = np.full(tt.shape, 1e9)
        for bar in range(self.bars + 2):
            for st in kick_steps:
                d = tt - self.t_of(bar, st)
                dist = np.where((d >= 0) & (d < dist), d, dist)
        duck = 1 - s['duck'] * np.exp(-dist / (self.spb * 0.11))
        mus = self.bus['music']
        ir = MU.reverb_ir(self.rng('ir'), 1.6)
        mus = mus + np.stack([MU.fftconvolve(mus[c], ir[c])[: mus.shape[1]] for c in range(2)]) * s['reverb']
        mix = self.bus['drums'] + (self.bus['bass'] + mus) * duck
        # arrangement: filter close, 2-beat mute, full band back on the bloom
        a = smooth((tt - CLOSE_FROM) / (CLOSE_TO - CLOSE_FROM))
        lp = np.stack([onepole_lp(onepole_lp(ch, LP_HZ), LP_HZ) for ch in mix])
        g = 1 + (10 ** (CLOSED_DB / 20) - 1) * a
        mute = (tt >= CLOSE_TO + 0.01) & (tt < MUTE_TO - 0.004)
        g = np.where(mute, 0.0, g)
        fade_out = (tt >= CLOSE_TO) & (tt < CLOSE_TO + 0.01)
        g = np.where(fade_out, g * (1 - (tt - CLOSE_TO) / 0.01), g)
        fade_in = (tt >= MUTE_TO - 0.004) & (tt < MUTE_TO)
        g = np.where(fade_in, (tt - (MUTE_TO - 0.004)) / 0.004, g)
        a = np.where(tt >= MUTE_TO - 0.004, 0.0, a)
        mix = (mix * (1 - a) + lp * a) * g
        # the lockup hit: sub boom + open-hat crash on the bloom downbeat
        place(mix, stereo(MU.boom(self.rng('bloom'))), MUTE_TO, 1.0)
        place(mix, stereo(onepole_hp(MU.hat(self.rng('crash'), True), 3000)), MUTE_TO, 0.55)
        out = fit_length(mix, self.n, loop=True, fade_ms=30)
        return master(out, -1.0)


def main():
    y = Bed(MU.STYLES['minimal-tech'], BPM, KEY, BARS, SEED, True).render()
    out = os.path.join(HERE, 'bed.wav')
    write_wav(out, y)
    print(f'wrote {out} ({y.shape[1] / SR:.3f}s)')


if __name__ == '__main__':
    main()
