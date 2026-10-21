# logo-sting

A 2–5 s logo reveal / bumper with an **audio logo**, and an optional **end card** (CTA + URL) that renders on its own
so it can be appended to any other film. Defaults: 4 s at 120 bpm (2 bars), `minimal-tech`, A minor, all four formats,
`loop: false` (a loop is refused: the sting ends on its lockup).

## Choreography (sting, local beats; `L` = `content.lock`, default 4)

| beat | on screen | sfx (`riser-hit`) |
|---|---|---|
| 0 | **hook, already moving**: the whole frame is the accent and the name is a band that overscans it. 16x9: one line at 1.12x the frame width, both ends cropped, panning left 8% of the width per beat. Tall / square: one balanced part per line (one word per line for two words) at 1.06x the width, drifting up | pop |
| `L/4` | the words split apart on the beat (first part left, second right): a kinetic offset | swish |
| `L/2` → `L` | the crop window closes in two moves: its vertical edges sweep in onto the mark's column while the words travel out through them (letters leave through the edge they move toward and are never sliced through the x-height); then the empty column closes vertically onto the plate | swish, riser (exposed) |
| `L` − ½ | half a beat of near-silence in the score (the riser ends here) | |
| `L` − 2 frames | anticipation: the plate tilts and dips | |
| `L` | **lock**: the plate is square with the mark inside and the name is cut on, **directly at its final geometry** (with an end card: the end card's hero lockup, `heroGeom` in its `lockBox`); one 30 fps frame floods the frame with the lockup reversed out; the mark pulses | thump; the score's full groove enters |
| `L+1` | the tagline masks in word by word | pop |
| last − 1 (end card only) | a copy of the plate drops out of the mark into the field's seat | pop |
| last | the accent full stop drops onto the name (squash); with an end card the seat grows into the full field over the last half beat, landing on the card's first beat | pop |

**One lockup geometry.** With an end card nothing is re-laid out after the lock: the sting locks onto the hero
lockup's final position and size, and the end card continues it (`check.mjs` fails any text that moves or rescales
more than 5% of the frame across a cut). Without an end card the sting uses `geom()` (row / stack, centred).

**End card** (`content.endCard`, 4 beats by default, 8 max) continues the sting: the lockup is already placed and the
field has just reached full size (rendered alone, frame 0 shows exactly that). The field is a full-width bottom band
in every aspect (tall 38%, square 30%, wide 28% of the height):

| aspect | composition |
|---|---|
| tall (9x16) | hero lockup (flush-left stack) top-anchored in the upper 62%; CTA + URL on the same left axis in the band |
| square (1x1, 4x5) | the same split at 70% |
| wide (16x9) | hero lockup in the upper 72% on the left axis (70% of the safe width); in the band the CTA on one line at hero UI size (cap ≥ 3% of the height) and the URL on the same baseline, right-aligned (cap ≥ 2.6%) |

Beats: 0 the CTA is cut out of the field (mask, pop), 1 the URL types on (tick), 2 the CTA is pressed: an on-accent
chip wipes in behind it and the CTA turns accent (click; an 8-beat card presses again on 6), last beat: a
quarter-beat wipe floods the whole frame so the hit frame is the full flood and the lockup is reversed out. The
tagline has a phone floor (cap ≥ 2.2% of the frame height).

**Sound: a three-act score.** The engine's synth styles loop one groove (kick on every beat), so they cannot step up
on the lock or build under the CTA. `score.py` renders the bed from music.py's instruments on the sting's beat plan:
act A (beats 0 to `L` − ½) filtered pad + 8th hats + a half-time pulse, no kick; a gated half-beat gap; act B (from the
lock) boom + kick on every beat, backbeat clap, 16th hats, 8th bass, arp (`minimal-tech`) or offbeat keys
(`punchy-pop`); a snare roll + riser through the two beats before the last; the last beat is a chord stab + boom +
kick + crash that rings to the end. The final hit lands on the film's last beat with no bed gap before it.

```
.venv/bin/python -I templates/logo-sting/score.py projects/<p>                    # -> assets/score.wav
.venv/bin/python -I templates/logo-sting/score.py projects/<p> --variant <id>     # -> assets/score-<id>.wav
```

then `"audio": {"music": "assets/score.wav", "fit": "trim"}` (a variant overrides `audio.music` with its file). The
score reads duration, bpm, `content.lock` and the key/style from project.json (variant overrides applied), so it needs
no make run first; re-run it whenever those change. Limitation: cutdowns cannot override `audio`, so a cutdown trims
the full score from 0 (the `endcard` cutdown gets act A under it); a project that needs a stand-alone end card with
its own arranged bed should use a variant. Without a supplied score the template still works on `audio.music: synth`
(flat bed).

`check.mjs` (`node templates/logo-sting/check.mjs projects/<p> [--format ..] [--variant ..] [--cutdown ..] [--no-audio]`)
is a local stand-in for lint rules: squash (anisotropic text > 3 frames), frame 0 under 15% inked, more than 2 beats
without a visible event, a last beat changing under 10% of the frame, any text that jumps or rescales > 5% across a
cut, a post-lock name whose size changes or is under 0.4x the hook's cap height (0.8x is unreachable: the hook band
overscans at 1.06-1.12x the frame width), any resting text in the last 2 s under a 2% cap height, a CTA that breaks onto
a one-word line, and on `mix.wav`: a lock RMS step under 8 dB, post-lock momentary loudness under −20 LUFS or > 6 LU
under the post-lock median, and a last-beat hit that is not ≥ 2 dB RMS over the lock and the loudest peak after it.

