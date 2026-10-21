---
name: reelcode
description: Make a short motion-graphics film with reelcode (a code-rendered motion design studio) - a launch video, product reel, showreel, explainer, data story, social ad, logo sting, lower third or looping UI animation - in 9:16, 1:1, 4:5 and 16:9 from one timeline, with synthesized music on the beat and a contact-sheet critique loop. Use when the user asks for a video, reel, motion graphics, an animated ad or "a film for X" and a reelcode checkout is available or wanted.
---

# reelcode

reelcode renders films from `projects/<name>/project.json`. A template turns the project's content into scenes, a
headless Chromium paints every frame with `seek(t)`, ffmpeg encodes it, and Python synthesizes and masters the sound.
A new film is a new `project.json`, not new engine code.

## 0. Find the studio

Run every command from the root of a reelcode checkout (the folder with `bin/reelcode.mjs`).

1. If the current directory (or a parent) has `bin/reelcode.mjs`, use it.
2. Otherwise ask the user where their checkout is, or offer to make one:
   `git clone https://github.com/loehrning-ai/reelcode && cd reelcode && npm install && npx reelcode setup`.
   This plugin's own folder (`${CLAUDE_PLUGIN_ROOT}`) holds the same docs if you need to read them first.
3. Run `npx reelcode doctor`. Fix every `FAIL` line with the hint it prints before going on.

Read `docs/HOUSE_RULES.md` once per session. `docs/TEMPLATES.md`, `docs/PROJECT.md`, `docs/CLI.md` and each
`templates/<t>/README.md` are the references.

## 1. Collect the inputs

Ask for everything missing in one message. When the user does not give an item, use the default and say so.

| Input | Default |
|---|---|
| Subject (product, message, data) and the call to action or URL | ask |
| Duration (snapped to whole bars at the bpm) | the template default |
| Formats: any of `9x16`, `1x1`, `4x5`, `16x9` | all four |
| Brand: `bg`, `fg`, one `accent` (`#RRGGBB`), a display font and a UI font | a capture's colours, or `"@studio"` |
| Real UI, if the film shows a product | `capture` of a local app; `fixture:mock-product` only for demos |
| Music: a synth style (`minimal-tech`, `punchy-pop`, `ambient-cinematic`, `lofi`) and key, or a track the user owns | the template default |
| Voice-over: a script and a recording (`engine: "file"`), or ElevenLabs if `ELEVENLABS_API_KEY` is set | none |
| Captions and export presets | captions with voice-over; no exports |
| A reference film or frame for pace and type | none |

Fonts: the bundled families (`Archivo`, `Archivo Condensed`, `Archivo Expanded`, `Inter`, `JetBrains Mono`, `Jost`,
`Space Grotesk`) render everywhere. Any other family must be installed on the machine.

Never use macOS `say` for anything that will be published: Apple's licence does not allow it. It is fine for a
private timing draft, and only when the user agrees.

**Pick the template** (`npx reelcode new --list`):

| The job | Template |
|---|---|
| launch or feature film with real UI | `product-launch` (needs screens and a logo from `capture`) |
| brand reel, kinetic-type promo | `showreel` (`loop: false` for a one-shot) |
| social ad from photos or footage, 6 to 20 s | `social-ad` |
| how it works | `explainer` |
| numbers, a report, a KPI recap | `data-story` |
| UI loop, onboarding teaser | `morph-loop` |
| logo reveal or bumper | `logo-sting` |
| straps and titles over footage | `lower-third` |
| none fits | a new template (section 5) or a bespoke page (`npx reelcode new --page`) |

Say which template you picked and why. `_smoke`, `_smoke-ui` and `_media` are test templates; never use them for a film.

## 2. Pipeline

```sh
P=launch-q3                                                     # lowercase letters, digits, - and _

npx reelcode new --template product-launch --name $P --formats 9x16,1x1,4x5,16x9 --style minimal-tech
npx reelcode capture http://localhost:5173/ $P --routes home=/,report=/reports --apply-brand   # only for real UI
# edit projects/$P/project.json: content, brand, overrides.<format>   (the only file you edit)
npx reelcode lint $P --fast                                     # 0 errors before anything renders
# write the shotlist (step 3) and WAIT for the user's OK
npx reelcode make $P                                            # draft of every format, with sound
npx reelcode stills $P --sheet contact,phone,strip,seam --tag r1
# critique loop (section 3)
npx reelcode make $P --quality final                            # only after every score is 8+
```

**Filling `project.json`.** Every content field and its limits are in `templates/<t>/README.md` and in the
`content_schema` of `template.json`. Capture ids (`screen`, `zoom`, `pieces`, cursor targets) must exist in
`assets/assets.json`. Per-format copy goes in `overrides.<format>.content` (for example shorter hook lines in 9:16);
`duration`, `bpm`, `loop` and `audio` are shared by every format. Time refs: beats (`3`, `"b3.5"`, `"bar2"`) work
everywhere, seconds (`"s1.5"`) only in content. Generated assets (procedural images, scores) belong in `prepare`
steps so the project stays reproducible.

