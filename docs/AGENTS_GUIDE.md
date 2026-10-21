# Using reelcode with other coding agents

The Claude Code plugin is a convenience: the workflow itself is plain files and a CLI, so any agent that can run
shell commands and look at images can make films with reelcode.

## Codex, Cursor, Aider and others

Point your agent at [skills/reelcode/SKILL.md](../skills/reelcode/SKILL.md). It is the complete workflow (inputs,
template choice, shotlist, draft, critique loop, final) and does not depend on Claude-specific tools. For example:

- **Codex CLI:** add a line to your own `AGENTS.md` in the checkout (it is git-ignored here):
  `For any video or motion-graphics task, follow skills/reelcode/SKILL.md.`
- **Cursor:** add a project rule (`.cursor/rules/reelcode.mdc`, also git-ignored) with the same sentence, or paste the
  skill into the chat.
- **Anything else:** start the session with "Read skills/reelcode/SKILL.md and docs/HOUSE_RULES.md, then ...".

## What the agent needs

- A shell in the checkout, to run `npx reelcode ...`.
- The ability to open PNG files. The critique loop depends on the agent actually looking at
  `out/<format>/contact.png`, `phone.png`, `strip.png` and `seam.png`. An agent that cannot see images can still
  render, lint and check loudness, but it cannot score the film; then a person should do the critique.
- Patience: a final render of a 20 s film takes around ten minutes per pair of formats on a laptop. Drafts are
  much faster; iterate on drafts and render the final once.

## A good first prompt

> Read skills/reelcode/SKILL.md. Make a 12 second data story in 9:16 and 1:1 about our sign-ups growing from 1,200 to
> 4,800 this quarter, brand colours #0B0B0C, #F4F1EA and #FF5A1F. Show me the shotlist before you render.