## Content fields (all optional; `content_schema` in `template.json` is the source of truth)

| field | meaning |
|---|---|
| `name` | Wordmark text in the display font (≤ 32). Default `brand.name`, else the title. |
| `tagline` | UI-font line under the name (≤ 56). One line when it fits at the readable size, else 2 balanced lines. |
| `mark.type` | `logo` (brand.logo through an iris), `monogram` (letters on the accent plate) or `none` (the plate collapses into the full stop). Default `logo` when the brand has one, else `monogram`. |
| `mark.text` | Monogram letters (1–3). Default: initials of the first two words of `name`. |
| `mark.crop` | `[x, y, w, h]` fractions of the logo image: the symbol, when the logo file also contains the name (Tallyport: `[0.0111, 0.0833, 0.2222, 0.8333]`). |
| `mark.wordmark` | `false` = the logo already contains the name: drawn whole, no typeset name. |
| `mark.radius` | Plate corner radius as a fraction of the mark side (default 0.22; match the logo's own square). |
| `layout` | Sting without an end card only (with one, the hero stack is used everywhere): `auto` (stack when the frame is narrower than 0.85, i.e. 9x16 and 4x5; row in 1x1 and 16x9), `row` or `stack`. Per format via `overrides.<fmt>.content.layout`. In a stack, a two-word name breaks onto 2 balanced lines when that is ≥ 1.3× larger. |
| `dot` | `false` drops the accent full stop. |
| `lock` | Beat of the lock hit, 2–8 (default 4). The sting needs `lock + 2` beats. |
| `audioLogo` | `riser-hit` (default) or `motif`. |
| `endCard` | `{cta*, url, beats (4–8, default 4)}`. Its beats come out of `duration`: sting beats = total − `endCard.beats`. |

Duration rule: `sting beats = 4·round(duration·bpm/240) − endCard.beats ≥ lock + 2`; the template errors with the
minimum duration otherwise, and warns if the sting falls outside 2–5 s.

## Appending the end card to another film

Declare cutdowns that keep one scene each; every rendition gets its own music length, cues and mix:

```jsonc
"cutdowns": [{ "id": "sting", "duration": 4, "keep": ["sting"] }, { "id": "endcard", "duration": 2, "keep": ["endcard"] }]
```

`make --cutdown endcard` writes `out/<variant>/endcard/<fmt>/draft.mp4`. The end card does not depend on the sting, so
rendered alone frame 0 is already its composition (lockup in place, field mostly in). To append it, concatenate
it with a film of the same format and fps (both are −14 LUFS), e.g.
`ffmpeg -i film.mp4 -i endcard.mp4 -filter_complex "[0:v][0:a][1:v][1:a]concat=n=2:v=1:a=1[v][a]" -map "[v]" -map "[a]" out.mp4`.
Use a variant with the other film's brand (`"brand": "@tallyport"`) so the card matches.

## Transparent / prores-alpha

Set `"transparent": true` and `"exports": ["prores-alpha"]`. The template never paints a full-frame background of
its own and never erases with the bg colour, so the alpha export keeps only the slab, plate, type, field and full stop.
The lock flash (one frame) and the end card's final flood are opaque accent over the whole frame.
Text on the accent (stencil, monogram, CTA) uses whichever of fg/bg contrasts better with the accent, so it stays
opaque in the alpha render.

## Per-format behaviour

- **With an end card:** one hero stack (`heroGeom` in the card's `lockBox`) from the lock to the end, every format.
- **Without an end card:** row (1x1, 16x9): mark (2.1 caps tall) + gap + name + full stop, at most 86% / 82% of the
  safe width; stack (9x16, 4x5): mark centred above the name on 1–2 lines; centred in the safe area and kept above
  `api.captionTop` when captions are on.
- The hook band is laid out per aspect (one overscanning line in 16x9, one part per line elsewhere), independent of
  the lockup; the crop window always closes onto the lockup's plate.

## SFX (derived from content beats only, identical in every format)

Sting: `pop` at 0, `riser` (−6 dB, ends half a beat before the lock) or the tick motif (−16 → −7 dB, ends before the
gap), `swish` at `L/4` and `L/2`, `thump` (−6 dB: the score's groove entry carries the lock) on the lock, `pop` for the
tagline, the seat and the full stop, `click` for the kick. End card: `pop` (CTA), `tick` (URL), `click` (press),
`riser` (−9 dB, up to 2 beats) + `thump` (0 dB) + `pop` on the last beat, the loudest hit of the film.

## Files

- `scene.js`: the beat plan, the hook band and two-move crop window, the lock onto the hero geometry, the field copy, the end card.
- `score.py`: the three-act score (supplied as `audio.music`).
- `check.mjs`: structure + sound check (node tool, not page code).
- `lockup.js`: per-format lockup geometry (row/stack, 2-line name, tagline fit, group centring) and the draw
  primitives (plate, mark content, name reveal, full stop); `heroGeom` is the end card's flush-left hero stack.
