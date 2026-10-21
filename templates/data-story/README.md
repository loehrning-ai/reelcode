# data-story

An animated data story built only from `content`. It opens on a **growth spine** (the start number at the head of an accent bar, then a hard cut as the head shoots on to value/from of its length and the end number slams in), then plays one **shot** per point, each with its own frame and claim position (a full-bleed bar race with a ghost year, a filmed line chart whose pen the camera tracks, comparison tracks, a 24-hour clock for hour-range bars, or a counter). Every cut after the hero is a **data hand-off with identity**: the outgoing shot's last data mark is drawn by the incoming shot as its own first mark (Riverside bar → pen dot → E-bike track → clock wedges → lockup underline). It closes on a kinetic lockup: the hero number at ~90% of the safe width, the takeaway word by word, one source line, the brand on the last beat with the last hit. Every number is formatted with `content.locale` through `Intl`.

Defaults: 20 s, 120 bpm, ambient-cinematic synth, D minor, all four formats (9:16, 1:1, 4:5, 16:9). Example: `projects/example-data` (20 s, fictional sample data, labelled as sample on screen and in the source line) uses the **sectioned score** (`score.py`, see Sound).

```sh
npx reelcode new --template data-story --name my-story
$EDITOR projects/my-story/project.json
npx reelcode lint projects/my-story --fast
npx reelcode make projects/my-story --quality draft
.venv/bin/python -I templates/data-story/score.py projects/my-story   # optional: sectioned score -> assets/score.flac
# then set "audio": {"music": "assets/score.flac", ...} in project.json and make again
node templates/data-story/check.mjs projects/my-story      # composition, hand-offs, seams, score gates (see Checks)
```

## Content fields

| Field | Type | Notes |
|---|---|---|
| `locale` | string | BCP 47 tag, default `en-US`. Used for every number. |
| `kicker` | string ≤ 24 | A one-word stamp on the start number's period row from frame 0, for example `SAMPLE`. |
| `title` | string ≤ 64 | Used as the lockup's small line only when there is no `source`. |
| `hero` | object | Optional opening: `value` (required), `from`, `fromLabel` / `toLabel` (the periods, e.g. 2021 / 2025), `label` (no period in it: the period is shown separately, so number, period and copy always agree), `accent` (a word of the label), `delta` (`ratio` default, or `none`), `deltaLabel` (keep it short or omit it; the chip shares the stamp row), number options, `beats` (default 5). `sub` is deprecated and not drawn. Use `fmt: "compact"`, `decimals: 1` for big numbers. A decline (`value` below `from`) works too: the spine starts at full length, retracts onto the end number, keeps the start length as a muted ghost, and the chip shows the % change. The spine is drawn to scale from about +40% (or −20% for a decline) up to 8.3× (or −70%); beyond that it is clamped. A smaller change stops with a message naming the limit: open on a `counter` point instead. |
| `points[]` | 1–6 objects | One shot each: `type`, `claim`, optionally `accent` (a word of the claim), `beats` (overrides the derived length) and the number options. `kicker` is accepted but no longer drawn (no corner index labels). |
| `takeaway` | string ≤ 90 | The closing statement; it lands word by word under the hero number (beats 1 to end−5). |
| `takeawayAccent` | string | A word of the takeaway, flipped to the accent two beats before the end. |
| `source` | string ≤ 160 | One small line on the lockup (wraps only when it cannot fit one line at a readable size; keep it short). Say "sample" or "fictional" when the data is not real. |

**Number options** (on `hero` and on every point): `fmt` is one of `int | pct | money | compact | x`. `decimals` 0–4. `unit` is appended verbatim (`" km"`). `prefix`, `currency` (ISO, default `USD`). `pct` takes percent values.

## Shots

| `type` | Fields | Shot |
|---|---|---|
| `race` | `keys` (2–8), `frames:[{label, values}]` (2–10), `highlight`, `step` (default 2) | Big headline across the top; bars run in from the frame's left edge with names inside; the frame label is a giant ghost numeral. Opens already moving. On the overtake the camera pushes in on the leading heads (riser, thump), pulls out two beats later, then the growth chip lands. In the last half beat the highlight bar collapses toward its head into a dot (its value keeps riding the head): that dot is the next shot's pen. Length 2·(frames−2)+3 beats. |
| `line` | `data:[{x, y}]` (3–24), `annotations` (≤ 4), `drawBeats` (default 4), `zero` | Opens pushed in (×2.2–2.4) with the pen tip exactly where the carried dot was, the line already drawn to its third point and the pen moving (never redrawn from zero); the camera drifts to frame the pen and tracks it, annotations pop as it reaches them, then it pulls out to the whole series and a delta pill lands. Claim bottom-left, set on the cut (no morph crosses it). Hands its end dot on. |
| `compare` | `items` (2), `delta: ratio \| pct \| diff \| none`, `deltaLabel` | 4 beats. The carried dot lands on the winner's head and its track unrolls behind it (already ~80% and still running); the other track races in (beats 0–1), the winner goes accent on beat 1, the delta stamps on beat 2, both tracks swell into the cut on beat 3. 9:16 and 4:5 run the tracks vertically from the foot of the frame (winner right column reaching the top, the other left, giant numerals riding the heads in the open middle); 1:1 and 16:9 run them edge to edge. Claim lands on beat 1. |
| `bars` | `data:[{label, value}]` (2–8), `highlight` | Hour-range labels (`"6–9"`, 0 ≤ a < b ≤ 24): a 24-hour clock. The two carried tracks bend into the highlight wedge and the next one (already full); the other wedges grow from the hub on the half beat; the hub label lands after the morph and rolls from `24 h` to the range on the highlight beat; the highlight slice pops out along its bisector in the last half beat. 5 beats for 6 ranges. Claim lands on beat 1. Other labels fall back to classic bars. |
| `counter` | `value`, `from`, `label` | A single counting number under a top claim. |

