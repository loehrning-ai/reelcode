# Audio

Everything a reelcode film sounds like is made in `engine/audio/`, by small Python command-line tools that `make`
calls in order. Each one is deterministic for its seed, works at 48 kHz, prints one JSON line on stdout and exits 0
or 1. They run with the venv python that `npx reelcode setup` creates (`.venv/bin/python -I <script>`).

## The tools

| Script | Does |
|---|---|
| `music.py --style S [--bpm N] [--key "A minor"] (--bars N \| --duration S) [--seed 7] [--loop] --out music.wav --beats beats.json` | Synthesises a track of exactly `bars * 4 * 60 / bpm` seconds (stereo, 24-bit). Beat 0 is a downbeat hit. A loop wraps its tails onto the start and builds a riser and a snare roll into the seam; a one-shot ends on a final downbeat with a 30 ms fade. Writes an exact `beats.json` (`source: "synth"`, `lag_ms: 0`). |
| `sfx.py preview --out DIR` / `sfx.py render --cues cues_timed.json --duration S [--loop] --out sfx.wav` | The effect library: `click pop thump whoosh riser swish tick`. `PEAK_AT` gives each effect's time to its hit. With `--loop`, anything before 0 or past the end wraps around. |
| `cues.py --cues cues.json --beats beats.json --out cues_timed.json [--div 4]` | Snaps each cue to 1/div of a beat (4 = 1/16 notes), converts to seconds on the real grid, subtracts `PEAK_AT` so the hit lands on the beat, and seeds each cue from its id. Loop films wrap cues; one-shots drop cues past the end. A riser without `dur` lasts one bar (at most 4 s) and is shortened to start at 0 in a one-shot. |
| `mix.py --music m.wav [--sfx s.wav --cues ct.json] --duration S [--loop] [--lufs -14] [--tp -1] --out mix.wav` | Ducks the music by 3 dB for 120 ms under each thump, fits to the duration, limits the oversampled peak so the loudness pass can stay linear, normalises in two passes and verifies the result with ebur128 (one linear trim when it reads 0.15 LU or more off). Checks the loop seam. |
| `beats.py --in track --out beats.json [--bpm-hint N]` | Measures a supplied track (below). |
| `fit.py` | Cuts and fits a supplied track to the film: `trim`, `loop` (whole bars) or `fade-bar`. |
| `voice.py` | Prepares, places, ducks and masters voice-over (`prep`, `place`, `regions`, `fit`, `mix`). |

## Styles

| Style | Default bpm and key | Character |
|---|---|---|
| `minimal-tech` | 120, A minor | four-on-the-floor kick, 8th-note pumping bass, saw pad, 1/16 pluck arpeggio |
| `punchy-pop` | 128, C major | syncopated kick, clap, 1/16 hats, I–V–vi–IV, a lead that calls and answers |
| `ambient-cinematic` | 90, D minor | a boom on each bar, a soft beat pulse, sine pad and sub, bell arpeggio, long reverb |
| `lofi` | 90, F major | swung 8ths, rim shots, walking bass, 7th-chord keys, vinyl crackle, a 7.5 kHz roll-off |

Each style is a dictionary in `music.py` (`STYLES[name]`): drum patterns, bass and pad choices, lead, swing, gains,
reverb and duck settings. Add a style by adding an entry; `test_audio.py` runs every style.

## Supplied tracks and `beats.py`

When `audio.music` points at a file inside the project, the film follows that track's beats instead of a synthetic
grid, so the beat tracker has to be right to the millisecond. A plain `librosa.beat.beat_track` call is not:
by default it trims beats near the edges and reports beats a little late. `beats.py` does this instead:

- It keeps the edges: the grid is extrapolated over `[0, duration)`, so no beats go missing at either end.
- It times attacks precisely: a causal 4 ms peak envelope, timed where it crosses 50 %, gives sample-accurate onsets.
  The median lag between those onsets and the tracked beats is reported as `lag_ms` and removed.
- It fits a constant tempo: a vote over candidate tempos within ±2 % of librosa's estimate, scored on those
  attacks, then refined by least squares. Off-grid hats and syncopation do not pull the grid.
- It corrects the usual errors: a `--bpm-hint` folds octave errors, a result within 1.5 % of the hint snaps to it,
  and a result within 0.15 of a whole BPM snaps to that whole number (`fit_bpm` keeps the raw value). If the fit
  fails, the hint grid is used and `fallback: true` is set.
- It finds the downbeat from the bar phase with the largest change in bass-register chroma (C1 to B3), with weaker
  full-chroma and low-onset terms; it never assumes that every fourth beat from the first is a downbeat.

The test suite renders a synthetic track with a known grid and checks that `beats.py` recovers every beat within
3 ms, at 120 bpm and at an odd tempo with an offset start.

## Voice-over

See [SPEC.md §6.6](SPEC.md#66-voice-over-libvoiceovermjs-voicepy). In short: `file` (your own recording) and
`elevenlabs` (needs `ELEVENLABS_API_KEY` in the environment) are for published films; `say` is macOS only and for
drafts, because Apple's licence does not cover publishing its voices.

## Tests

`npx reelcode test --py` (or `.venv/bin/python -I engine/audio/test_audio.py`) takes a few minutes and prints a
results table: lengths and loudness per style, exact beat grids, determinism, cue snapping, the mix, loop seams,
beat recovery, voice placement and ducking, and supplied-track fitting.
