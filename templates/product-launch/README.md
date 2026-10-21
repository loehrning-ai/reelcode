# product-launch

A launch film built from your real product UI. About 20–30 s at 120 bpm (minimal-tech). It renders 9:16, 1:1, 4:5 and 16:9 from one timeline.

**Scenes, in order** (default timing at 22 s / 120 bpm: hook 4, assemble 4, features 3 x 8, metric 8, CTA 4 beats):
1. **hook** (4 beats): starts mid-action. The metric card's value is the HERO object: frame 0 is the card's interior full-bleed with its number in native display type as large as the frame allows (width-limited in tall frames, ~55% of the height in 16:9), scrambling wrong values on the 8th-note grid (`hook.decoys`, default derived from `metric.value`), with the first word already slammed in. The lines split into two groups that slam in on the half beats OVER the digits' top and bottom edges, each word on a dark `bg` plate; the digits freeze when the accent word lands (thump). On the last beat the words drop out while the card shrinks (geometric zoom) around its frozen number into its exact assemble cell: a match cut with a hero object in every frame. Without a metric card the hook is type only.
2. **assemble** (4 beats): the metric card is already home; the other pieces land one per half beat from alternating directions (left, right, below, above) with an overshoot, the first already in flight on frame 0; the name and tagline land; `zoom` lifts with an accent ring. The metric card's value keeps scrambling, so the real number is revealed once, in the metric scene. Layout: 9:16 fills 0.25-0.85H at the full safe width; 1:1 sits under a short title; 16:9 has a title column and the grid at ~62% of the width. Wide cards are **restacked** (head over tail) instead of shrunk.
3. **feature1..3** (two shots on a full-bleed accent ground): **Shot A** is a macro on the control (`click`); the camera pushes in from 0.82x, the cursor enters at 0.5, reaches the control at 1.5 and clicks on beat 2.5 (ring). A quarter beat later a **whip pan** brings in **Shot B: a camera lens over the `after` screen** that tours `tour` stops one per beat (default: `zoom`, then `pop`). Per stop the zoom comes from the measured glyph height under the stop (the smallest text line renders >= 2.2% of the short side, floor ~2x in 9:16) and the lens is the stop plus as much real context as fits, snapped to clear rows/columns (no glyph ever crosses its edge); centre and zoom glide between stops, and a ring lands on each arrival. `say` restates the key line in the display font on a `bg` plate over the bottom of the UI (the 9:16/4:5 bottom band; in 16:9 under the title column). Title band on top (portrait/square) or a left column (16:9).
4. **metric** (8 beats): the real KPI card rises with its own value slot left empty (`metric.cardValue`); a one-bar riser builds into the landing (the loudest hit of the film: thump + pop); the number counts out of the slot into the hero, the sparkline draws on (`metric.cardSpark`), the label lands, the shot pushes. Second move: two beats before the end the card drops away and number + label re-frame to the centre, larger. On the last beat an accent plate slams in behind the number and shrinks into the end card's logo mark, carrying the number; this collapse runs ACROSS the cut into the CTA (fastest frame on the boundary).
5. **cta** (fills the rest, 4 beats by default): the collapse finishes and the logo mark lands on beat 1 (thump); the wordmark wipes out of it and the tagline slams on beat 2; the pill punches in with the URL on the LAST beat (thump + pop + ring) and the whole lockup punches (1.07), so the film ends on its final hit. Visuals lead their hits by ~0.3 beat so the beat frame shows them landed. 9:16 / 4:5: one stacked block, logo ~92% of the safe width, pill 7.5% of the height and >= 78% of the safe width; 1:1: logo 66%, pill 10% / 60%; 16:9: a horizontal split edge to edge of the safe area, logo + tagline left, pill (16% of the height, full column width) + URL right. `cta.mark` ([x,y,w,h] fractions of the logo; default its left square) is where the metric collapses to.

UI is never redrawn: every UI pixel is a crop or animation of the captured PNGs. Crops end on clear columns/rows (no glyph, icon or border crosses the cut), so no partial word is ever shown. In 9:16, UI (never text) may extend 150px into the bottom platform band.

## Needs
- `requires: ["screens", "logo"]`. Run `npx reelcode capture fixture:mock-product projects/<name> --apply-brand` (or point it at your own localhost app) first.
- Cap ids come from `assets/assets.json` (`screens.<id>.rects`). An unknown screen or cap id fails at boot and lists the ids that do exist.

