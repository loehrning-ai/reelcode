# Verifying the claims

Every number in the README comes from a command you can run. Output below is from the `example-showreel` project on an
Apple Silicon laptop (macOS, Node 26), 2026-10-22. Your hashes can differ across machines; the pass/fail results should not.

## Loudness and beat grid

```sh
npx reelcode make example-showreel --formats 1x1
```

```text
make: mix: 16.000s to -14 LUFS
make: lint: --fast on 1x1
audio   projects/example-showreel/audio/mix.wav      -       -    16.000s   -14.0   -2.5     50 cues
lint: pass  manifest: projects/example-showreel/out/manifest.json
```

`projects/example-showreel/out/manifest.json` holds the measurements the README quotes:

| Field | Value | Meaning |
|---|---|---|
| `audio.mix.I` | -14 | integrated loudness of the mix, LUFS (ebur128) |
| `audio.mix.TP` | -2.5 | true peak, dBTP (the limit is -1) |
| `audio.maxOffgridMs` | 0 | largest distance of any of the 50 cues from the 1/16 grid, in ms (the limit is 10) |
| `audio.beats`, `audio.cues`, `audio.mix.sha256` | hashes | the beat grid, the cue list and the mix |

## Determinism

```sh
npx reelcode lint example-showreel --format 1x1
```

```text
wrote projects/example-showreel/out/lint.json (0 errors, 0 warnings, 24 determinism hashes)
```

The full lint (it takes about two seconds on a rendered project) seeks frames forwards, backwards, interleaved and on a
fresh page and compares hashes; any mismatch is an error. "Same pixels" means the same project on the same machine setup
(same Chromium build, same fonts, same ffmpeg). Another Chromium build or OS can antialias differently.

## First-run and draft timing

`npx reelcode doctor` checks the toolchain before you download anything large. A cold draft of the 16 s showreel in 1:1
(no cached segments, fresh project) printed:

```text
make: [1x1] rendered 480 frames in 36.2s (0/16 segments from the cache)
```

and took 51 s wall time in total, including the music, the mix and the critique sheets. Four formats and 60 fps finals take
longer: see [REQUIREMENTS.md](REQUIREMENTS.md).

## Tests

```sh
npm test
```

runs the Node suite and the Python audio suite.
