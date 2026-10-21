# social-ad

A 6–20 s social ad built from photos, product renders or footage. The order is: a full-bleed **hook** (big type over a photo on frame 0, optionally sliding to a second photo like a train window), then 2–3 **shots** that each enter *over the outgoing shot* (a full-bleed photo/clip with a benefit plate, a photo/clip seen **through a window frame** with a pull-back reveal, or a **split-flap board**), then the **offer** laid out per aspect straight on its photo (no card) that clears in stages, then an optional proof shot, then the **CTA lockup** as its own per-aspect composition, with the price springing over from the offer. With `content.frame` (an RGBA overlay with a transparent window, one per aspect) the window becomes the spine of the film: the hook is one camera pass through it and the end card snaps back out through it on the last beat. Captions are on by default (style `bold`); while they are on, the shot plates are dropped so the caption is the only line. The example has no voice-over; add one with `audio.voiceover` (your own recording with engine `file`, or `elevenlabs`). Every film is meant to be cut down (6 s and 15 s) and to ship in variants (CTA, locale).

Defaults: 18.75 s at 128 bpm (40 beats), `punchy-pop` in E minor, no loop, all four formats (`9x16`, `1x1`, `4x5`, `16x9`), `captions: {enabled: true, style: "bold"}`. Needs no captures (`requires: []`).

```sh
npx reelcode new --template social-ad --name my-ad
# copy your photos/clips into projects/my-ad/assets/, set assets/clips, content, audio.voiceover.lines
npx reelcode make projects/my-ad --quality draft                          # main film
npx reelcode make projects/my-ad --quality draft --variant all --cutdown all   # every rendition
```

`projects/example-ad` is a full example: the fictional night-train brand "Nightline", a clip shot, variants `cta-routes` and `de`, and cutdowns `c6` and `c15`.

## Rules the template enforces

- **No seam shows bare bg.** Frame 0 is a full-bleed photo with type already set. Shots enter through a runtime transition (push → wipe → slats by shot index; `reveal` picks the type, `"none"` is a hard cut), so the outgoing shot stays under the incoming mask. The offer enters with a wipe up over the last shot; the CTA wipes up over the offer while the price stays on screen and springs into the lockup.
- **The ending lands.** The CTA's cues are functions of its real length: the pill press sits at 3.5, the stamp 1.5 beats before the end, and the price punch with the final thump on the scene's **last beat** (in every cutdown too).
- **No one-frame content swap.** The offer's title masks out upward, the old price drops, the badge pops off and the note wipes over its last 1.5 beats; the CTA name masks *up* from its baseline, so no clipped letters show.
- **One line per moment.** With captions on, shot `line`/`lower` plates are not drawn.

## Timeline (default 40 beats)

