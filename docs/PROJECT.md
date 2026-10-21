# project.json

A film is one file: `projects/<name>/project.json`. It is validated against
[project.schema.json](project.schema.json) (point `$schema` at it and your editor completes the fields) and the
template's own `content_schema`. Everything you leave out comes from the template's defaults.

```json
{
  "$schema": "../../docs/project.schema.json",
  "template": "showreel",
  "title": "Spring launch reel",
  "formats": ["9x16", "1x1", "4x5", "16x9"],
  "brand": "@studio",
  "content": { "shots": [ { "technique": "kinetic", "beats": 4, "lines": ["ONE", "TIMELINE"] } ] }
}
```

## Fields

| Field | Type | Meaning |
|---|---|---|
| `template` | string | A folder in `templates/`. Exactly one of `template` or `page`. |
| `page` | string | A bespoke page inside the project instead of a template ([SPEC.md §8.3](SPEC.md#83-bespoke-pages-projectpage)). |
| `title` | string | Required. Used in manifests and as the default for title content. |
| `formats` | array | Required. Any of `9x16`, `1x1`, `4x5`, `16x9`. |
| `brand` | object or `"@id"` | Required. Colours, fonts, logo, radius, springs; or a preset from `brands/`, optionally `{extends: "@id", ...}`. |
| `duration` | number | Seconds, snapped to whole bars at the project's `bpm`. Shared by every format. |
| `bpm` | number | Tempo of the beat grid (and of synth music). |
| `loop` | boolean | A seamless loop: the last frame leads into the first and the audio wraps. |
| `seed` | integer | Seed for music, effects and any noise the template uses. |
| `content` | object | Template-specific; see the template's README. |
| `assets` | object | `id -> path` of images under `assets/`. |
| `clips` | object | `id -> {src, from, to, fps, width}`: local video clips, pre-extracted to frames. |
| `prepare` | array | Generator steps that build assets before anything else ([SPEC.md §4.5](SPEC.md#45-prepare-generated-assets)). |
| `audio` | object | Music, effects, loudness and voice-over (below). |
| `captions` | object | `{enabled, style: clean\|bold\|plain, source: voiceover\|manual, sidecars, lines}`. |
| `poster` | time ref | The frame used for `poster.png` and thumbnails. |
| `quality` | `draft` \| `final` | The default for `make` without `--quality`. |
| `variants` | array | Alternate versions: `[{id, title, overrides: {content, brand, audio, captions, exports}}]`. |
| `cutdowns` | array | Shorter edits from the same scenes: `[{id, duration, keep: "auto" \| [scene ids], poster}]`. |
| `exports` | array | Extra deliverables: `720p`, `4k`, `webm`, `gif`, `prores-alpha`, `tiktok`, `reels`, `youtube`, `linkedin`. |
| `transparent` | boolean | No background; required by `prores-alpha`. |
| `overrides` | object | Per-format deep merge, applied last: `{"9x16": {"content": {...}}}`. Not for timeline fields. |

### `brand`
```json
{
  "name": "Tallyport",
  "colors": { "bg": "#0F1012", "fg": "#F2F0EA", "accent": "#3D5AFE", "muted": "#6B6B70", "surface": "#1C1C20" },
  "fonts": {
    "display": { "family": "\"Archivo Condensed\", sans-serif", "weight": 800, "tracking": -0.02 },
    "ui": { "family": "Inter, sans-serif", "weight": 500, "tracking": 0 }
  },
  "logo": "assets/logo.svg",
  "radius": 28,
  "springs": { "med": [0.36, 0.86] }
}
```
Bundled font families: `Archivo`, `Archivo Condensed`, `Archivo Expanded`, `Inter`, `JetBrains Mono`, `Jost`,
`Space Grotesk`. Any other family must be installed on the machine that renders. `multiAccent: true` unlocks
`colors.accent2`.

### `audio`
| Field | Values |
|---|---|
| `music` | `"synth"` (default), `"none"`, or a path inside the project to a supplied track |
| `style`, `key` | synth style (`minimal-tech`, `punchy-pop`, `ambient-cinematic`, `lofi`) and key (`"A minor"`) |
| `musicStart`, `fit` | for a supplied track: where to start (seconds) and how to fit it (`trim`, `loop`, `fade-bar`) |
| `sfx`, `sfxDensity` | effects on or off; `sparse`, `normal`, `busy` |
| `lufs` | target loudness, default −14 |
| `voiceover` | `{engine: "file" \| "elevenlabs" \| "say", file, voice, lines: [{text, at}], duck_db}` |

`say` is macOS only and for drafts (Apple's licence does not cover published audio). `elevenlabs` reads its key from
the `ELEVENLABS_API_KEY` environment variable; keys never go into project files.

### Time refs
A number of beats, `"b3.5"` (beats), `"bar2"` (bar 2 = beat 8) or `"s1.25"` (seconds).
