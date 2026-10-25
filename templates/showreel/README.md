# showreel

A kinetic-type studio reel with fast cuts on the beat. Each shot uses a different type technique, and the brand is the subject. An accent **dot motif** carries across every cut: it is the full stop after a word, the bullet of a list row, and the leading edge of a band. The film loops seamlessly with a **vertical push**: over the last beat the settled end card slides up and out whole while shot 1 slides in from below, each carrying its own full stop (shot 1's grows in as its last word rises). Shot 1 lands exactly on the loop point, so frame 0 already shows shot 1 with its first word up, no frame is ever empty and no mask edge slices a glyph. A technique can ask for its own opener pre-roll (`scale` takes 0.5 beat, so frame 0 is the accent flood mid-slam and its thump lands on beat 0; the seam push then carries the zoom). Every shot also **pre-rolls** its clock (0.25 beat after a hard cut, 0.5 beat after a transition, 1 beat for shot 1 when looping unless the technique sets its own; `stack` and `metric` take 0.5, `split` and `grid` 0.75 so the cut frame is full). so the cut or reveal frame already has type on it. Sfx and events shift with the clock, and shot 1's early hits play in the seam tail.

Defaults: 16 s · 120 bpm (32 beats) · `punchy-pop` in E minor · `loop: true` · all four formats (9:16, 1:1, 4:5, 16:9). Needs no captures (`requires: []`). The `uiShot` technique alone needs `assets/assets.json` screens.

```sh
npx reelcode new --template showreel --name my-reel
# edit projects/my-reel/project.json -> content.shots
npx reelcode make projects/my-reel --quality draft
```

## Content fields

| Field | Type | Notes |
|---|---|---|
| `motif` | `"dot"` \| `"none"` | Default `dot`. With `none` there is no persistent dot, and the seam push carries no full stops. |
| `locale` | string | BCP 47 tag for every number the film formats (`metric`, `chart`). Default `en-US`; `de-DE` prints `3,8 %` and `1.234`. |
| `capture` | object | The `reelcode capture` recipe kept with the film: `states`, `routes`, `selectors`, `viewport`, `waitFor`, `warm`, `scroll`, `scrollOffset`, `hide` and more ([CLI.md](../../docs/CLI.md#capture)). Not used when rendering. |
| `shots[]` | 3–14 objects | Played in order. The beats must sum to the film length (`4·round(duration·bpm/240)`); otherwise set exactly one shot to `"fill"`. |
| `shots[].technique` | enum | See the table below. |
| `shots[].beats` | number 1–16 \| `"fill"` | Shot length in beats. Shots of 2–4 beats keep the cuts fast, and a new event lands at least every 3 s. |
| `shots[].text` | string ≤ 60 | The main word or phrase (the claim for `chart`, the label for `metric`, the title for `steps`). |
| `shots[].sub` | string ≤ 60 | A second line (`split`, `statement`, `steps` body, the `end` CTA pill). |
| `shots[].lines` | string[] 1–6, each ≤ 32 | Used by `kinetic`, `ticker` and `list`. |
| `shots[].accent` | string | The word to light in `kinetic`, the row to band in `ticker`, the letter to light in `grid`. |
| `shots[].url` | string ≤ 48 | Unused since the end card was rebuilt (kept in the schema so older projects still validate). |
| `shots[].transition` | `auto`\|`cut`\|`push`\|`wipe`\|`iris`\|`slats` | Default `auto` cycles push/cut/wipe/cut/slats/cut/iris/cut, each 0.5 beats. A `wipe` carries a hard accent leading edge. Engine-block shots never auto-cut (see Engine notes below). |
| `shots[].field` | `bg` \| `accent` \| `fg` | The colour field the shot sits on: `bg` (default), an `accent` flood (type in `bg`, highlight band in `bg` with accent type), or the `fg` (cream) inversion (type in `bg`, accent fills). Honoured by `ticker`, `grid`, `list`, `kinetic` and `formats`; `scale` is always an accent flood. Alternate it every 2–3 shots so the contact sheet reads as a colour rhythm, not a black wall. |
| `shots[].layout` | `bleed` \| `stack` | `statement` only. `bleed` (default) crops huge type with the frame (best for one short word); `stack` fills the safe area with masked lines. |
| `shots[].data` | object | `metric`: `{value, from?, unit?, prefix?, fmt?, decimals?}`. `chart`: `{type: bars\|line\|donut\|counter, series, highlight?, unit?, fmt?}`. |
| `shots[].screen`, `zoom`, `pieces` | strings | `uiShot` only. They are capture ids from `assets.json`. |

## Techniques

| technique | needs | What happens | Per-format layout |
|---|---|---|---|
| `kinetic` | `lines`, `accent?` | Words mask up on 1/16 notes (pop each); the accent word lights with a thump. Back half (last ¾ beat): every other word leaves up through its mask on 1/16 steps while the accent word grows (≤ 92 % frame width) toward the centre — a hand-off into the next shot. The dot is the accent word's full stop and travels with it. | 16:9 keeps the given lines; 9:16, 4:5 and 1:1 set one word per row (≤ 6 words), justified, filling the safe height. |
| `stack` | `text` | The word is echoed in rows that mask in on 1/8 notes and shear apart on beat 1 (thump). On the last beat the echoes leave up through their masks, outward from the middle (swish), and the accent row scales to ~90 % of the frame width (a single-word scale punch, tagged `bleed`) as the hand-off. | 7 rows (9:16), 5 (1:1), 4 (16:9). |
| `split` | `text`, `sub` | The word is sliced at its cap-middle. The halves part about 1.25 cap heights and a full-bleed accent band (0.7 cap) opens in the gap, so a strip of `bg` shows between each cut edge and the band; `sub` rises inside the band in `bg` only once the band is ~80 % open (clipped to it, so it never touches the cut edges). The template warns at build time if the format leaves no room to part. The dot hops onto the band as the sub's full stop. | Word centred in safe (30 / 34 / 40 % of safe height before opening). |
| `ticker` | `lines`, `accent?` | Full-bleed marquees run in opposite directions (tagged `bleed`), every row already running on the cut frame (a hard cut into motion, no slide-in). The type is capped so the longest word fits 92 % of the safe width. Portrait formats add rows, repeating the lines up to 7, to fill the height. The accent row sits in the middle and has no ` / ` separators; it brakes exponentially and locks its word whole and centred at beat 1.5, where the highlight band wipes it. The dot rides the band's leading edge and stops as the word's full stop. On `field: "accent"` the rows are `bg` and the band is `bg` with accent type. | Rows split the safe height; rows are added only in portrait. |
| `scale` | `text` | The hook: an accent flood with `bg` type that **slams** in from 6× (accelerating) and hits on local beat 0.5 — as the loop opener (`pre0: 0.5`) frame 0 IS the impact frame and its thump lands on beat 0. On local beat 1 the field splits open from the centre and the type inverts to accent on `bg` (no underline rule). The dot follows the type's colour across the split. | Wraps automatically inside the safe area. |
| `grid` | `text`, `accent?` | The letters sit on tiles that fill the safe area in two rows (so the word reads left to right in every aspect) and pop in on 1/8 notes. On beat 1 one tile takes the highlight (thump); from beat 1.75 the other tiles flip shut in sequence on 1/16 steps; then the highlight tile grows to the full frame while its letter zooms through (×12) — the grid is the transition. Pre-roll ¾ beat. | 2 rows × ⌈n/2⌉ columns in every format; tiles are tall in portrait, wide in 16:9. |
| `list` | `lines` | A full-height column: rows mask in on the beat at one shared size; the active row grows to the full safe width as it enters (and shrinks back when the next row takes over); on the last ¾ beat the inactive rows leave up through their masks. The dot is the bullet and springs to the active row. | Rows share the safe height equally in every format (baselines on a fixed pitch, so the active row never collides). |
| `end` | `text`, `sub?` | The lockup: the previous full-bleed accent field collapses into the slab while the name slams in **whole** (no per-character build), landing on the shot's first beat (`pre: 0.5`; the biggest thump of the film, plus a 3-beat riser into it); the dot thumps in as its full stop; the claim lands INSIDE the slab as `bg` display type sized to the slab; the slab punches on the next downbeat; ¾ beat before the seam the card inverts to `fg`. Put it last with 4 beats and set `poster` to `"b30.75"` (16 s). | 16:9: name left half, slab + claim fill the right half. 9:16/4:5: name top 30 %, tall slab below. 1:1: name top 36 %, slab 58 %. |
| `slam` | `text`, `sub` | Merges stack + split with a different verb per beat: echo rows (as many as fit at near full width) mask in; on beat 1 they **slam** together into one row at ~90 % of the safe width (thump); on beat 2 that row is sliced and its halves leave the frame while an accent band opens from the cut line revealing `sub` at the same scale (a match cut on the slice); on beat 3 the band floods the frame. 4 beats. | Rows fill the safe height. Portrait splits a single-word `sub` into two full-width lines (SYS / TEMS). |
| `montage` | `lines`, `text?` | Rapid-fire full-bleed capabilities: one word per beat, hard-cut ON the beat (`pre: 0`), each fitted to the frame and slamming down from 1.12×; the colour field flips on every cut (`bg` → `accent` → `fg` → …), so no two adjacent beats share field and layout. `text` is the payoff, set as the last cut of the sequence (one justified line per word, a half beat apart, dot as full stop). A line that ends in a number (`+105 %`, `2026`, `10x`) gets no dot, because a full stop there reads as punctuation or, in German, as an ordinal. Beats = words + payoff (≥ 1). Pops rise in gain per word. | 16:9: one line at full safe width. Portrait/square pick the layout that inks the most: one line, two halves (≥ 7 letters, e.g. LAUN/CHES) or, in portrait, one letter per row (≤ 5 letters). |
| `formats` | `text?` | Proof as ONE hero frame (~80 % of safe, accent flood) that snaps its aspect on the beat — 9:16, 1:1, 4:5, 16:9 (pop/tick per snap, thump on 16:9) — while `text` (default: shot 1's text, i.e. the opener) is re-fitted live for each aspect inside it, so the viewer watches the composition reflow. The aspect name is display type outside the frame and changes through its mask. On the last beat the 16:9 frame slams out to full bleed carrying the opener (the last frame rhymes with the hook) and becomes the end card's field. Put it right before `end`, on `field: "bg"`. | 16:9: name column left (25 %), frame right. Portrait/square: name band on top (18 %), frame below. |
| `statement` | `text`, `sub?`, `layout?` | `B.statementBlock`: `bleed` drops huge type cropped by the frame; `stack` fills the safe area with masked lines. | Handled by the block. |
| `metric` | `data`, `text?` | Showreel-native: the accent numeral as big as the frame allows, right-aligned, stepping one value per 1/4 note (ticks) and landing with a punch (thump). `text` is a display caption (R(1.5)–R(2.4)) whose full stop is the dot. | 16:9: one baseline: the caption as a single line (R(1.5)–R(2.4)) and its full stop sit directly left of the numeral, which fills the rest of the row. 9:16 / 1:1: numeral edge to edge (tagged `bleed`), caption (≥ R(2.2), wrap fixed at build) right-aligned under it, pair centred vertically. The dot is parked on the caption's full stop from the cut frame. |
| `chart` | `data`, `text` | `B.chartBlock`: the claim plus bars/line/donut/counter on the long axis. | Handled by the block. |
| `steps` | `text`, `sub?` | `B.stepBlock`: numeral slam plus a rail; it numbers itself among the `steps` shots. | Handled by the block. |
| `uiShot` | `screen`, `zoom?`, `pieces?` | `B.uiShotBlock` on a captured screen. | Handled by the block. |

During engine-block shots (`statement`, `chart`, `steps`, `uiShot`) the dot ducks: it shrinks in place and springs back on the next custom shot.

## Motion and sound

- **Springs:** type uses `[0.35, 1]` (response 0.35 s, damping ratio 1), which is critically damped, so it never overshoots. UI pieces (tiles, pill, dot) use `[0.28, 0.8]`, which overshoots by about 1.5 %. The template defaults also set `brand.springs.med = [0.35, 1]`, so the type in the engine blocks does not overshoot either.
- **SFX markers** sit on 1/4-beat positions, and their timing comes from the content only, so they are identical in every format:

  | technique | markers |
  |---|---|
  | `kinetic` | a pop per word, a thump on the accent, a swish on the hand-off |
  | `stack` | 4 ticks, a thump on the shear, a swish on the hand-off |
  | `split` | pop, then a thump on the split |
  | `ticker` | a swish per row, then a thump on the band |
  | `scale` | swish, then a thump on landing |
  | `grid` | a tick per tile, a thump on the accent, a tick on the flip, a swish on the zoom-through |
  | `list` | a pop per row, a swish on the exit |
  | `formats` | a pop per frame, a thump on the caption, a swish on the collapse |
  | `end` | a thump when the dot lands, a pop for the slab, a thump on the inversion, a swish when the seam push starts (shot 1's early hits land there too) |

  Transitions add a swish, and the loop adds a riser.

## Engine notes (worked around in this template)

- `metricBlock` is no longer used (showreel has its own `metric`). The other blocks that rise from below at local beat 0, log in-flight text outside the safe area when the shot enters on a hard cut. This template therefore never auto-cuts into a block shot.
- The loop-seam push is drawn by the template, and the engine has no way to flag a template-drawn transition as in-transition for lint. The seam therefore calls `T.resetLog('frame')` after drawing its moving frames, the same exemption the engine gives its own push.
- Block spring presets can only be changed globally through `brand.springs`. That is why the template defaults override `med`.
