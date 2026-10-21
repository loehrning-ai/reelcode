# explainer

A how-it-works film built around **one real shot that changes form at every step**: a dark film frame with a big
kinetic word (`CODE`) and an accent ball that bounces across the full frame on a clear arc (lands on every beat,
squashes on contact, a shadow that shrinks as it rises). Each step shows the thing itself in a hero shot, never a row
of boxes; every seam is a camera move on that object (alternating close-up / wide framings), never a heading swap.

1. **Cold open** (8 beats). Frame 0 is the real `seek(t)` source, full bleed, with `ball.y = bounce(t)` highlighted
   under the `hook` line (default "This is code."). b1: a ball pops at the end of that line (tick); b1.5 it falls;
   b2 it lands in the frame as the code slides out and the dark panel shrinks into the shot, `CODE` wiping in (thump):
   the hook becomes a true statement. b3: the frame splits into the four aspect frames (9:16 tall on the left, 4:5,
   1:1, 16:9 stacked beside it; one row in 16:9), labels on b3.5. b4: this format's frame grows into the step-1 hero,
   the others drop away, the question (`title`) masks in, the `kicker` lands under the frame, the rail grows in.
2. **Steps** (3–5). A compact numeral rolls beside the title, the hero plays. Hero kinds (`steps[].hero.kind`):
   - `scrub`: the frame fills the hero box; a scrubber drags t on every beat (tick); the poses it has visited stay as
     an onion skin of dimmed balls, so every tile shows time; a big `t = 1.25 s` timecode.
   - `paint`: the frame becomes a browser window over an **empty** canvas, then is built one primitive per beat,
     synced to the call in the address bar (`fillRect` → fill, `fillText` → word, `lineTo` → ground, `ellipse` →
     shadow, `arc` → ball); each call's bounding box flashes in the accent as it lands (swish).
   - `filmstrip`: a shutter flash stamps the canvas (click) and launches it into a filmstrip that streams past an
     accent gate stamping on every beat; vertical, top to bottom through the frame in 9:16 / 4:5 (the rate label on
     its own plate), horizontal in 1:1 / 16:9. `hero.label` (e.g. `×240/s`) is the rate.
   - `blend`: four sub-frames stack offset, collapse into one frame whose ball is a motion-blur streak (four dimmed
     copies merging along the arc), a waveform rises under it, and both lock into a play tile (thump).
   - `diagram` (default): the step's flow diagram, large, is the hero.
   Each hero's tail retracts its own props back to the base frame on the next step's first 0.6 beat. Picture hits
   lead their sound by 1/16 beat (~40 ms), so a state change already reads on the beat frame.
3. **Recap** (the remaining beats, at least `steps + 6`): a **chain reaction** of the hero objects under the recap
   line, one link per beat with its stage's sound. b0 the code block irises in; then per step: scrub = it fires into
   the frame (onion skin), paint = the frame repaints with accent flashes, filmstrip = it stamps into a running strip,
   blend = the strip collapses into the play tile. Next downbeat the play tile splits into the four aspect frames,
   which fly to their places (thump). Two beats before the end the 9:16 frame scales up out of its slot until the shot
   is the screen (whoosh); half a beat later it cuts to the lockup composed like the shot (`recap.end`, default
   `brand.name`, where `CODE` was; `recap.sub` on the next beat), and on the last beat the accent ball drops onto a
   cream ground rule that slams to length (thump, the card kicks): the final frame is a hit.

Defaults: 30 s, 96 bpm, `lofi`, D minor. Springs everywhere; type uses `stiff` (no overshoot). Nothing fades.

## Content fields (`project.json` → `content`)