## Cuts and hand-offs

A builder returns `handOut` (one shape or a list) and `handIn(f)`; shapes are real marks: `{kind:'rect'}` (bar), `{kind:'disc'}` (dot), `{kind:'sector'}` (wedge), see `lib.js`. The shot wrapper (`scene.js`) draws, for the first 0.4 s of the incoming shot, each carried shape morphing into the incoming shot's own mark (`morphShape`: a point-wise perimeter morph; a dot becoming a bar first travels to the bar head, then the bar unrolls behind it), and the body hides that mark until the morph lands (`draw(f, p)`). There is no overlay slab: the outgoing shot anticipates with its own mark (bar collapses to a dot, tracks swell, the slice pops out), so no cut lands on a still. The race→line cut has no travelling shape at all: the line's camera puts its pen tip on the dot. Shots entered by a travelling morph land their headline one beat in. Morph boxes are logged as `handoff` marks for `check.mjs`.

## Per-format behaviour

Each shot composes per aspect. Hero: 9:16, 4:5 and 1:1 run the spine down the left edge with the start number in the top part and the end number in the bottom part at the new head; 16:9 runs it left to right through the middle with the start number under its left part and the end number standing on its right part. Compare: vertical tracks in tall frames, horizontal in square and wide. End: the same stack in every aspect, number at up to 90% of the safe width (height-capped in wide frames), centred vertically. No brand footer and no `NN / NN` index on point shots.

## Sound

`score.py` writes a sectioned cue from the project's own plan (`out/timeline.json` scene starts, `audio/cues.json` thumps): pad-only intro under the hero; hats and pulse building through the race with a riser; one beat of silence before the race overtake; kick, pumping bass, clap and arp from the overtake through the line; a stripped bed (pad, sparse arp, soft pulse) under compare and clock; one beat of silence before the lockup slam; the second drop on the slam; a stacked final hit on the last beat with the brand, then a hard stop. The engine's measured-track path snaps it to the exact grid (it is synthesized on it). Re-run it after a retime. Example: mix LRA 5.8 LU (the looped synth style gave 0.4).

| Shot | SFX markers |
|---|---|
| hero | `pop` on frame 0, `thump` on the smash cut, `pop` on the growth chip, `riser` into the first cut |
| race | `swish` per year tick, `riser` into the overtake, `thump` on it, `pop` on the growth chip |
| line | `swish` as the shot opens, `pop` per annotation, `thump` on the landing, `pop` on the delta pill |
| compare | `swish`, `tick`, `thump` on the winner, `pop` on the delta stamp |
| bars (clock) | `tick` per growing wedge, `thump` on the highlight |
| end | `thump` on the slam (beat 0), `tick` as the words start, `swish` as the underline runs out, `tick` on the source, `pop` on the accent flip, `thump` with the brand on the last beat |

## Length

Hero 5 + points (race 9, line 9 with `drawBeats: 6`, compare 4, clock 5 in the example) + the end lockup (`fill`, at least 5 beats; 8 in the example: slam, three word beats, underline run-out, source, accent flip, brand). The build fails with the duration it needs when content does not fit.

## Checks

`check.mjs` (template-local until lint grows template rules) fails, per scene and format, when the resting frame's ink bbox is under 70% of the safe height or under 60% of the safe width; when a hand-off shape covers more than 20% of a text box on more than 2 frames; when the frame at cut + 0.25 s has under 40% of the resting frame's ink; or when the frame before a cut is a still. Per project it fails when the mix LRA is under 4 LU or the loudest 0.5 s window does not start within ±1 beat of the final lockup (the last beat). lint covers safe area, size and contrast.

## Files

`scene.js` (hero spine, shot wrapper with the hand-off morph, build), `charts.js` (race, line), `shots.js` (compare, clock), `columns.js` (classic bars, counter), `end.js` (lockup), `lib.js` (springs, formatting, claim block, camera, hand-off shapes and morph, pills), `ink.js`, `check.mjs`, `score.py` (sectioned score).
