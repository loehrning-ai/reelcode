#!/usr/bin/env node
// reelcode: one entry point for every command. Each command is a script in engine/cli/; this file only dispatches.
import { spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const CLI = join(ROOT, 'engine', 'cli');
const { version } = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'));

const COMMANDS = {
  setup: ['setup.mjs', 'install the Python venv (uv or pip) and Playwright Chromium, generate the shared fixture media'],
  doctor: ['doctor.mjs', 'check node, ffmpeg, Python, Chromium and the fonts, with a fix for each problem'],
  new: ['new.mjs', 'scaffold projects/<name> from a template (--list shows the templates)'],
  templates: ['new.mjs', 'list the templates (same as new --list)', ['--list']],
  make: ['make.mjs', 'build a film end to end: prepare, music, cues, mix, lint, every format, critique sheets'],
  render: ['render.mjs', 'render video only (silent), or one passage with --from/--to'],
  lint: ['lint.mjs', 'check a project: schema, assets, determinism, cadence, safe area, contrast, loop seam'],
  stills: ['stills.mjs', 'contact, phone, strip, seam and poster sheets for the critique loop'],
  capture: ['capture.mjs', 'screenshot a local app (localhost, a file or fixture:<name>) into project assets'],
  preview: ['preview.mjs', 'open a project in a browser with a scrubber (random free port)'],
  test: ['test.mjs', 'run the test suites (node --test and the Python audio suite)'],
};

function help() {
  const w = Math.max(...Object.keys(COMMANDS).map((k) => k.length));
  console.log(`reelcode ${version}: a motion design studio your coding agent runs.

usage: reelcode <command> [args]    (inside the clone: npx reelcode <command>)

${Object.entries(COMMANDS).map(([k, [, d]]) => `  ${k.padEnd(w)}  ${d}`).join('\n')}

A project is projects/<name>/project.json; pass it as <name> or projects/<name>.
Flags of one command: npx reelcode <command> --help
First run:  npx reelcode setup && npx reelcode doctor
Then:       npx reelcode make example-showreel
Docs:       README.md, docs/CLI.md, docs/HOUSE_RULES.md`);
}

const [cmd, ...rest] = process.argv.slice(2);
if (!cmd || cmd === 'help' || cmd === '--help' || cmd === '-h') { help(); process.exit(0); }
if (cmd === '--version' || cmd === '-v' || cmd === 'version') { console.log(version); process.exit(0); }
const entry = COMMANDS[cmd];
if (!entry) { console.error(`reelcode: unknown command "${cmd}"\n`); help(); process.exit(1); }

const [script, , preset = []] = entry;
const child = spawn(process.execPath, [join(CLI, script), ...preset, ...rest], { stdio: 'inherit', env: { ...process.env, REELCODE_CLI: '1' } });
for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => child.kill(sig));
child.on('close', (code, signal) => process.exit(code === null ? (signal ? 1 : 0) : code));