| Field | Type | Notes |
|---|---|---|
| `title` | string ≤64, required | The question, landed at the end of the cold open. |
| `hook` | string ≤24 | Cold-open display line, about 3 words. Default `"This is code."` |
| `kicker` | string ≤40 | Small accent line under the frame at the end of the cold open. Default `"<n> steps"`. |
| `stepBeats` | int 6–16 | Beats per step. Default: as long as `duration` allows while leaving `steps + 5` recap beats. Needs ≥ `max(6, nodes + 2)`. |
| `steps[]` | 3–5 items, required | |
| `steps[].title` | string ≤32, required | Display font, 1–2 lines. |
| `steps[].hero` | `{kind, label?}` | `kind`: `scrub` · `paint` · `filmstrip` · `blend` · `diagram` (default). `label` ≤12: the big label a hero shows (filmstrip). |
| `steps[].body` | string ≤96 | Not drawn (the hero carries the step). Keep it as the voice-over script line. |
| `steps[].short` | string ≤10 | Rail label and recap node name. Default: first word of `title`. |
| `steps[].diagram` | required | `{nodes[1–4]: {label ≤12, kind?}, edges?, focus?}`. With a hero it is the 16:9 caption strip (labels only; dropped when it does not fit one row). With `diagram` it is the hero. |
| `recap.text` | string ≤60, required | The line over the pipeline. |
| `recap.end` | string ≤32 | The lockup line. Default `brand.name`, else the title. |
| `recap.sub` | string ≤72 | One line on the accent panel, drawn only where it fits on one line at the readable size. |

## Per-format layout (`stage.js`)

Laid out per aspect, not reflowed from one layout.
- **9:16, 4:5, 1:1.** Title band on top (numeral beside a 2-line title), then the hero filling the rest of the safe
  height (film ratio 0.72–1.4 in portrait, 1.15–1.78 in square, plus a prop band for the scrubber or waveform). No
  caption chips: the rail carries the structure. The hero geometry is identical for every step. 9:16 and 4:5 carry
  the rail on top like a stories bar.
- **16:9.** 40/60 columns: numeral, title and strip in the text column, the hero full height in the other. The
  columns swap on every other step; the hero object slides across on the cut, and the type waits (0.45 beat) until
  it has left the text column.
- **Captions on.** Everything stays above `api.captionTop`.

## SFX (derived from the scenes; nothing hand-written)

| Scene | Cues |
|---|---|
| intro | thump 0; tick 1 (ball pops); swish 1.5 (fall); thump 2 (lands); whoosh 3 (split); pop 3.5; whoosh 4; pop 4.5 (title), 5.5 (kicker) |
| step | pop 0, then per hero: scrub = tick per beat; paint = pop (bar), whoosh (clear), swish per draw call; filmstrip = click (shutter), whoosh, click per beat; blend = pop, whoosh, swish, thump (lock), pop, tick |
| recap | whoosh 0; one stage cue per link; thump (split), pop (labels), whoosh (frame grows), pop (card), pop (sub), swish (ball falls), thump (last beat) |

**Contrast.** Muted/accent/on-accent ink is checked against its real background (`ink.js`). The film frame is
`fg` with `bg`/`accent` parts, the strip is `muted`, so no text sits on a mid-tone fill.

## Files

`scene.js` (timing, cold open, steps, rail) · `stage.js` (per-aspect layout) · `heroes.js` (the five hero shots) ·
`film.js` (the shot, onion skin, streak, waveform, aspect-frame tiling) · `code.js` (the seek(t) source picture) ·
`strip.js` (16:9 caption chips) · `recap.js` (chain reaction) · `outro.js` (split, frame-to-card, ball-drop lockup) ·
`diagram.js` (flow diagrams for the `diagram` hero).

**Composition gate.** `node templates/explainer/check.mjs projects/<name>` samples one frame per beat and exits 1 when
the content spans < 70 % of the safe height, or stops above the lowest 20 % of it, for more than one beat in a row
(the dead lower band of a landscape card in a tall frame). Run it after every layout change.

**Voice-over example.** `projects/example-explainer` has a `vo` variant (`make --variant vo`, macOS only): six
lines spoken by the macOS `say` engine, ducked −9 dB, burned-in `clean` captions. It exists to show the timing and
caption plumbing. Apple licenses the system voices for personal, non-commercial use, so never publish that render;
for a real film, record the lines and switch the variant to engine `file`.
