# lower-third

Broadcast graphics for use over footage: name straps, topic bars, quote cards and title overlays played in
sequence on a **transparent** canvas. Everything the template paints is an opaque plate (no soft edges, no
fades), so the `prores-alpha` export (ProRes 4444, `yuva444p10le`) keys cleanly over an edit. `template.json` sets
`transparent: true`. With `content.demo` set, the same graphics play over a pre-extracted clip (via
`api.media.clipBlock`), which gives you a review mp4.

Defaults: 16 s · 120 bpm (32 beats) · `minimal-tech` in A minor · no loop · all four formats. No captures are
needed (`requires: []`).

```sh
npx reelcode new --template lower-third --name my-straps
# edit content.items; add "exports": ["prores-alpha"] (the example has it)
npx reelcode make projects/my-straps --quality draft
```

## Content fields

| Field | Type | Notes |
|---|---|---|
| `items[]` | 1–12 objects | Played in order, one graphic per scene, cut between scenes. Beats must sum to the film length; otherwise set exactly one item to `"fill"`. |
| `items[].kind` | `name` \| `topic` \| `quote` \| `title` | See the table below. Fields another kind uses are rejected at build time. |
| `items[].beats` | number ≥ 3 \| `"fill"` | The exit starts at `beats − 1`. Keep each item to 8 beats or fewer so something new lands at least every 3 s. |
| `items[].exit` | boolean | Default `true`, except the last item, which holds to the end and lands its lockup. |
| `items[].id` | slug | Scene id (default `<kind><n>`). |
| `demo` | `{clip*, from, rate, loop, move, amount, focus}` | Draws `project.clips[clip]` full-frame behind every graphic, on the film clock, so the footage runs continuously through the cuts. `move` (default `push-in`, `amount` 0.06) is the slow Ken Burns of `clipBlock`. Put it in a variant (see the example) so the main film stays transparent. |

| kind | fields | What happens | Per format |
|---|---|---|---|
| `name` | `name*` ≤ 40, `role` ≤ 60, `tag` ≤ 20, `side` `l`\|`r` | The accent bar rises at the inner edge, the name plate snaps out of it and the words mask up. The role tier (`surface`) drops in under it and the `tag` chip (accent) pops above it on beat 2. On exit, the tag, role, name and bar retract 1/8 beat apart. | Width ≤ 100 % (v), 84 % (s) or 52 % (h) of the safe width. Up to 2 lines each, wrapped before they shrink. |
| `topic` | `label*` ≤ 16, `texts*` 1–4 × ≤ 60, `position` `bottom`\|`top` | The headline band wipes in from the left and the label chip drops in. The headline flips through `texts` (the old line rides up and out, the next masks in by word), and an accent timing rule along the band's foot shows how far through each headline you are. | 1:1 / 16:9: the chip sits inline at the left of the band. Portrait: the chip is stacked on top. All headlines share one size, on one line when they all fit at ≥ 1.05 × the readable size, else on 2 lines. |
| `quote` | `quote*` ≤ 160, `author*` ≤ 40, `role` ≤ 60, `side` | The card unfolds upwards with its bar, a large quote mark pops in the left column and the quote masks in word by word (stagger 1/16–1/8 beat). Then an accent rule draws on and the author and role land. | Width ≤ 100 % / 90 % / 56 %. Up to 5 lines, with a balanced rag. |
| `title` | `title*` ≤ 48, `kicker` ≤ 24, `sub` ≤ 60 | Kicker chip, then one plate per title line stepping in over a fixed ½-beat window, then the sub tier on beat 1. **As the last item** it holds and an accent underline slams across the block (thump) 2 beats before the end. That is the lockup the film ends on. | Up to 3 lines, balanced (no one-word last line). Sizes 2.0 / 1.9 / 2.2 × the readable size. |

Layout rules, all formats:
- Cards are bottom-anchored to the safe area, and to `api.captionTop` when captions are on.
- In 9:16, cards also keep clear of the 150 px action rail on the right.
- Text is never smaller than `T.readable(F)` (lint's floor).
- Plate inks are picked by WCAG contrast at build time with `media.inkFor`: main plate + ink, second tier `surface` when it reads, accent chips with the better of `fg`/`bg`, falling back to an inverted chip.

## Transparent output and the review slate

- `prores-alpha` re-renders the page with `?alpha=1`. The runtime's background fill becomes a clear, so only the plates have alpha.
- In every other render of a transparent film (`draft.mp4`, contact sheets, lint), the template draws a coarse `muted`/`surface` checkerboard behind the graphics, like an editor's transparency grid, so the plates and their edges can be reviewed.
- The slate is not drawn in the alpha export or when `demo` is set.

## Motion and sound

- Plates open with `snap` (a small broadcast overshoot) and close with `stiff` (no bounce). Type masks up with `[0.31, 1]`, critically damped.
- Nothing fades: there is no opacity anywhere.
- Every graphic pre-rolls ¼ beat, so a scene's first frame already shows the bar rising.
- Text starts only once its plate is open, and stops logging the moment its plate starts closing, so lint's contrast check always reads the plate.
- The cues are derived from the content only, and are identical in every format:

| kind | sfx (local beats) |
|---|---|
| `name` | swish 0, pop ⅛, tick ⅜ (role), pop 2 (tag), swish on exit |
| `topic` | swish 0, pop ⅛, tick on each flip, swish on exit |
| `quote` | whoosh 0, pop ¼ (mark), tick on the attribution, swish on exit |
| `title` | swish 0, pop ¼, tick 1 (sub), thump on the lockup (last item), swish on exit |

Events: each graphic's start, its mid event (tag, flips, attribution, sub/lockup) and its exit.

## Example

`projects/example-lower-third` (brand `@tallyport`) has two renditions:
- **main** is the transparent graphics pack, with `exports: ["prores-alpha"]` → `out/main/full/<fmt>/export/prores-alpha.mov`.
- **demo** is a variant that sets `content.demo` to the `ridge` clip (`fixtures/media/ridge.webm`, copied into the project, 0.375× speed) → `out/demo/full/<fmt>/draft.mp4`.

Run both with `make --variant all`.
