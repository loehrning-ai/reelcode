# reelcode engine spec

The reference for how reelcode works inside: the page contract, the runtime API templates use, `project.json`, the
CLI pipeline, audio, outputs and tests. The rules a film must follow are in [HOUSE_RULES.md](HOUSE_RULES.md); the
commands are summarised in [CLI.md](CLI.md); the templates in [TEMPLATES.md](TEMPLATES.md).

**The idea in one line:** one engine, many films. A new video is a new `projects/<name>/project.json` plus its
assets. It needs no new engine code, and one timeline renders to every format.

---

## 1. Folder layout

```
bin/reelcode.mjs         the one CLI entry point; dispatches to engine/cli/<command>.mjs
engine/
  page.html              generic host page (§2)
  runtime.js             boot(), determinism guard, theme, timeline compile, transitions, seek, cues, report, hash/diff
  schema.js              JSON-Schema subset validator + PROJECT_SCHEMA (deep-equals docs/project.schema.json)
  motion.js              clamp, lerp, eases, spring, sp, seq, seqv, pulse, quant, loop springs, stagger, settle, drop
  layout.js              FORMATS, frame(fmt), Box helpers: inset, split, grid, place, aspectFit, lerpBox
  text.js                font loading/probing, fitText, wrapText, drawText, kinetic, counters, contrast helpers, text log
  draw.js                rrect, fillBox, disc, line, withClip, masks (wipe, iris, slats, push), morph, blurred, feather
  chart.js  cursor.js  assets.js  noise.js  beat.js  blocks.js  media.js  captions.js  cutdown.js  load.js  bespoke.js
  fonts/                 bundled OFL variable fonts (woff2), fonts.css, fonts.json (licences in LICENSES/)
  scaffold/page.html     starting point for a bespoke page (§8.3)
  cli/                   new, make, render, lint, stills, capture, preview, setup, doctor, test (+ lib/)
  audio/                 music.py sfx.py cues.py mix.py beats.py fit.py voice.py common.py test_audio.py
  test/                  node --test suites
templates/<name>/
  scene.js               export default { id, build(api) }  (§3.2)
  template.json          { id, description, requires[], defaults{...}, content_schema, example{...} }
  README.md              what it makes, content fields, per-format behaviour, the sound it emits
projects/<name>/
  project.json           the file you edit to make a film
  assets/                images, captures (screen-<s>.png, assets.json), generated files (git-ignored)
  audio/                 generated: music.wav, beats.json, cues.json, cues_timed.json, sfx.wav, mix.wav, audio.json
  out/                   generated: timeline.json, lint.json, manifest.json, <fmt>/... (§7)
brands/<id>.json         brand presets (§4.4)
fixtures/mock-product/   a static fake SaaS app to capture UI from (§9)
fixtures/media/          make_media.py: procedural photos and a clip for media templates (§9)
```

Each engine module stays under about 400 lines and each template `scene.js` under about 250.

---

## 2. Page contract (`engine/page.html`)

URL: `/engine/page.html?project=<name>&format=<9x16|1x1|4x5|16x9>&w=&h=&mode=<render|preview>[&variant=][&cutdown=]`.
The static server's root is the repository root; it always listens on a random free port on 127.0.0.1.

The page holds a `<canvas id="c">`, the bundled `fonts.css`, a style that disables CSS transitions and animations,
and one module script that calls `boot()`.

### 2.1 `boot()`
Every step is awaited; any failure sets `status = 'error'` and records a message.

1. Parse the query. An unknown format or mode is an error.
2. Fetch `project.json`, the template's `template.json`, and every brand preset it references.
3. Resolve: deep-merge `template.defaults` ← project ← variant overrides ← cutdown ← `overrides[format]` (arrays
   replace). Validate the result against `PROJECT_SCHEMA` and `content` against the template's `content_schema`.
4. Size the canvas to the format; device scale factor 1.
5. Build the theme from the brand (§3.4).
6. Load the brand's two font families (`document.fonts.load`, then `document.fonts.ready`) and probe that each one
   really renders. A family that is neither bundled nor installed is `font missing: <role> "<family>"`.
7. Load assets: `project.assets`, `assets/assets.json` with its screens and logo, clips. A file the template's
   `requires` names is mandatory.
8. Build the beat grid from `audio/beats.json` when it exists, else the nominal grid from `bpm` and `duration` (used
   by a video-only render before audio exists). A supplied track without a measured `beats.json` is an error.