## Content fields (`project.json → content`)
| Field | Type | Notes |
|---|---|---|
| `hook.lines` | string[1–4], each ≤18 chars | Each line is justified to the full width. Short lines make bigger type. |
| `hook.accent` | string? | A word from the lines; it slams in in accent with a thump. |
| `hook.decoys` | string[2–6]? | Wrong values scrambled in the metric card's value slot during hook and assemble. Default: the metric value x 0.69 / 0.92 / 0.81 / 1.12 in its format. |
| `product.name` | string ≤24 | Display font, shown in the assemble scene. Also the wordmark fallback when there is no logo. |
| `product.tagline` | string? ≤60 | UI font, shown in the assemble scene and on the end card. |
| `assemble.screen` | screen id | For example `home`. |
| `assemble.pieces` | cap id[1–6] | The rects that fly in, in order, for example `["kpi-1","kpi-2","kpi-3","chart"]`. |
| `assemble.zoom` | cap id? | The punch-in after assembly. |
| `features[]` | 1–3 items | Beats are split evenly from the project duration (at least 4 each). |
| `features[].title` | string ≤32 | Say what the payoff shows (the critique flagged a title that did not match its shot). |
| `features[].screen` | screen id | The "before" screen. |
| `features[].click` | cap id? | Shot A: the macro on this control; the cursor enters at 0.5, reaches it at 1.5 and clicks at 2.5 beats. |
| `features[].after` | screen id? | The screen shown from 1/8 beat after the click, as a real state change. |
| `features[].zoom` | cap id? | Shot B: the payoff rect on the `after` screen, shown at a phone-readable scale after the whip. Without it the whole `after` screen is shown. |
| `features[].focus` | [fx, fy]? | Where a too-wide payoff window is centred, as fractions of the rect (default: its leading edge). For example `[0.72, 0.5]` keeps a highlighted bar on the right in view. |
| `features[].tour` | (cap id \| [x,y,w,h])[1–4]? | Shot B's camera stops, one per beat, in screenshot px of the `after` screen. Give rows of one list the same x and width (the widest line) so the lens can include neighbouring rows with clean edges. Default: `zoom`, then `pop`. |
| `features[].say` | string? ≤36 | The payoff's key line in the display font on a plate (sound-off narrative), e.g. `"Alert is live → #growth"`. |
| `features[].pop` | cap id? | A second payoff on the `after` screen (a toast, a notification popover) that pops in 1.5 beats after the payoff, below it. |
| `features[].cursor` | plan? | An explicit cursor plan that overrides the default one (needs `click` for shot A): `[{at, to: capId or [fx,fy]}, {at, click:true}, {at, drag}]`. Beats are local; cap ids resolve inside shot A; `[fx,fy]` are fractions of the UI box. The first click sets the whip. |
| `metric.value` / `from` | number | |
| `metric.label` | string ≤60 | |
| `metric.unit` / `prefix` | string? | `unit` is a suffix, for example `%`. |
| `metric.screen` / `card` | screen id / cap id? | The captured card the number comes from, for example `home` / `kpi-2`. |
| `metric.cardValue` / `cardSpark` | [x,y,w,h] fractions? | Where the card's own number and sparkline sit (see metric above). |
| `metric.fmt` | `int`, `pct`, `money`, `k` or `x` | `decimals` is 0–3. |
| `cta.text` | string ≤20 | The pill label. |
| `cta.url` | string? ≤40 | |
| `cta.mark` | [x,y,w,h]? | The logo mark as fractions of the logo image (default: the left square); the metric collapses into it. |
| `cta.logo` | asset id? | A key in `project.assets`, for example `{"logo-svg": "assets/logo.svg"}`. An SVG stays sharp at end-card size. The default is the captured `logo.png`. |
| `timing` | object? | Beats per scene: `hook` (4), `assemble` (4), `feature` (auto), `metric` (8), `cta` (4; the CTA always fills the rest). |

Brand colours, fonts, radius and springs come from `brand` (theme keys only). Per-format copy goes in `overrides.<fmt>.content`, for example shorter hook lines for 9:16.

## Per-format layout
- **9:16 / 4:5**: hook type in the top half, the card below; feature title band on top (25% in 4:5, 20% in 9:16) and the UI box below it running into the bottom platform band; CTA as a centred vertical stack.
- **1:1**: like 9:16 with a 25% feature title band and a smaller CTA logo (66%).
- **16:9**: hook type left / card right; feature title column (33%) left of the UI box; CTA as a horizontal split.
- **Contrast:** the tagline, metric label and URL use `ink.js` (muted mixed only as far as AA needs); feature titles and index use fg checked against the accent ground; the CTA pill picks fg/bg text by contrast and moves its fill when neither passes.

Set `poster` in project.json to a strong frame (the example uses beat 34.75, the metric landing with its label).

## Transitions and checks
Non-cut transitions are **centred on the cut** (`boundary.js`): they start `beats/2` before the boundary, the outgoing scene keeps drawing, the eased progress is 0.5 on the boundary frame and the whoosh hits there. The engine is handed plain cuts.

`node templates/product-launch/check.mjs projects/<name>` fails on a frozen boundary frame (b-1/b/b+1 not all different), a tour stop whose smallest captured text renders below 2.2% of the short side, a lens edge crossing a glyph, or a last beat that changes < 10% of the frame.

## Motion
Springs drive every move. UI (panels, pieces, cursor) uses `[0.28, 0.79]` (response in seconds, damping ratio), a ~1.5% overshoot. Type uses `stiff`, with no overshoot. Nothing fades: entrances are masks, rises, wipes, scales and transitions (push, wipe, iris, slats).

## SFX it emits (derived; never hand-written)
- hook: a `pop` per line (a `thump` when the line is the accent word), a `tick` on every other scramble step and a `whoosh` on the fly into the grid.
- assemble: a `pop` per landed piece and a `swish` on the zoom.
- feature: a `pop` on entry, a `click` on each click/drag, a `swish` on the whip, a `pop` on the payoff and a `pop` on the second payoff.
- metric: a `pop`, `tick`s on 1/8 (1/16 with `sfxDensity: busy`), a `thump` on landing, a `swish` on the push and a `whoosh` on the collapse.
- cta: a `thump` on the wordmark, a `pop` on the pill, a `tick` on the URL, and a `thump` + `pop` on the final press.
- Transitions add a `whoosh`.
