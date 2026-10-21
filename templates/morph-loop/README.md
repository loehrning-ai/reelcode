# morph-loop

One container that never cuts. It morphs its size, radius and fill through 3–12 UI states, and a cursor physically drives each change (press-squash, tap, hover). The film is **exactly periodic**: every spring (container, cursor, caption roll and content clock) is also summed over the previous cycle, so frame `T` equals frame 0 in both position and velocity. `loop: true` is forced.

Typical length is 14 s at 120 bpm (28 beats) with 10 states. Every state is setup + hit (2 beats; heroes 3–4). The example opens on the payoff: frame 0 is the cursor tapping the revenue card as its `+18%` chip slams in, then the card **punches in full-bleed** until `$48,210` fills the frame, and the chart pulls back out of it. The tooltip is the chart point growing into a bubble, which becomes the search menu (lift). The menu row becomes the toast, and the toast's icon becomes the Start-free pill. Then come field → loader → success, and the check blooms into a 4-beat lockup sequence whose CTA pill opens back into the card on the loop downbeat.

## Content fields (`content.states[]`, in loop order; the last state morphs back into the first)

| field | kinds | meaning |
|---|---|---|
| `kind` (required) | all | `button`, `field`, `loader`, `success`, `card`, `chart`, `tooltip`, `menu`, `notification`, `logo` |
| `caption` | all | A display line under the container (two balanced lines in 9:16, 4:5 and 1:1) or in the side column (up to three balanced lines in 16:9). It stays until the next state that sets one. On a `logo` it becomes the lockup tagline and the global caption rolls out. If no state has a caption, the container uses the whole safe area. |
| `beats` | all | Relative length of the state (2–16). Defaults: button 2, field 3, loader 2, success 2, card 4, chart 4, tooltip 2, menu 3, notification 2, logo 4. Keep holds to at most one beat: setup, hit, hold. Every state is scaled to the project length on whole beats, with at least 2 beats each. |
| `via` | all | How the container changes **into** this state: `push` (outgoing content slides out as the new slides in), `lift` (the container closes on a **transfer object** of the previous state, which then opens into this one: menu → selected row, tooltip → bubble, notification → its icon as a toast-tall disc, logo → the CTA pill), `dot` (collapse to a dot in the new fill, then grow), `cut` (the morph alone carries it) or `blur` (short blur swap). Defaults: card/chart/field `push`, tooltip/loader/success/logo `cut`, menu/notification/button `lift` (falls back to `push` when the previous state has no transfer object). Out of a logo only `lift`, `cut` or `blur` are kept; anything else becomes `push`. |
| `fill` | all | `surface`, `accent`, `fg`, `bg` or `muted`. This overrides the kind's default fill. Text colour is picked for contrast automatically. |
| `anchor` | all | `c`, `n`, `s`, `e`, `w`, `nw`, `ne`, `sw` or `se`: moves the container inside its stage (default: centred). In 16:9 only the horizontal part is used. |
| `then` | logo | The CTA pill label. On beat 2 the wordmark contracts into the pill (pop, swish). On beat 3.5 the cursor presses it (squash, click) and the container closes on it, then it opens into state 0. |
| `trigger` | all | How the cursor leaves the state: `click`, `hover` or `auto`. Defaults: card, loader and success `auto` (the card's cursor taps the chip on beat 1 and then leaves the frame), chart `hover`, logo `click` with a `then` (else `auto`), everything else `click`. With `lift`/`dot` into the next state, the click lands half a beat before the change, when the close-in starts. |
| `label` | button (required), logo, field | Button text, the logo wordmark (falls back to `brand.name`), or the field's label row (default "Work email"). |
| `placeholder` | field, menu | Muted text shown before typing starts. |
| `value` | field (required), card (required) | field: the string that is typed. card: the number the counter counts to. |
| `from`, `fmt`, `decimals`, `prefix`, `suffix` | card, tooltip | Number formatting (`fmt`: `int`, `pct`, `money`, `k` or `x`). |
| `delta` | card | A chip such as `+18%`. It sits beside the number in wide frames and under the title in 9:16. |
| `title` | card (required), chart, notification (required) | Heading text. |
| `body` | notification | Second line. It wraps to at most 2 lines. |
| `data` | chart (required), tooltip | `[{label, value}]` with 2–12 points. A tooltip with no `data` inherits it from the previous chart. |
| `highlight` | chart, tooltip | Index of the point the cursor hovers and the tooltip pins. The default is the last point. |
| `query` | menu | Typed into the search row. |
| `items`, `selected` | menu (`items` required) | 2–5 rows. The highlight steps down to `selected`, which is then clicked. |

## Per-format composition
- **9:16:** the safe area splits 76/24. The caption is a 2-line subtitle block sitting on the bottom of the safe area (~72% of the frame height). The container centres in the band above it, at full safe width. UI scale starts at `readable × 2.0`.
- **4:5 / 1:1:** the caption band (27–29% of the safe area) **alternates bottom/top with every caption**, so the container moves to the other end of the frame on each caption change and the frame rebalances.
- **16:9:** the caption is a 1–3 line column (38% of the safe width, centred vertically). The container takes the other 58%. The column alternates sides with every caption, so the container travels across the frame.
- **Thin states are sized by height, not width:** button min 15/20/25% of the frame height (v/s/h), toast 11/17/22%, field 20/26/30%. The field is a two-row phone form: a label row with the send disc, then the typed value on the full width at up to 1.6× UI size. The toast docks full-width at the top of the safe area in 9:16 / 4:5 / 1:1, like a phone banner, with its title at up to 1.3× UI size.
- **Chart → tooltip:** the axis row slides out of the container as the highlighted point grows into the bubble, so the bubble never sits on the axis labels.
- **Punch-in (`card`):** on beat 2 the container blooms full-bleed in its own fill. The counter fills ~94% of the safe width (height-capped), with the title above it and the chip under it. The next state (`push`) pulls back out of it.
- **Logo lockup (`full`):** the container blooms to 114% of the frame in the accent. The wordmark is ~80% of the frame width (capped at 20/22/30% of the height), and the wordmark + tagline centre around 42% of the height. The CTA pill sits big in the thumb zone (~70%) in 9:16 / 4:5 / 1:1, or under the stack in 16:9. The pill is surface-coloured, the stock of state 0's card.
- **Contrast:** secondary text (`mute`) is mixed toward the fill only as far as WCAG AA allows. The chip and the CTA label use `ink`. Captions draw under the container, so the bloom and the punch cover them.

## Motion
- The container uses a UI spring `[0.32, 0.77]` (response in seconds, damping ratio). Each click squashes the container by 6%.
- Type uses a critically damped spring `[0.36, 1]`. Captions roll inside a mask, and nothing fades.
- **Change mechanics** (`via`, above): every handoff keeps an object on screen (no dot-only frames). In the example: `lift` 4× (logo pill→card, tooltip bubble→menu, menu row→toast, toast icon→button), `cut` 4× (chart→tooltip, field→loader, loader→success, success→bloom) and `push` 2× (card punch→chart, button→field). There is no blur.
- **Seam:** t=0 is LEAD = 1 beat into state 0, so frame 0 is crisp and already in motion: the card is counting up, and the cursor taps as the `+18%` chip slams in from 2.3× (it starts 0.1 s early, so frame 0 already carries the accent). The pill opens into the card one beat earlier (thump). No blur or swap is ever on the loop point.
- **Poster:** `build()` returns the punch-in hold (or the lockup wordmark when no state punches). `api.warn` flags a poster that lands on a loader, success or change.
- **Cursor:** hovers just off each state's hotspot (or `park` per kind), so it is lined up on what it changes next. On the chart it drags the scrub dot (it rests on the dot at each step). The menu park follows the stepping highlight. `taps` adds in-state clicks, and `exit` sends it off-frame after the last tap (the card, during the punch).
- **Holds:** the chart's scrub dot steps on beats 2 and 3. The menu types its query, then steps the highlight one row per half beat.

## SFX it emits (all derived from content, so they are identical in every format)
- `click` (−6 dB) on every click-triggered change.
- `tick` (−10 dB) on a hover-triggered change.
- `swish` (−14 dB) into the big kinds (card, chart, menu, notification).
- `pop` when `success` (−4 dB) or `notification` (−8 dB) lands.
- A 2-beat `riser` into the bloom, then `thump` (−1 dB) + `pop` on it. The tagline types with ticks, `pop` + `swish` play when the wordmark contracts into the pill, a `click` on the press, and `thump` (−4 dB) as the pill opens into state 0.
- `pop` (−8 dB) and a `click` (the tap) on the card's chip slam, and `swish` + `thump` on the punch-in.
- Typing `tick`s (−16 dB) on the 1/16 grid. Every other one is tier `busy`, and the menu query ticks are all `busy`.
- The runtime adds the loop `riser`. A template cannot drop the synth bed (`engine/audio/music.py` has no arrangement hook). For a sound arc, supply a track: `projects/example-morph/assets/bed.py` renders the same minimal-tech Song with a filter close, a 2-beat mute before the bloom and a boom on it, and the project uses it as `audio.music` (`fit: trim`, exact 120 bpm grid). The mix reaches LRA 4.3 LU; the plain synth bed gives 0.5.

## Check
`node templates/morph-loop/check.mjs projects/<name>` (stand-in until lint has these rules) fails on any of these:
- UI text at rest on a beat below 3% of the frame height (9:16) or 4.4% of the short side (others);
- a quarter-beat frame with under 5% non-background ink;
- a poster warning;
- a mix LRA outside 4–6 LU.

## Files
- `scene.js`: per-format layout, the beat plan, change mechanics (pre-keys for lift/dot, push, blur), periodic springs, the cursor and the captions.
- `kinds.js`: one entry per UI kind: `geom`, `hot` (the cursor target), `draw`, `events`, `sfx`, and optionally `lift` (the transfer object for a lift-out), `punch` (full-bleed push-in), `park`/`parkSteps`, `taps`, `exit` and `full` (full-bleed lockup).
- `check.mjs`: the scale / empty-frame / poster / LRA check.
