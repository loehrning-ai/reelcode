# Third-party notices

reelcode itself is MIT-licensed ([LICENSE](LICENSE)). It bundles a few third-party files and depends on others that
you install. This file lists them; licence texts for everything bundled are in [LICENSES/](LICENSES).

## Bundled in this repository

| Component | Files | Licence |
|---|---|---|
| Archivo (Omnibus-Type) | `engine/fonts/Archivo-Variable.woff2` | SIL Open Font License 1.1, [LICENSES/Archivo-OFL.txt](LICENSES/Archivo-OFL.txt) |
| Inter (Rasmus Andersson) | `engine/fonts/Inter-Variable.woff2` | SIL Open Font License 1.1, [LICENSES/Inter-OFL.txt](LICENSES/Inter-OFL.txt) |
| JetBrains Mono (JetBrains) | `engine/fonts/JetBrainsMono-Variable.woff2` | SIL Open Font License 1.1, [LICENSES/JetBrainsMono-OFL.txt](LICENSES/JetBrainsMono-OFL.txt) |
| Jost (indestructible type*) | `engine/fonts/Jost-Variable.woff2` | SIL Open Font License 1.1, [LICENSES/Jost-OFL.txt](LICENSES/Jost-OFL.txt) |
| Space Grotesk (Florian Karsten) | `engine/fonts/SpaceGrotesk-Variable.woff2` | SIL Open Font License 1.1, [LICENSES/SpaceGrotesk-OFL.txt](LICENSES/SpaceGrotesk-OFL.txt) |

The fonts are subsets (Latin and common punctuation) of the variable fonts, converted to WOFF2. The OFL allows
bundling and modification; the subsets keep their original family names because none of these fonts declares a
Reserved Font Name.

Two logos are derived from Inter: the wordmarks in `fixtures/mock-product/logo.svg` and `brands/tallyport/logo.svg`
are Inter glyphs converted to outlines. "Tallyport" and "Kestrelle" are fictional names made up for the fixtures.

All showcase media in `docs/media/` was rendered by reelcode from the projects in this repository: synthesized
music and effects, procedural images, bundled fonts. No stock media and no macOS voices are used.

## Installed by `npm install`

| Package | Licence |
|---|---|
| [playwright](https://github.com/microsoft/playwright) 1.64.1 and playwright-core | Apache-2.0, [LICENSES/Apache-2.0.txt](LICENSES/Apache-2.0.txt) |

`npx reelcode setup` downloads Playwright's build of Chromium into the Playwright cache, under Chromium's own
licences (BSD-3-Clause and others).

## Installed by `npx reelcode setup` (Python, pinned in `requirements.txt`)

| Package | Licence |
|---|---|
| numpy | BSD-3-Clause |
| scipy | BSD-3-Clause |
| librosa | ISC |
| soundfile | BSD-3-Clause; its wheels bundle libsndfile, which is LGPL-2.1-or-later |
| numba, llvmlite | BSD-2-Clause |
| scikit-learn, joblib, threadpoolctl (librosa dependencies) | BSD-3-Clause |
| soxr | LGPL-2.1-or-later (python-soxr bundles libsoxr) |
| pooch, lazy-loader, msgpack, decorator, platformdirs, requests and the rest of `requirements.txt` | permissive (MIT, BSD, ISC, Apache-2.0); see each package |

These packages are installed into `.venv/` on your machine. They are not redistributed by this repository.

## System tools you install

- **ffmpeg / ffprobe.** Not bundled. Depending on how your build was configured, ffmpeg is LGPL-2.1 or GPL-2.0;
  builds with `libx264` (which reelcode uses for H.264) are GPL. The H.264 and AAC formats may be subject to patent
  licensing in some countries for some commercial uses; that is between you and the relevant licensors.
- **Python 3.12+** (PSF licence) and **Node.js 20+** (MIT).
- **macOS `say`** (optional voice-over engine). Apple's macOS licence allows the system voices for personal,
  non-commercial use only. reelcode never ships `say` output, and you should not publish it.
- **ElevenLabs** (optional voice-over engine). A remote service under its own terms; you need your own account and key.

## Inspiration

reelcode was inspired by *How to Build a Motion Design Studio With Opus 5.5* by raycfu. No text or code from that
guide is included in this repository.