**The shotlist.** Before the first render, write `projects/$P/docs/shotlist.md`: one row per scene with
`scene | beats | start (bar.beat and seconds) | what is on screen | what is new every 2 to 4 s | sound on the grid | format notes`.
Timing comes from the template's scene order or from `npx reelcode make $P --only audio` (fast), which writes
`out/timeline.json`. Show it to the user and wait for an explicit OK.

## 3. Critique loop

At least three rounds, and keep going until every score in every format is 8 or more. In round N:

1. `npx reelcode make $P` (re-renders only what changed), then `npx reelcode stills $P --sheet contact,phone,strip,seam --tag rN`.
2. Open every sheet image in `projects/$P/out/<format>/` and look at it. Never score from memory or from the code.
3. Score each format from 1 to 10 on six axes, in writing, through two lenses:
   - as a motion designer: **hook** in the first 2 s, **motion quality** (springs settle, masks, no dead frames),
     **variety** (no two neighbouring scenes built the same way);
   - as a viewer on a phone with the sound on: **readability** on `phone.png`, **brand accuracy**, **sound sync**
     (hits against `out/timeline.json`, or watch `loop_check.mp4`).
4. Write `projects/$P/out/critique/rN.md` with the scores and the three worst problems as
   `problem / where (scene at time) / fix`. Treat every lint warning, including text QA, as a finding.
5. Fix those three, preferably in `project.json` (copy length, beats, overrides, shot order), run
   `npx reelcode lint $P --fast`, and start the next round.

To check one moment: `npx reelcode stills $P --sheet contact --at bar3 --format 9x16`. To re-render one passage:
`npx reelcode render $P --from bar3 --to bar5 --formats 9x16`.

**Delivery.** After the final make: look at `contact.png`, `seam.png` and `poster.png`; check `out/manifest.json`
(lint `pass`, every `lufs.I` within −14 ±0.5); report each format's `final.mp4` path, the duration and the
loudness; end with the two or three things you would improve next, honestly naming the weakest score. Never deliver
a draft as the final.

## 4. Rules that are not negotiable

- **Render contract.** Frame `t` depends only on `t`. No `Math.random`, `Date`, `performance.now`, timers,
  `requestAnimationFrame`, CSS animations or state between frames in page code; use the seeded `N.rng` and `N.noise`.
- **The banned look.** No glow, no gradient backgrounds, no fade-only entrances (`globalAlpha` is banned in
  templates), no centred lone title on frame one, no particle bursts, no frame borders or corner labels. Two fonts,
  one accent. Colours from theme keys, sizes from `F` and the layout helpers.
- **Sound.** Synthesized music unless the user supplies a track they own; effects come from the timeline; the mix
  is −14 LUFS with a true peak at or below −1 dBTP, and `make` fails otherwise.
- **Real UI, local only.** `capture` reads localhost, 127.0.0.1, a local file or a fixture, never a live site.
- **No secrets in files.** API keys live in environment variables only; never write one into `project.json` or a doc.
- **No fixed ports.** The CLI picks free ports itself.

## 5. When no template fits

1. Copy the closest template folder to `templates/<new-id>/` and change `id` in `scene.js` and `template.json`.
2. Keep the contract in `docs/SPEC.md` §3.2: `build(api)` returns `{scenes, persistent?, poster?}`; each scene's
   `draw(f)` reads only `f`. Prefer the blocks in `api.B` and the media helpers in `api.media`.
3. Lay out from `F.safe`, `L.split(..., {axis: 'long'})` and `F.pick({v, s, h})`; declare `events` and `sfx` on
   every scene; springs by preset name or `[response, damping]`.
4. Write `README.md` and a working `example` in `template.json`, then check:
   `npx reelcode new --template <new-id> --name try-<new-id>` and `npx reelcode lint try-<new-id>`, then
   `npx reelcode test engine/test/schema.test.mjs`.

## 6. Troubleshooting

| Symptom | Fix |
|---|---|
| `font missing: display "<family>"` | Use a bundled family or install the font; quote families with spaces. |
| `timeline: scenes sum to X beats, project needs Y` | Fix the scene beats, or make exactly one scene `"fill"`. |
| `N generated file(s) missing ... run make once` | Run `npx reelcode make <project>`; it runs the project's `prepare` steps. |
| `... is invalid (N problems)` | Each line names a JSON path; the allowed values are in the template README. |
| capture id not in `assets.json` | Capture again and use the ids in `assets/assets.json`. |
| `leaves the safe area` / `does not fit at min size` | Shorten the copy or add `overrides.<format>.content`. |
| cadence gap > 3 s or > 4 s | Add an event: a line, a cursor move, a shorter scene. |
| `loop [fmt]: last frame differs from frame 0` | Use the template's seam, `M.loopSeqv` or `M.loopPulse`. |
| `nondeterministic at t=...` | Render code read time, randomness or a cache; make it a function of `f`. |
| cues rejected, more than 10 ms off the grid | Put markers on 1/16 beats with `M.quant(beats)`. |
| `textqa ... contrast 3.7 < 4.5` | Use `fg`, a plate, or a stronger muted colour. |
| a crash | `REELCODE_DEBUG=1 npx reelcode make <project>` prints the stack; `npx reelcode preview <project>` gives a scrubber. |
