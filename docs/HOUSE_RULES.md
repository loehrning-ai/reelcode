# House rules

These are the rules every reelcode film follows, whether a person or a coding agent is driving. Most of them are
enforced by `reelcode lint`; the rest are judged by eye in the critique loop. When a rule and a brief disagree, the
brief wins only if it says so explicitly.

## 1. The render contract

A film is a function of time. Given `t` in seconds, the page paints exactly one frame, and it paints the same frame
every time it is asked, in any order, on any machine with the same fonts and the same Chromium.

- `window.seek(t)` paints frame `t` and returns. It keeps no state between calls: no counters, no "previous frame",
  no lazy layout that depends on which frame was drawn first.
- Every frame starts from a clean canvas state (transform, alpha, composite mode, filter, line dash, letter spacing).
  The runtime resets them; templates must not rely on leftovers.
- In render mode the runtime replaces `Math.random`, `Date.now`, `performance.now`, `setTimeout`, `setInterval` and
  `requestAnimationFrame` with functions that throw. Randomness comes from `noise.js` with an explicit seed.
- No CSS transitions or animations. The browser clock never moves a pixel.
- Layout may be computed once in `build()`. Anything that changes over time is computed inside `draw(f)` from `f`.
- Lint proves it: it seeks a set of sample times forwards, backwards and interleaved, then again on a fresh page, and
  compares frame hashes. One mismatch fails the film.

Why it matters: a pure `seek(t)` is what lets one timeline render to four formats, cache 1 s segments, re-render a
single passage, export a GIF from the same frames, and be checked by a machine.

## 2. One timeline, every format

- One project renders to any of `9x16` (1080×1920), `1x1` (1080×1080), `4x5` (1080×1350) and `16x9` (1920×1080).
  Every format shares the same beats, scenes, cues and mix. Per-format overrides may change content and layout,
  never `duration`, `bpm` or `loop`. A shorter edit is a cutdown, not an override.
- Sizes come from the frame (`F.u`, `F.safe`, layout helpers), never from pixel literals. Colours come from the
  theme, never from hex literals in template code.
- Text that is not deliberately cropped by the frame edge (`bleed`) stays inside the safe area of its format. The
  9:16 safe area clears the platform's own buttons and captions.
- Text must be readable on a phone: at least 2.8% of the frame height in portrait formats and 3.5% in 1:1 and 16:9.

## 3. Type and colour

- Two font roles: `display` and `ui`. Each brand picks one family for each. reelcode bundles Archivo (normal,
  condensed and expanded widths), Inter, JetBrains Mono, Jost and Space Grotesk under the SIL Open Font License, so a
  film renders the same on macOS and Linux. A family that does not load is a boot error, never a silent fallback.
- One accent colour. A second accent needs `brand.multiAccent: true`, and the brief has to ask for it.
- Colours are `#RRGGBB` values in the brand: `bg`, `fg`, `accent`, and optionally `muted` and `surface`.
- Resting text keeps a contrast of at least 4.5:1 against the pixels behind it (3:1 at 48 px and up). Lint's text QA
  measures it on rendered frames.

## 4. The banned look

These read as template filler. Lint fails the ones it can prove from code and warns on the ones it can only suspect
from pixels; the critique loop settles the rest.

| Banned | Why | Do instead |
|---|---|---|
| Glow and soft shadows (`shadowBlur`, `drop-shadow`) | the default "AI promo" sheen | flat shapes, hard edges, real depth from layering and motion |
| Gradient backgrounds | muddy on phones, says nothing | a solid ground; change the ground colour between scenes |
| Opacity fades as the only entrance | nothing moves, so nothing lands | springs, masks, wipes, type that travels into its slot |
| A centred title alone on frame one | the slowest possible hook | open on the product, a number, or type already in motion |
| Particle bursts and confetti | noise in place of an idea | one deliberate shape that carries the eye |
| Frame borders and corner labels | decoration that crowds the safe area | use the whole frame; put labels next to what they name |
| Long holds | the viewer scrolls away | something new every 2 to 4 seconds |

## 5. Cadence

Something new happens every 2 to 4 seconds: a scene change, a word landing, a number ticking, a cursor click. Lint
measures the gaps between scene starts and declared events: more than 4 s is an error, more than 3 s a warning.

## 6. Sound

- Music is synthesized by default (`audio.music: "synth"`), from a style, a key and a seed, so it is free to use
  and exactly on the grid. A supplied track is measured by `beats.py` and the film follows its beats.
- Picture and sound read one beat grid (`audio/beats.json`). Scene boundaries and events sit on beats or 1/16 subdivisions.
- Sound effects are derived from the timeline, never hand-placed in seconds: transitions get a whoosh whose peak lands
  on the cut, clicks follow the cursor, counters tick, loops get a riser into the seam. Every hit lands within 10 ms
  of the 1/16 grid or `cues.py` refuses the cue list.
- The final mix is −14 LUFS integrated with a true peak at or below −1 dBTP, measured, not assumed. A loop film's
  audio wraps cleanly at the seam.
- Voice-over is optional. The `say` engine (macOS) is for drafts only: Apple's licence does not cover publishing its
  voices. Ship a recording of your own (`engine: "file"`) or a licensed text-to-speech service.

## 7. The critique loop

No film is shown as done until it has been looked at, scored and fixed.

1. **Shotlist first.** Write the film on the beat grid: one row per scene with its beats, start time, what is new
   every 2 to 4 s, its sound, and notes per format. Agree on it before the first render.
2. **Draft.** `reelcode make <project>` renders a draft of every format with sound, lint results and critique sheets.
3. **Look.** Open every sheet: `contact.png` (one frame per beat), `phone.png` (four frames at phone size),
   `strip.png` (the busiest cut, frame by frame), `seam.png` (every boundary and the loop wrap) and `poster.png`.
4. **Score** every format from 1 to 10 on six axes:
   - hook in the first two seconds
   - readability at phone size
   - motion quality (springs settle, nothing floats, nothing jitters)
   - variety (no two scenes in a row built the same way)
   - brand accuracy (fonts, colours, logo, tone)
   - sound sync (hits on cuts, nothing early or late)
5. **Fix the three worst problems**, each written as *problem / where (scene at time) / fix*, then go back to step 2.
   Tag each round's sheets (`--tag r2`) so the rounds can be compared.
6. **Stop** only when every axis scores 8 or more in every format, after at least three rounds.
7. **Final.** `reelcode make <project> --quality final`, then check `lint.json` and the loudness in `manifest.json`.

Scores are honest or they are useless. A 7 is a 7, and the next round is where it becomes an 8.
