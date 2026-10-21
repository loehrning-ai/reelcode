# Templates

A template turns `content` in `project.json` into a film. Each one lives in `templates/<name>/` with a `scene.js`
(the code), a `template.json` (defaults, content schema and an example) and a `README.md` (every content field and
how the template behaves in each format). Every template renders to 9:16, 1:1, 4:5 and 16:9 from one timeline.

```sh
npx reelcode new --list                                   # the live list
npx reelcode new --template showreel --name my-reel       # scaffold projects/my-reel/project.json from the example
npx reelcode make my-reel                                 # draft of every format, with sound and critique sheets
```

| Template | Default | Makes | Example project | Notes |
|---|---|---|---|---|
| [`showreel`](../templates/showreel/README.md) | 16 s, 120 bpm, loop | Kinetic-type reel: fast cuts on the beat, a new type technique every shot, an accent dot carried across every cut | `example-showreel` | `loop:false` makes it a one-shot |
| [`product-launch`](../templates/product-launch/README.md) | 22 s, 120 bpm | Launch film from real UI captures: a hook over the product's own numbers, the UI assembling itself, feature macros on the clicked control, a metric that collapses into the logo, a per-format CTA | `example-launch` | needs screens and a logo: `capture` a local app (the fixture app works out of the box) |
| [`data-story`](../templates/data-story/README.md) | 20 s, 120 bpm | Data story from numbers: a hero spine for growth or decline, bar race, self-drawing line, comparisons, kinetic takeaway, locale-formatted numbers | `example-data` | can score itself from its own timeline (`score.py`) |
| [`explainer`](../templates/explainer/README.md) | 30 s, 96 bpm | How-it-works explainer: one object travels through 3 to 5 steps, each with a hero shot and a flow-diagram caption, then a recap | `example-explainer` | the `vo` variant uses macOS `say` (draft only) |
| [`morph-loop`](../templates/morph-loop/README.md) | 14 s, 120 bpm, loop | One UI container that never cuts and morphs through 3 to 12 states, driven by a cursor, as an exact loop | `example-morph` | ships with a procedural music bed (`assets/bed.py`) |
| [`logo-sting`](../templates/logo-sting/README.md) | 4 s, 120 bpm | 2 to 5 s logo reveal with an audio logo, plus an optional end card to append to other films | `example-sting` | `score.py` renders its three-act score; `transparent` enables ProRes 4444 alpha |
| [`lower-third`](../templates/lower-third/README.md) | 16 s, 120 bpm | Broadcast lower thirds and title overlays on a transparent canvas, for use over footage | `example-lower-third` | ProRes 4444 alpha export; demo over a generated clip |
| [`social-ad`](../templates/social-ad/README.md) | 18.75 s, 128 bpm | 6 to 20 s social ad from photos or footage: full-bleed hook, media shots, an offer card that becomes the CTA; captions on | `example-ad` | variants and cutdowns ready |

The underscore templates (`_smoke`, `_smoke-ui`, `_media`) are runtime proofs used by the test suite.

## Example projects

Every `projects/example-*` folder is a complete film. Generated files (procedural photos, captures, scores) are
rebuilt by the project's `prepare` steps on the first `make`, so the repository stays small:

```sh
npx reelcode make example-showreel                    # draft, every format
npx reelcode make example-data --quality final        # 60 fps with motion blur
npx reelcode preview example-launch                   # scrub it in a browser
```

## Writing a template

1. Copy the closest template folder and rename the `id` in `scene.js` and `template.json`.
2. Keep the contract in [SPEC.md §3.2](SPEC.md#32-template-contract-templatesnamescenejs): `build(api)` returns the
   scenes once per format; every `draw(f)` is a pure function of `f`.
3. Prefer blocks (`api.B`) and media helpers (`api.media`) over custom drawing; they bring their own events,
   sound cues and per-format layouts.
4. Sizes from `F.u` and boxes, colours from the theme, springs by preset name or `[response, damping]`.
5. Give scenes stable ids and, where it helps, `cut` hints, so cutdowns work.
6. Write the README (content fields, per-format behaviour, the sound it makes) and an `example` in `template.json`
   that lints clean in every format. `npx reelcode test` checks all of them.
