# FAQ

**Do I need Claude Code?** No. Everything is a CLI; the plugin only teaches an agent the workflow, and the engine always lives in your clone.

**Can I publish the films?** Yes. The music and effects are synthesized by your own run, the bundled fonts are SIL
OFL. A font you add in `project.fonts` is under its own licence, which you state in its `licence` field. Do not publish macOS `say` voice-over: Apple's licence does not cover it. Use your own recording (`file`
engine) or a licensed text-to-speech service.

**Windows?** Not supported. WSL2 with Ubuntu should behave like Linux.

**Are renders byte-identical across machines?** Within one machine setup, yes. Across operating systems, Chromium's
font rasterisation and ffmpeg builds differ slightly, so pixels can differ by a little; timing, frame counts and
loudness do not.

**How long does a render take?** See [REQUIREMENTS.md](REQUIREMENTS.md).

**Can it capture my app?** `reelcode capture` screenshots a local app (localhost or a file) into a project. It refuses
remote URLs and blocks every request outside the app's origin.
