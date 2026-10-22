# Contributing

Bug fixes, templates, tests and documentation are welcome. Small, focused pull requests are easiest to review.

## Set up

```sh
git clone https://github.com/loehrning-ai/reelcode && cd reelcode
npm install
npx reelcode setup        # Python venv (uv or pip), Playwright Chromium, fixture media
npx reelcode doctor       # every check should say ok
```

## Before you open a pull request

```sh
npx reelcode test                       # node --test engine/test/ and the Python audio suite (about 9 min on a laptop)
npx reelcode test --node                # the faster half, for a quick check
npx reelcode lint <project>             # for any project or template you touched
```

The full suite takes several minutes because the CLI tests drive a real Chromium and a real ffmpeg. While iterating,
run single files: `npx reelcode test engine/test/motion.test.mjs`.

## What reviewers check

- **Determinism.** `seek(t)` stays a pure function of `t`. No clock, timers or `Math.random` in page code; no state
  between frames. `reelcode lint` must pass its determinism checks.
- **The house rules.** New templates and blocks follow [docs/HOUSE_RULES.md](docs/HOUSE_RULES.md): sizes from the
  frame, colours from the theme, no glow, no gradient backgrounds, no fade-only entrances, something new every
  2 to 4 seconds.
- **Every format.** A template's example lints clean in 9:16, 1:1, 4:5 and 16:9 (the test suite checks this).
- **Tests next to the change.** Engine helpers get a unit test; CLI behaviour gets a CLI test.
- **Docs that match the code.** Update [docs/SPEC.md](docs/SPEC.md), [docs/CLI.md](docs/CLI.md) or the template README
  in the same pull request. Do not state timings or counts that nothing in the repository produces.

## What not to commit

- Generated files: `out/`, `audio/`, generated assets, renders (the `.gitignore` covers them).
- Audio or images you do not have the rights to publish. That includes macOS `say` voice-over (Apple's licence
  does not cover publishing it) and fonts that are not under an open licence.
- Credentials, API keys, `.env` files, personal data, local machine paths.

## Adding a font

Fonts must be under the SIL Open Font License or a similarly permissive licence. Add the `.woff2` to `engine/fonts/`,
declare it in `fonts.css` and `fonts.json`, and put its licence text in `LICENSES/`.

## Licence

By contributing you agree that your contribution is licensed under the [MIT licence](LICENSE).