9. Import the template's `scene.js`, call `build(api)` once, apply the cutdown, compile the timeline.
10. In render mode, install the determinism guard (see [HOUSE_RULES.md §1](HOUSE_RULES.md#1-the-render-contract)).
11. Define `window.seek = (t) => __reelcode.seek(t)` and set `status = 'ready'`.

Preview mode installs no guard and adds a play button and scrubber under the canvas (`reelcode preview`).

### 2.2 `window.__reelcode` (the bridge the CLI talks to)
```js
{
  status: 'booting'|'ready'|'error', errors: string[], warnings: string[],
  format, W, H, duration, bpm, loop, alpha,
  seek(t),          // sync; clamps t to [0, duration], paints the frame, returns {scene, lb}
  time(ref),        // a numeric string is seconds; anything else a time ref -> seconds
  timeline(),       // {duration, bpm, totalBeats, beatTimes, scenes:[{id,start,end,startBeat,beats,transition,events}], events, poster, cut}
  cues(),           // {bpm, totalBeats, loop, cues:[{beat, sfx, gain_db, pan, id, dur?}]}: derived (§6.3), identical across formats
  report(),         // log of the last seek: {texts, overflow, discs, media, scene, lb, inTransition, t}
  hash(),           // FNV-1a hex of the current frame's pixels
  diff(tA, tB, thr) // fraction of pixels that differ by more than thr between two frames
}
```

### 2.3 What `seek(t)` does
Reset the context (transform, alpha, composite, filter, shadow, letter spacing, line dash), clear the per-frame logs
and fill the background (or clear it when `?alpha=1`). Then draw the active scene (during a transition: the outgoing
scene, then the incoming one clipped by the transition mask), every persistent layer in order, and captions.
Templates may memoise layout in `build()`, never anything that depends on time.

---

## 3. Runtime API (what templates use)

### 3.1 Units
- **Time ref** (`At`): a number of beats, or `"b<beats>"`, `"bar<n>"` (bar n = beat 4n) or `"s<seconds>"`.
  Inside a scene, refs are local to the scene start. Seconds are meant for `project.json` content.
- **Box**: `{x, y, w, h}` in canvas pixels, always derived from `F.safe`, `F.full` or the layout helpers.
- **Spring**: a preset name (`'soft' | 'med' | 'stiff' | 'snap'`) or a pair `[response, damping]`:
  - `response` is the period in seconds of the undamped oscillation, so smaller is quicker;
  - `damping` is the damping ratio: below 1 it overshoots, 1 is critical (fastest without overshoot), above 1 is sluggish.
  - Defaults: `soft [0.53, 0.6]`, `med [0.36, 0.86]`, `stiff [0.26, 0.98]`, `snap [0.21, 0.66]`. `brand.springs` may
    override any of them.

### 3.2 Template contract (`templates/<name>/scene.js`)
```js
export default {
  id: 'product-launch',
  build(api) { return { scenes, persistent, loop, poster } }   // once per format, after fonts, assets and grid are ready
};
// api = { F, data, theme, grid, assets, clips, ctx /* measuring only */, project /* resolved, read-only */,
//         cutdown, alpha, captionTop, M, L, T, D, C, K, N, A, B, media }

Scene = {
  id: string,                         // stable and content-derived (cutdowns keep scenes by id)
  beats: number | 'fill',             // at most one 'fill' scene; it takes the remaining beats
  draw(f) {},                         // a pure function of f
  events?: At[] | (beats) => At[],    // local times where something new appears (cadence check)
  sfx?: [{ at, sfx, gain_db?, pan?, dur?, tier? }] | (beats) => [...],
  transition?: { type: 'cut'|'push'|'wipe'|'iris'|'slats', beats, dir?, origin? },   // into this scene
  cut?: 'keep' | 'drop' | number,     // hints for cutdowns with keep:"auto"
}
Persistent = { id, draw(f) }          // drawn over every scene; f.scene is the active scene's clock
```
`duration` snaps to whole bars: `totalBeats = 4 * round(duration * bpm / 240)`. Without a `'fill'` scene the scene
beats must sum to `totalBeats` exactly; a `'fill'` scene shorter than 2 beats is an error.

### 3.3 The frame object `f` (new and frozen on every seek)
```js
f = { t, lt, lb, p,                    // global s, local s, local beats, p = lb / scene.beats clamped to 0..1
      since(at) -> s,                  // f.lt minus the ref in seconds; negative before it: M.sp(f.since('b2'), 'med')
      hit(at, len = 0.08, s = 'snap'), // 0 -> 1 -> 0 pulse at a local ref
      on(at, s = 'med'),               // a spring that starts at a local ref
      ctx, F, theme, data, assets, grid, scene, fmt }
```
During a transition the outgoing scene keeps drawing with `lt` past its end and `p` held at 1.

### 3.4 Theme
```js
theme = { colors: { bg, fg, accent, muted, surface }, accent2?, fonts: { display, ui }, radius, springs, mix(a, b, p) }
```
`muted` and `surface` are derived when absent. Two font roles, no shadow or glow keys, colours `#RRGGBB`.

### 3.5 `motion.js` (pure; runs in Node and in the page)
```js
clamp(x, a = 0, b = 1); lerp(a, b, p); mod(a, n); easeInOutCubic(p); easeOutCubic(p)
spring(t, response = 0.4, damping = 1)   // closed-form step response 0 -> 1 of a damped oscillator
sp(t, s)                                 // spring by preset name or [response, damping]
seq(t, [[time, value, spring?], ...], s = 'med'); seqv(t, [[time, [..vec], spring?], ...], s)
pulse(t, at, len = 0.08, s = 'snap')     // 0 -> 1 -> 0
quant(beats, div = 4)                    // round a content-derived marker to the 1/16 grid
loopSeq / loopSeqv(t, T, keys, s); loopPulse(t, T, at, len, s)   // periodic: value and velocity match at the seam
stagger(i, n, span); settle(s, eps = 0.002) -> seconds; drop(dt, s = 'soft') -> {p, sq}
```

### 3.6 `layout.js`
```js
FORMATS = { '9x16': 1080x1920 safe {t:240, b:400, l:72, r:72},  '1x1': 1080x1080 safe 72 all round,
            '4x5': 1080x1350 safe {t:88, b:120, l:72, r:72},      '16x9': 1920x1080 safe {t:64, b:64, l:110, r:110} }
frame(fmt) -> F = { fmt, w, h, orient: 'v'|'s'|'h', aspect, u /* min(w,h)/1080 */, full, safe, cx, cy, pick({v, s, h}) }
inset(box, px | {t, r, b, l}); split(box, ratios, {axis: 'long'|'short'|'x'|'y', gap}); grid(box, n, {cols, gap, aspect})
place(box, {w, h}, anchor = 'c', inset = 0); aspectFit(box, ratio, anchor); lerpBox(a, b, p); center(box)
```
Every size is a multiple of `F.u` or a fraction of a Box. `split(..., {axis: 'long'})` stacks in portrait and square
frames and sits side by side in 16:9; pick the axis per format with `F.pick` when a square should go side by side.

### 3.7 `text.js`
```js
probeFonts(ctx, theme) -> {display, ui}; fontString(theme, role, size); setFont(ctx, theme, role, size, weight?)
measure(ctx, theme, role, str, size) -> {w, cap, asc, desc}
fitText(ctx, theme, str, {role, box, max, min, lines: 1|'auto', leading, align, valign}) -> {size, cap, lines, overflow}
tryFit(...)        // fitText that never logs an overflow (trial layouts)
wrapText(ctx, theme, str, {role, size, width}) -> string[]
drawText(ctx, theme, str, x, y, {role, size, color, align, sx, sy, bleed, log, rest: [x, y]})
logRest(...); logText(...); logMedia(ctx, box); quiet(fn)
kinetic(f, fit, {by: 'line'|'word'|'char', at, stagger, from: 'below'|'mask'|'drop'|'scale', spring, color})
counterText(value, p, {fmt: 'int'|'pct'|'money'|'currency'|'compact'|'k'|'x', decimals, locale, currency, prefix, suffix})
readable(F, k); readableOn(theme, key, bgKey, size, opts); plateOn(theme, fillKey, size, opts); contrast helpers
```
There is no fade option. A `color` argument is a theme key, never a hex value. Moving text logs its resting slot
(`rest`), so the safe-area check judges where it lands, not where it flies.

### 3.8 `draw.js`, `chart.js`, `cursor.js`, `assets.js`, `noise.js`, `beat.js`
```js
// draw.js
rrect(ctx, box, r); fillBox(ctx, box, color, r); disc(ctx, x, y, r, color); line(ctx, pts, {color, width, progress, cap})
withClip(ctx, pathFn, drawFn); blurred(ctx, F, amount, drawFn); feather(ctx, box, side, color, {at, alpha})
mask(ctx, type, p, F, opts); pathOf.rrect | pathOf.circle | pathOf.arrow; morph(ctx, A, B, p)
// chart.js: every value from data, scales computed from the data
scaleLinear; scaleBand; niceTicks; bars(f, {...}); line(f, {series, box, at, beats, drawBy: 'x'|'length'}); lineReach; donut; axis
// cursor.js: plan = [{at, to: capId|[x,y]}, {at, click: true}, {at, drag: ...}]
cursorAt(plan, f | lb, resolve, s | {spring, loop}) -> {x, y, press, visible, enter}; drawCursor(ctx, theme, c, scale); clicks(plan)
// assets.js
drawImage(ctx, img, box, {fit: 'cover'|'contain', focus, crop, radius}) -> placed; screen(id) -> {img, w, h, rects}; mapRect(rect, placed)
// noise.js
hash(n); rng(seed); noise1(seed, x); noise2(seed, x, y); jitter(seed, t, amp, hz)
// beat.js
makeGrid({bpm, beats?, downbeats?}, duration) -> {bpm, spb, totalBeats, beat(n), bar(n), at(t), snap(t, div), quant}; parseAt(ref, grid)
```

### 3.9 `blocks.js` (shared scene factories; each returns a Scene)
```js
kineticBlock(api, {id, lines, beats, by, from, box, accentWord, fit: 'justify'|'block', transition, spring})
statementBlock(api, {id, text, sub, beats, layout: 'bleed'|'stack'})
uiShotBlock(api, {id, screen, beats, assemble, zoom, cursor, label, slots, from: 'fly'|'mask', swaps})
metricBlock(api, {id, value, from, label, unit, fmt, locale, currency, beats, valign})
chartBlock(api, {id, chart: {type: 'bars'|'line'|'donut'|'counter', ...}, claim, beats})
logoCtaBlock(api, {id, logo, name, wordmark, cta, url, beats})
stepBlock(api, {id, n, title, body, beats})
```
Every block fills its own `events` and `sfx`, so cues are derived, and lays itself out per format.

### 3.10 `media.js` (as `api.media`)
`imageBlock(api, o)` and `clipBlock(api, o)` return scenes (Ken Burns, reframes, wipe/iris/slats reveals, duotone);
`lowerThird(api, o)` returns a persistent layer; `plateLayout`, `drawPlate`, `plateCues` are exported for templates
that build their own plates. Clips are pre-extracted PNG sequences (§5.2), `frameAt(sec) = floor(sec * fps)`.

---

## 4. project.json

The full JSON Schema is [docs/project.schema.json](project.schema.json); field-by-field notes are in
[PROJECT.md](PROJECT.md).

### 4.1 Shape
```json
{
  "$schema": "../../docs/project.schema.json",
  "template": "product-launch",
  "title": "Tallyport launch",
  "seed": 7,
  "duration": 24,
  "bpm": 120,
  "loop": false,
  "formats": ["9x16", "1x1", "4x5", "16x9"],
  "brand": "@tallyport",
  "prepare": [{ "capture": "fixture:mock-product", "creates": ["assets/assets.json"] }],
  "content": { },
  "audio": { "music": "synth", "style": "minimal-tech", "key": "A minor", "sfx": true, "sfxDensity": "normal", "lufs": -14 },
  "poster": "bar5",
  "quality": "draft",
  "overrides": { "9x16": { "content": { "hook": { "lines": ["SHIP", "IT"] } } } }
}
```
Required: `template` (or `page`), `title`, `formats`, a brand with `colors.{bg, fg, accent}` and
`fonts.{display, ui}.family`, and `content` for templates. Everything else has a template default.

### 4.2 `template.json`
```json
{ "id": "data-story", "description": "...", "requires": [],
  "defaults": { "duration": 16, "bpm": 110, "loop": false, "audio": { "music": "synth", "style": "ambient-cinematic" } },
  "content_schema": { "type": "object", "required": ["points"], "properties": { } },
  "example": { "title": "...", "brand": { }, "content": { } } }
```
`requires` may list `"screens"` (an `assets.json` with at least one screen) and `"logo"`. `reelcode new` writes
`{template, ...example}` with its flags applied, plus the `prepare` steps the example needs.

### 4.3 The validator subset (`engine/schema.js`)
Supported: `type` (string or array), `required`, `properties`, `additionalProperties` (boolean or a schema),
`items`, `enum`, `const`, `pattern`, `minimum`, `maximum`, `minItems`, `maxItems`, `minLength`, `maxLength`,
`default` (documentation only; defaults come from the merge). Not supported: `$ref`, `oneOf`, `anyOf`.
Errors read `{path: 'content.points[2].chart.type', msg: 'must be one of bars,line,donut,counter'}`.

### 4.4 Brand presets (`brands/<id>.json`)
`project.brand` is an object, `"@id"`, or `{extends: "@id", ...partial}`. A preset is a brand object with an optional
`id`, `description` and its own `extends`. An `"@id"` or `extends` layer replaces the brand so far; a plain partial
deep-merges onto it. Layers: template default ← project ← variant ← format override. `brand.logo` may be
project-relative or point into `brands/<id>/`. `capture --brand-preset <id>` writes a preset from a captured app.

### 4.5 `prepare`: generated assets
A project ships as text. Anything that can be generated (procedural photos, a score, captures of a local app) is a
`prepare` step that `make` runs before anything else, only when one of its `creates` files is missing:
```json
"prepare": [
  { "run": "fixtures/media/make_media.py", "args": ["--out", "{project}/assets"], "creates": ["assets/ridge.jpg"] },
  { "run": "./scripts/make_train.py", "creates": ["assets/carriage.json"] },
  { "capture": "fixture:mock-product", "args": ["--apply-brand"], "creates": ["assets/assets.json"] },
  { "run": "templates/data-story/score.py", "args": ["{plan}", "--out", "assets/score.flac"],
    "creates": ["assets/score.flac"], "plan": { "audio": { "music": "synth" } } }
]
```
- `run` is a Python script run with the venv python in isolated mode (`-I`) from the repository root; `./x.py` is
  project-relative, anything else repository-relative, and it may not leave the repository. `capture` runs
  `reelcode capture <target> <project> ...args`.
- `{project}` expands to the project folder. `plan` first runs `make --only audio` on a throwaway copy of the
  project with those audio settings, and `{plan}` expands to that copy, so a generator can read the film's own
  timeline and cues. The copy's `assets/` is the project's own.
- A step that exits non-zero, prints `{"ok": false}` as its last line, or does not create its files fails the run.
- `lint`, `render` and `stills` refuse to run while a `creates` file is missing and point at `make`.

### 4.6 Renditions: variants and cutdowns
```jsonc
"variants": [{ "id": "de", "title": "...", "overrides": { "content": {}, "brand": "@x", "audio": {}, "captions": {}, "exports": [] } }],
"cutdowns": [{ "id": "c6", "duration": 6, "keep": "auto" | ["hook", "cta"], "poster": "b5" }]
```
A rendition is a (variant, cutdown) pair; `main` and `full` are the reserved ids of the project and the uncut film.
- `build(api)` always plans the full film, so scene ids match the main film. A cutdown then keeps a subset of scenes:
  a list of ids, or `"auto"` (first, last and every `cut: 'keep'` scene, then the others by `cut` priority while they
  fit; `cut: 'drop'` is never auto-kept). Leftover beats go to a kept `'fill'` scene or extend the last one.
- Templates that support cutdowns use stable scene ids, draw correctly when neighbours are dropped, and read `f.grid`
  (the cutdown grid) for anything about the film's length. A template can plan its own cut from `api.cutdown`.
- `duration`, `bpm`, `loop`, `audio`, `formats` and the other timeline fields may not be overridden per format.
- Paths: a project with neither variants nor cutdowns writes `out/<fmt>/` and `audio/`. Otherwise every rendition
  writes `out/<variant>/<cutdown>/...` and `audio/<variant>/<cutdown>/...`, and `out/renditions.json` indexes them.
- Voice-over lines may be pinned to a scene (`at: {scene, at}`), so they follow it in every cutdown.

---

## 5. CLI

Every command runs from the repository root as `npx reelcode <command>` (the dispatcher in `bin/reelcode.mjs` runs
`engine/cli/<command>.mjs`). A project argument is a name (`example-showreel`) or a path (`projects/example-showreel`).
Commands exit 0 on success and 1 on any error, print a usage line on bad flags, print one line per file written,
never bind a fixed port and never reach the network. [CLI.md](CLI.md) has every flag.

### 5.1 `new`
Scaffolds `projects/<name>/project.json` from a template's example with the flags applied, validates it as the page
would, and refuses to overwrite without `--force`. Names match `^[a-z0-9_][a-z0-9_-]{0,63}$`. When the template
needs screens, a logo or the shared fixture media, `new` adds the `prepare` steps that generate them.
`--page` scaffolds a bespoke page (§8.3); `--brand @id` uses a preset; `--list` prints the templates.

### 5.2 `make`
```
prepare (once) -> for each rendition: validate -> [clips] -> music + beats.json -> page timeline + cues
  -> [voice-over] -> sfx -> mix (-14 LUFS) -> [voice mix] -> [captions] -> lint -> render -> mux -> [exports]
  -> stills -> manifest
```
Quality presets (`engine/cli/lib/ffmpeg.mjs` `QUALITY`):
```js
draft: { fps: 30, sub: 1, crf: 23, preset: 'veryfast' }
final: { fps: 60, sub: 4, crf: 16, preset: 'slow' }     // sub = sub-frames blended per output frame (motion blur)
```
- **Music:** `synth` runs `music.py` for whole bars and writes an exact `beats.json`. A supplied track is converted to
  48 kHz, cut at `musicStart`, fitted (`fit: trim|loop|fade-bar`) and measured by `beats.py`. `none` writes the
  nominal grid and mixes sound effects (and voice-over) only.
- **Lint:** `--fast` for drafts, the full lint with determinism for finals. Errors stop the run.
- **Render:** every format renders in parallel on one Chromium (`--jobs`). Each frame is `seek(i / (fps * sub))`,
  sub-frames centred on the output frame (loop films wrap them across the seam), screenshotted as PNG and piped to
  ffmpeg, which averages each group of `sub` frames (`tmix`) and keeps one per output frame. Output is encoded as
  1 s closed-GOP segments under `out/.cache/<fmt>/seg/` and joined by stream copy, so an edit re-encodes only the
  segments whose pixels changed. Frame count and size are verified with ffprobe.
- **Mux:** the mix is muxed as AAC 256k with `+faststart`; loudness is re-measured on the result.
- **Idempotent:** audio is rebuilt every run (deterministic, seconds); video re-renders only when its content stamp
  changes (engine, template, project, assets, beats, quality). A rerun with no changes leaves `manifest.json`
  byte-identical. `--force` re-renders anyway. A draft never overwrites a final.
- `--only audio` stops after the mix; `--only video` reuses `audio/` and refuses a stale grid.

### 5.3 `render`
Video only, silent. `--from <ref> --to <ref>` renders one passage and splices it into the last cached full film of
the same quality (`<fmt>/[draft_]range.mp4`).

### 5.4 `stills`
| Sheet | Content | File |
|---|---|---|
| `contact` | one tile per beat on the real beat grid (bars, then 2 bars ... above 64 tiles), 6 columns | `out/<fmt>/contact.png` |
| `phone` | the poster plus three settled moments, 390 px wide: what a thumb-scroller sees | `phone.png` |
| `strip` | 12 frames across the busiest scene boundary | `strip.png` |
| `seam` | one row per scene boundary plus the loop wrap: 2 frames before, the cut, 1 after | `seam.png` |
| `poster` | one full-resolution frame at `--at` or the timeline's poster | `poster.png` |

`--tag rN` also writes `<sheet>_rN.png`, so critique rounds stay comparable. `--at t` makes a one-frame sheet.

### 5.5 `lint` → `out/lint.json` `{errors, warnings, textqa}`
- **Static**, over every page module of the template (or bespoke page) and the engine, comments stripped: banned
  clock and timer APIs outside the runtime's guard and preview sections; `new Date`; CSS `transition:`/`animation:`;
  `shadowBlur`, `shadowColor`, blur or drop-shadow filters; and in templates and blocks also gradients, `globalAlpha`,
  raw `1080`/`1920` and hex colour literals.
- **Schema:** project and content validation, required assets, `assets.json` ids that content references.
- **Boot**, per format: the page reaches ready with no errors (fonts, timeline sum); `cues()` is identical across formats.
- **Cadence:** gaps between scene starts and events: > 4 s error, > 3 s warning.
- **Layout**, every beat and half beat outside transitions: text overflow, text outside the safe area (unless
  `bleed`), text below the phone-readable size, corner labels.
- **Determinism** (not with `--fast`): sample times seeked in order, reversed, interleaved, and on a fresh page; every
  hash must match. `--framemd5` adds an ffmpeg framemd5 comparison.
- **Loop:** the last frame must match the first (`diff < 0.005`).
- **Text QA** on rendered frames: WCAG contrast of resting text against its surroundings, invisible text, clipping,
  overlapping resting texts (occlusion-aware). Warnings by default, errors with `--strict-text`.
- **Pixel heuristics** (warnings): a centred lone title in the first second, more than 40 discs (particle burst), a
  persistent uniform edge band (frame border; footage boxes are exempt).

### 5.6 `capture`
`reelcode capture <fixture:name | http://127.0.0.1:PORT/... | http://localhost:PORT/... | file.html> <project>`
screenshots a local app into the project. Anything else is refused; every request outside the target origin is
aborted, so capture never touches the network.
- For each state (`--states`, `--routes`, `window.__fixtureStates`, or `default`): navigate (`?state=<s>` or the
  route), wait for fonts and `window.__fixtureReady`, write `assets/screen-<s>.png`, a full-page shot and one crop per
  `[data-cap]` element (or `--selectors id=css`), and record each rect.
- Logo from `[data-cap="logo"]`; colours from `--brand-*` CSS variables or computed styles; fonts from the computed
  `font-family` of `h1` and `body`, reduced to the first family that renders, else Archivo / Inter.
- Writes `assets/assets.json` (no timestamps, so a capture is reproducible). `--apply-brand` writes colours, fonts and
  logo into the project's brand; `--brand-preset <id>` writes `brands/<id>.json`.

### 5.7 `preview`, `setup`, `doctor`, `test`
`preview` serves the repository on a free port and prints a scrubbable URL per format. `setup` creates the venv,
installs Chromium and generates the shared fixture media. `doctor` checks the machine. `test` runs both suites.

---

## 6. Audio (`engine/audio/*.py`, run with the venv python)

Every script is deterministic for its seed, works at 48 kHz, exits non-zero on failure and prints one JSON summary
line on stdout. Music and mixes are stereo 24-bit; effect stems are mono. More on the sound design in [AUDIO.md](AUDIO.md).

### 6.1 `music.py --bpm 120 --key "A minor" --bars 8 --style minimal-tech --seed 7 [--loop] --out music.wav --beats beats.json`
Styles `minimal-tech`, `punchy-pop`, `ambient-cinematic`, `lofi`, each a set of drum patterns, bass, pad and lead
choices, swing and a progression in scale degrees. Length is exactly `bars * 4 * 60 / bpm`; loops wrap their tails
onto the start, one-shots end on a final hit. `beats.json` is exact:
`{"bpm":120, "beats":[0,0.5,...], "downbeats":[0,2,...], "duration":16.0, "source":"synth", "lag_ms":0, ...}`.

### 6.2 `sfx.py`
`click`, `pop`, `thump`, `whoosh`, `riser`, `swish`, `tick`, each `fn(seed, **kw) -> mono`. `PEAK_AT[name]` is the
time from the first sample to the perceived hit, so `cues.py` can land the hit, not the start, on the beat.
`sfx.py preview --out <dir>` writes every effect; `sfx.py render --cues ... --duration S [--loop] --out sfx.wav`.

### 6.3 Cues
The page derives cues from the timeline; nothing is hand-written. Scene `sfx` markers become absolute beats; each
non-cut transition adds a whoosh (a swish when it is half a beat or shorter) peaking on the boundary; loop films get a
riser into the wrap. `sfxDensity: sparse` keeps downbeats and clicks, `busy` adds ticks. `cues.py` converts beats to
seconds on the real grid, snaps to 1/16, subtracts `PEAK_AT`, seeds each cue from its id, and refuses any hit more
than 10 ms off the grid.

### 6.4 `mix.py --music ... --sfx ... --cues ... --duration S [--loop] [--lufs -14] --out mix.wav`
Sum music and effects, duck the music briefly under each thump, trim or pad (loop-wrap) to length, two-pass loudness
normalisation, then verify: −14 ±0.5 LUFS integrated and a true peak at or below −1 dBTP, or exit 1. Loop films also
check that the seam is no louder a step than the rest of the track.

### 6.5 `beats.py --in <track> --out beats.json [--bpm-hint N]` (supplied tracks only)
Tracks beats with librosa (no edge trimming), measures the median lag between our own onset peaks and the tracked
beats and removes it, fits a constant-tempo grid by least squares (the raw list is kept under `measured`), and picks
the downbeat phase with the strongest summed onsets.

### 6.6 Voice-over (`lib/voiceover.mjs`, `voice.py`)
- `file`: your recording inside the project; segments from `<stem>.segments.json`, else detected speech regions
  paired with `lines`.
- `elevenlabs`: only when `ELEVENLABS_API_KEY` is set in the environment; the key is never written anywhere.
- `say`: macOS drafts only (Apple's licence does not cover published audio); refused on other systems.

Synthesised lines are placed on the 1/16 grid (`at`, else one beat after the previous line), the music is ducked
under the voice (`duck_db`, default −9) and the result is mastered back to −14 LUFS. `voiceover.json` holds the
segment times that captions use.

---

## 7. Outputs (`projects/<name>/out/`)
```
timeline.json  lint.json  manifest.json  renditions.json (projects with variants or cutdowns)
<fmt>/draft.mp4 | final.mp4          H.264 yuv420p, AAC 256k, -14 LUFS, +faststart
<fmt>/draft_silent.mp4 | silent.mp4  the same video without audio
<fmt>/contact.png phone.png strip.png seam.png poster.png   (+ <sheet>_rN.png per critique round)
<fmt>/loop_check.mp4                 the film three times back to back, to judge a loop seam
<fmt>/export/<preset>.<ext>          720p, 4k, webm, gif, prores-alpha, tiktok, reels, youtube, linkedin
captions.srt  captions.vtt           when captions are on
```
`manifest.json` records the sha256 of every file, frames, fps, size, loudness per format, the audio summary and the
lint status, with no timestamps.

---

## 8. Extending

### 8.1 A new template
Copy the closest template folder, rename `id` in `scene.js` and `template.json`, and keep the §3.2 contract. Build
scenes from blocks where you can; write a `README.md` with the content fields and per-format behaviour; make the
example lint clean in every format (the test suite checks all templates in 4:5).

### 8.2 Engine code
Shared behaviour goes into `engine/blocks.js` or a library module, with a test. Keep modules small and pure.

### 8.3 Bespoke pages (`project.page`)
For a one-off film that fits no template: `{"page": "page.html", "title", "formats", "duration", "bpm", "brand", "audio"}`.
`reelcode new --page --name <n>` scaffolds it. The page gets `?project&format&w&h&mode[&variant][&cutdown]`, has a
`<canvas id="c">` of `w×h`, and defines `window.seek(t)`, a pure function of `t`. Optionally it sets
`window.reelcodeTimeline = {events, scenes, cues, poster}` (without events the cadence lint fails; without cues there
is no sound design). `engine/bespoke.js` adopts a minimal page into the full bridge, or a page calls
`await mount({draw(ctx, t, c), events, scenes, cues, poster})`. Every command works on it; lint applies the global bans.

### 8.4 Captions
`captions: {enabled, style: clean|bold|plain, source: voiceover|manual, sidecars, lines}`. Burned in after the
persistent layers on a solid plate in each format's caption zone, at most two lines, with an accent pill moving word
to word. Templates keep clear of `api.captionTop`.

---

## 9. Fixtures

- **`fixtures/mock-product/`**: "Tallyport", a fictional analytics app (static HTML, CSS and JS; no network; bundled
  fonts; no transitions; no clock or random data). `?state=home|search|report`; `window.__fixtureReady` when
  rendered; brand variables on `:root`; frozen `data-cap` ids: `logo, nav, search, kpi-1, kpi-2, kpi-3, chart, export,
  primary, palette, result-1, filters, report-chart, toast`.
- **`fixtures/media/make_media.py`**: three procedural photographs (ridge, harbor, canopy) and a short clip, rendered
  with numpy and cached in `fixtures/media/` (git-ignored). Media projects copy them in through `prepare`.

---

## 10. Testing

`npx reelcode test` prepares the fixture projects, runs `node --test engine/test/` and the Python audio suite.
- **Unit** (no browser): motion (spring regimes, continuity, presets), layout, text with a mock context, beat grid,
  noise, schema (every template example validates, `PROJECT_SCHEMA` equals the JSON file), sheets planners, captions.
- **CLI** (real Chromium and ffmpeg): render frame counts, stills dimensions, lint determinism and negatives, make end
  to end and idempotent reruns, renditions, bespoke pages, voice-over (`file` engine), exports, media, capture.
- **Audio**: music length and determinism per style, exact beat grids, effect determinism, cue snapping, the −14 LUFS
  mix, and `beats.py` recovering a known grid from a rendered track.

Test projects and brands use per-process names (`engine/test/_names.mjs`), so suites can run in parallel.

---

## 11. The critique loop

Specified in [HOUSE_RULES.md §7](HOUSE_RULES.md#7-the-critique-loop); the agent workflow that runs it is
[skills/reelcode/SKILL.md](../skills/reelcode/SKILL.md).
