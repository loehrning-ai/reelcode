# Requirements and timings

- Needs Node 20+ (CI runs 22), ffmpeg, and Python 3.12+ or [uv](https://docs.astral.sh/uv/), which brings its own Python.
  Missing ffmpeg? `brew install ffmpeg` or `sudo apt-get install -y ffmpeg`. `npx reelcode doctor` says what is missing.
- `npx` runs the copy inside the clone; nothing is fetched from the npm registry.
- Disk: about 570 MB for Playwright's Chromium (in its browser cache) and about 290 MB in `.venv/` for numpy, scipy, librosa
  and numba, plus a similar amount in the uv or pip cache. Setup took about 30 s with warm caches; with empty caches expect
  a minute or two on a fast line. Reruns skip finished steps and take seconds.
- On a bare Linux box, `npx reelcode setup --with-deps` also installs Chromium's system libraries (sudo). If a command
  fails on your distro, `npx reelcode doctor` output in an issue is the fastest fix.

| Render | What | Measured on an Apple Silicon laptop |
|---|---|---|
| draft (30 fps) | 16 s showreel, four formats | about two to four minutes, more if the machine is busy |
| final (`--quality final`, 60 fps, motion blur) | 20 s data-story, four formats | about 20 minutes on a busy machine |
| final | 22 s launch film, 1:1 and 9:16 in parallel | about 10 minutes |

A final paints eight times the frames of a draft, and frame capture is the bottleneck (see the roadmap). Add
`--formats 9x16` to render one format first. Unchanged 1 s segments come from a cache, so reruns after small edits are quick.