| Scene id | Beats | What happens (local beats) | SFX |
|---|---|---|---|
| `hook` | `timing.hook` (8) | Layer A (`image`/`clip` + the first `turn` lines) is on screen at frame 0 with its first line set; the rest of its lines mask up from 0.5. With `then`, on `turnAt` (3) the whole frame slides left over 0.75 beat and layer B (`then` + the remaining lines) slides in; its words land from `turnAt + 0.5`. The accent word lights one beat after the last word, with a 3.5 % punch. | thump (0), pop per line, whoosh on the turn, thump on the accent |
| shots before the offer | `shots[].beats`, else shared | Full-bleed photo or clip entering over the previous shot (push l 0.75 → wipe l 1 → slats 1). Moves rotate pan-l → push-in → pull-out. The `line` plate snaps in on 0.5 (top), `lower` on its `at`; the media re-frames on the middle beat. | transition swish/whoosh, pop, swish |
| `offer` | `timing.offer` (8) | Wipes up over the last shot. Full-bleed `offer.image` under a feathered bg scrim. The title masks up (0.25), the old price appears (0.5) while the price counts down from it on screen (0.5), a bg knock-out band strikes the old price (1.5), the price lands in accent with a punch (2), the badge pops (3), the note lands (4). Staged exits: title + old price (last − 1.5), badge (last − 1.25), note (last − 1). | pop, ticks, swish, **thump**, pop, click, swish, pop |
| shots with `after: true` | as above | A proof shot after the price. The 15 s cut drops it first. | as above |
| `cta` | fill (≥ 4) | Wipes up (0.75 beat). With `frame`: the CTA photo seen through the window, pushed in so it fills the frame; otherwise the photo full-bleed (continuing the offer's camera move when it is the same photo). The price springs from its offer slot into the lockup (0), the name masks up letter by letter (0.5), the `chip` label masks in (1.25), the pill wipes open (2), is pressed and keeps the accent (3.5), the URL types on (5), the accent rule stamps (last − 1.5); on the **last beat** the camera snaps back out of the window so the carriage frames the lockup (or, without a frame, the price punches) with the final thump. Under 6 beats the build-up is compressed. | whoosh, pop, swish, click, swish, whoosh, **thump** |

### Window motif and board

- `content.frame = {image, hole: [x, y, w, h] (0..1), radius (0..0.4 of the short side)}`: an RGBA overlay drawn over the world, with a transparent window at `hole`. Set one per aspect with `overrides.<fmt>.content.frame` so the window is laid out for each frame, not cropped. Make it in code (see `projects/example-ad/scripts/make_train.py`).
- **Hook with a frame:** `hook.image` (a wide plate, about 3:1) slides past inside the window by `drift` view-widths, `hook.near` (a transparent layer) streams in front at `nearSpeed` frame-widths per second, and the first `turn` lines are set at the top on frame 0. On `turnAt` (3.25) the carriage whips sideways through the pillar between two windows with a short smear and lands on `then` (0.75 beat later) as the remaining lines slam in at the bottom with the accent word lit on that downbeat (16:9: top-left vs bottom-right). The last 2 beats push through the glass.
- **`shots[].frame: true`:** the shot's photo/clip slides past inside the window; the camera starts pushed through the glass and pulls back over `pull` beats (3) to reveal the carriage. The `line` plate sits at the top. `near` streams an RGBA plate past in front and `creep` keeps the camera pushing after the pull-back, so the shot never settles.
- **`shots[].flap: {rows: [≤ 12 chars] × 1–4, accent: row}`:** a split-flap board over a wall of blank tiles that bleeds off every edge. The rows flip in one after another (0.25, 1, 1.75), ticking, and land with a click (the accent row with a thump); a slow push-in carries it. No media needed. The VO line is the picture.

The poster is the offer at +4.5 beats (the price has landed and the badge is up).

## Per-format layout

The **stage** is `F.safe` cut above the caption lane (`api.captionTop`) when captions are on. Text never sits in the caption lane or under platform chrome; photos are full-bleed.

| | 9x16 / 4x5 (portrait) | 1x1 | 16x9 |
|---|---|---|---|
| hook (no frame) | Type in the lower half of the stage, justified to full width | Type in the lower 56 % | Type in the lower-left (62 % × 64 %) |
| hook (frame) | First half justified across the top 30 %, second half across the bottom 30 % | Top / bottom 36 % | Top-left / bottom-right, 60 % wide |
| offer | Title, old price, the price at full safe width, badge, note down the top two thirds; the photo's subject below | The same stack, centred | A column on the left half; the photo's subject on the right |
| cta | Name at full safe width on top, label + price big in the middle, pill + URL in the lower thumb zone | The same stack, centred; price ≥ 1/3 of the height | The lockup down the left half while the photo travels |

Both hook photos are framed slightly tight (zoom 1.25+) so `focus: [x, 1]` lifts the horizon above the type and keeps the type over the darker foreground.

## Content fields (`*` = required)

| Field | Shape |
|---|---|
| `locale`, `currency` | Price formatting through Intl: `en-IE` + `EUR` gives "€149", and `de-DE` gives "149 €". |
| `timing` | `{hook: 4–10, offer: 6–12, cta: 4–12}`, in beats. `cta` is the CTA length the shot split plans for; the CTA always takes what is left. |
| `hook*` | `{lines*: string[1–4] (each ≤ 24), accent, image \| clip, from, to, rate, focus, move, duotone, then: {image \| clip, from, to, rate, focus, duotone}, turn (1–3: lines on layer A; default half), turnAt (1–8 beats), near, nearSpeed, drift (frame hook only; `then.drift` too)}`. `accent` is matched against whole words, punctuation included (`"Alps."`). Without media, the type takes the whole stage. |
| `frame` | `{image*, hole, radius}`: the window overlay (see above). |
| `shots*` | 2–3 items of `{id, image \| clip \| flap {rows, accent}, frame (through the window), pull, near (RGBA plate streaming past in front), nearSpeed, creep (0–0.5 push after the pull-back), beats (3–12), line (≤ 40, top plate), side, lower {title, sub, at, until, side}, after, from, to, rate, loop, focus, move, amount, reveal (transition type; none = cut), dir, duotone}`. The id defaults to the media id. Shots without `beats` share what is left after hook + offer + 8 CTA beats. Vary `beats` on purpose (a held hero shot, a short accent). |
| `offer*` | `{title* (≤ 32), price* (number), was (number: strike + count-down), decimals, badge (≤ 24), note (≤ 44), image \| clip (full-bleed behind the offer), focus}` |
| `cta*` | `{name* (≤ 20), text* (≤ 22), chip (≤ 20; a label over the price), showPrice (false: no price in the lockup), url (≤ 40), image \| clip (a different photo than the offer's; seen through the window with a frame), focus, frame (false: no window snap)}` |

`image` is a `project.assets` id, and `clip` is a `project.clips` id. Clips are pre-extracted by make, and their sources must sit inside the project.

## Cutdowns and variants

Scene ids are stable: `hook`, the shot ids, `offer` and `cta`. Each scene carries a cut hint: hook `keep`, offer 5, shots before the offer 3 (falling by 0.1 per shot), and `after` shots −1.

```jsonc
"cutdowns": [
  { "id": "c6",  "duration": 6,  "keep": ["hook", "cta"] },                    // 12 beats: hook 8 + cta 4
  { "id": "c15", "duration": 15, "keep": ["hook", "window", "offer", "cta"] }  // 32 beats: 8 + 10 + 8 + cta 6
]
```

**Voice-over:** anchor every line to its scene (`"at": {"scene": "offer", "at": 0.25}`), so each line starts on its own shot and cutdowns keep it in place (lines of dropped scenes, or lines that would end past a cutdown, are dropped with a warning). Make each scene's on-screen line its VO line, and anchor the CTA line at `{"scene": "cta", "at": 3.5}` so its first word lands on the pill press.

**Variants:** override `content` (CTA copy, locale, translated lines) and `audio.voiceover` (voice and lines; arrays replace, so repeat every line). A `de` variant needs its own German recording (engine `file`) or a German ElevenLabs voice.

## Readability

- Shot text sits on opaque plates. Offer, CTA and the frame hook's second half sit on the photo over feathered bg scrims (`D.feather`); frame photos so the type lands on their dark part, and let lint's text QA (contrast against the real pixels) confirm it.
- The old price is struck with a *knock-out* band in the bg colour, so no ink crosses the glyphs.
- The badge and label use `T.readable(F, 1.1)` or larger, above the 9x16 floor.
- Keep `muted` at 4.5:1 or better on `bg` and `surface`.
