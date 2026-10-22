# Changelog

All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and versions follow [Semantic Versioning](https://semver.org/).

## [0.1.0] - 2026-10-20

First public release.

### Fixed
- A failed Chromium launch no longer leaves the preview server listening, so a missing browser fails fast instead of hanging. `reelcode test` now caps each test at 15 minutes.

### Added
- One CLI, `reelcode`: `setup`, `doctor`, `new`, `templates`, `make`, `render`, `lint`, `stills`, `capture`, `preview`, `test`.
  `templates` lists the eight user templates; `--all` also shows the internal test ones.
- The engine: a deterministic canvas runtime (`seek(t)`), four formats from one timeline (9:16, 1:1, 4:5, 16:9),
  brand presets, variants and cutdowns, bespoke pages, captions with SRT/VTT sidecars, media blocks, voice-over.
- Rendering: headless Chromium to ffmpeg with sub-frame motion blur, a 1 s segment cache, range renders and export
  presets (720p, 4k, webm, gif, ProRes 4444 alpha, platform presets).
- Audio: synthesized music in four styles with exact beat grids, timeline-derived sound effects on the 1/16 grid,
  mixes verified at −14 LUFS and ≤ −1 dBTP, beat tracking for supplied tracks.
- Lint: determinism, cadence, safe areas, phone readability, text contrast, the banned looks, loop seams.
- Critique sheets: contact, phone, strip, seam and poster.
- Eight templates (`showreel`, `product-launch`, `data-story`, `explainer`, `morph-loop`, `logo-sting`,
  `lower-third`, `social-ad`) with an example project each.
- `data-story` draws declines as well as growth on its hero spine, and stops with a plain message when a change is
  too small to draw.
- Bundled OFL fonts (Archivo, Inter, JetBrains Mono, Jost, Space Grotesk), so renders work on macOS and Linux.
- A Claude Code plugin with a skill that runs the shotlist, draft and critique loop.
