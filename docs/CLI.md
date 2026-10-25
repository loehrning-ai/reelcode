# CLI

One entry point, `reelcode`, run from the cloned repository with `npx reelcode <command>` (npm resolves the local
bin; nothing is downloaded from the registry). A `<project>` is a name such as `example-showreel` or a path such
as `projects/example-showreel`. Every command exits 0 on success and 1 on failure. `npx reelcode <command> --help`
(or `-h`) prints that command's flags and exits 0.

| Command | Does |
|---|---|
| `setup` | Python venv with the pinned audio dependencies (uv when installed, else `python3 -m venv` + pip), Playwright Chromium, shared fixture media; then `doctor` |
| `doctor` | Checks node, ffmpeg and ffprobe (and their filters and encoders), the venv and its packages, Chromium, the bundled fonts; prints a fix for each problem |
| `new` | Scaffolds `projects/<name>/project.json` from a template |
| `templates` | Lists the templates (same as `new --list`) |
| `make` | Builds a film end to end: prepare, music, cues, mix, lint, every format, critique sheets, manifest |
| `render` | Video only (silent), or one passage with `--from`/`--to` |
| `lint` | Schema, assets, determinism, cadence, safe area, contrast, loop seam |
| `stills` | Contact, phone, strip, seam and poster sheets |
| `capture` | Screenshots a local app into a project's assets |
| `preview` | Serves the repository on a free port and prints a scrubbable URL per format |
| `test` | Runs the node and Python test suites |

## setup
```
npx reelcode setup [--force] [--with-deps] [--skip-browser] [--skip-media] [--python /path/to/python3]
```
Safe to run again; finished steps are skipped. `--force` rebuilds the venv. `--with-deps` also installs Chromium's
system libraries on Linux (needs sudo). Without uv, setup needs Python 3.12 or newer.

## doctor
```
npx reelcode doctor [--json] [--skip-browser]
```

## new
```
npx reelcode new --template <t> --name <name> [--title T] [--formats 9x16,1x1,4x5,16x9] [--duration S] [--bpm N]
                 [--style S] [--key K] [--seed N] [--loop|--no-loop] [--brand @id] [--force]
npx reelcode new --page --name <name>        # a bespoke page (SPEC.md §8.3)
npx reelcode new --list [--all]              # --all also shows the internal _test templates
```

## make
```
npx reelcode make <project> [--quality draft|final] [--formats 9x16,1x1,4x5,16x9|all] [--only video|audio]
                  [--variant id|all] [--cutdown id|all] [--no-stills] [--force] [--jobs N] [--quiet]
```
`draft` is 30 fps without motion blur; `final` is 60 fps with 4 blended sub-frames per frame. Reruns only re-render
what changed. Outputs land in `projects/<name>/out/` ([SPEC.md §7](SPEC.md#7-outputs-projectsnameout)).

## render
```
npx reelcode render <project> [--quality draft|final] [--formats ...|all] [--variant id] [--cutdown id]
                    [--fps N] [--sub N] [--crf N] [--preset P] [--from ref] [--to ref] [--jobs N] [--quiet]
```

## lint
```
npx reelcode lint <project> [--fast] [--format 9x16|1x1|4x5|16x9|all] [--variant id] [--cutdown id]
                  [--framemd5] [--strict-text] [--no-textqa]
```
Writes `out/lint.json`. `--fast` skips the determinism and pixel passes.

## stills
```
npx reelcode stills <project> [--format F|all] [--sheet contact,phone,strip,seam,poster|all] [--at t]
                    [--every beat|bar|<s>] [--cols 6] [--tag rN] [--variant id] [--cutdown id]
```

## capture
```
npx reelcode capture <fixture:name | http://127.0.0.1:PORT/... | http://localhost:PORT/... | page.html> <project>
                     [--states a,b] [--routes a=/x,b=/y] [--selectors id=css,...] [--w 1440 --h 900 --dpr 2]
                     [--no-full] [--no-crops] [--apply-brand] [--brand-preset id]
                     [--wait-for css|state=css,...] [--wait-timeout ms] [--warm]
                     [--scroll css|state=css,...] [--scroll-offset px] [--hide css]
```
Only local targets are accepted, and every request outside the target origin is blocked.

For apps that render in the browser (React, Next.js, Vue):

| Flag | What it does |
|---|---|
| `--wait-for <css>` | Waits until the element is visible before the screenshot. One selector for every state, or `state=css` pairs. Capture fails if it never shows. |
| `--wait-timeout <ms>` | How long `--wait-for` (and `--warm`'s network idle) may take. Default 30000. |
| `--warm` | Loads every state twice. The first visit fills the cache, so the screenshot uses fonts that a cold visit skips (`font-display: optional`). |
| `--scroll <css>` | Scrolls the state to the element. One selector for every state, or `state=css` pairs. Capture fails if it matches nothing. |
| `--scroll-offset <px>` | CSS pixels kept above the scroll target, for a sticky header. Default 0. |
| `--hide <css>` | Removes matching elements (`display: none`) before the screenshot: dev badges, cookie banners, chat widgets. |

```sh
npx reelcode capture http://localhost:3000/ my-reel \
  --routes home=/,pricing=/pricing --selectors 'title=main h1,plans=section#plans' \
  --warm --wait-for 'pricing=section#plans' --scroll 'pricing=section#plans' --scroll-offset 96 --hide nextjs-portal
```
A screen's rects are clipped to the screenshot; an element scrolled out of view keeps its crop but has no rect on
that screen, and a scrolled screen records `scroll: {x, y}` (screenshot pixels) in `assets.json`. The same recipe can
live in `project.json` under `content.capture` (templates that allow it, such as `showreel`):
`{states, routes, selectors, viewport, fullPage, crops, waitFor, waitTimeout, warm, scroll, scrollOffset, hide}`.
A flag wins over the same key in the recipe. For a Next.js dev server use `http://localhost:PORT`, not
`127.0.0.1`: Next serves its dev resources to `localhost` only, so the client-rendered parts would never mount.

## preview
```
npx reelcode preview <project> [--format F] [--variant id] [--cutdown id] [--open]
```

Prints one `open` line with the page of `--format` (default: the project's first format), then the page of every
format. Open those page URLs; the server root has no index. `--open` opens the first one in your browser.

## test
```
npx reelcode test [--node | --py] [--concurrency N] [file ...]   # the full run takes about 9 minutes; pass --node or a file for a quick check
```

## Environment variables

| Variable | Used for |
|---|---|
| `REELCODE_PYTHON` | a Python to use instead of `.venv/bin/python` |
| `REELCODE_DEBUG` | print stack traces on errors |
| `ELEVENLABS_API_KEY` | the `elevenlabs` voice-over engine (read from the environment only) |
