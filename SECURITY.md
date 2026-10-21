# Security policy

## Reporting a vulnerability

Please do not open a public issue for a suspected vulnerability. Send a private report to `tim@loehrning.ai`, or use
GitHub's private vulnerability reporting on this repository if it is enabled. Include the affected command or file,
the impact, and steps to reproduce. Remove credentials and personal data from anything you send.

Acknowledgement is targeted within five business days. Fix and disclosure timing depends on severity.

## Scope

reelcode is a local tool: it renders pages in a headless Chromium on your machine and runs Python and ffmpeg on
files in the repository. In scope:

- **The static server** (`engine/cli/lib/server.mjs`): it binds 127.0.0.1 on a random port and must never serve a file
  outside the repository root. A path traversal or a non-loopback bind is in scope.
- **`capture`**: it accepts only `fixture:<name>`, `http://127.0.0.1:*`, `http://localhost:*` and local files, and it
  aborts every request outside the target origin. A way to make it reach the network is in scope.
- **`prepare` steps**: scripts must resolve inside the repository. A `project.json` that runs code outside it is in
  scope. (A `prepare` script inside the repository is code you chose to run, like any other script in a clone.)
- **Project paths**: assets, clips, voice-over files and bespoke pages must stay inside their project folder.
- **Secrets**: the only secret reelcode reads is `ELEVENLABS_API_KEY`, from the environment. Any path that writes it
  to a file, a log or an output is in scope.

Out of scope: running untrusted projects or templates (they are code), and vulnerabilities in Chromium, ffmpeg,
Python or their packages themselves (report those upstream).
