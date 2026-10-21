// preview.mjs: serve the repository on a free localhost port and print the preview URL of a project
// (play button + scrubber under the canvas). Runs until Ctrl+C. Preview mode allows the browser clock;
// render mode does not, so what you scrub here is what render paints at that t.
//
// npx reelcode preview <project> [--format 9x16|1x1|4x5|16x9] [--variant id] [--cutdown id] [--open]
import { spawn } from 'node:child_process';
import { parseArgs, runCli } from './lib/args.mjs';
import { startServer } from './lib/server.mjs';
import { loadProject } from './lib/project.mjs';
import { missingPrepared } from './lib/prepare.mjs';
import { pageUrl } from './lib/browser.mjs';

const USAGE = 'npx reelcode preview <project> [--format 9x16|1x1|4x5|16x9] [--variant id] [--cutdown id] [--open]';
const SPEC = { format: { type: 'string' }, variant: { type: 'string' }, cutdown: { type: 'string' }, open: { type: 'boolean', default: false } };

function openInBrowser(url) {
  const cmd = process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'cmd' : 'xdg-open';
  const args = process.platform === 'win32' ? ['/c', 'start', '', url] : [url];
  const p = spawn(cmd, args, { stdio: 'ignore', detached: true });
  p.on('error', () => console.log(`(could not open a browser; open the URL yourself)`));
  p.unref();
}

runCli(USAGE, async () => {
  const a = parseArgs(process.argv.slice(2), SPEC, { positionals: [1, 1] });
  const P = loadProject(a._[0], { variant: a.variant, cutdown: a.cutdown });
  if (P.errors.length) console.error(`warning: ${P.errors.length} validation problem(s); run "npx reelcode lint ${P.name}"\n  ${P.errors.slice(0, 5).join('\n  ')}`);
  const missing = missingPrepared(P);
  if (missing.length) console.error(`warning: generated files missing (${missing.slice(0, 3).join(', ')}); run "npx reelcode make ${P.name}" once`);
  const format = a.format || P.formats[0];
  if (!P.formats.includes(format)) throw new Error(`format ${format} is not in project.formats (${P.formats.join(', ')})`);
  const srv = await startServer();
  const urls = P.formats.map((f) => [f, pageUrl({ base: srv.base, project: P.name, format: f, mode: 'preview', ...P.pageOpts })]);
  const main = urls.find(([f]) => f === format)[1];
  console.log(`preview of ${P.name} (Ctrl+C stops it)\n\n  open ${main}\n\nevery format:`);
  for (const [f, u] of urls) console.log(`  ${f.padEnd(5)} ${u}`);
  if (a.open) openInBrowser(main);
  await new Promise((ok) => { for (const sig of ['SIGINT', 'SIGTERM']) process.once(sig, ok); });
  await srv.close();
  return 0;
});
