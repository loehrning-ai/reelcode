// render.mjs: render a project's video (no audio) in one or more formats.
// npx reelcode render projects/Y [--quality draft|final] [--formats 9x16,1x1|all] [--variant id] [--cutdown id]
//      [--fps N --sub N --crf N --preset P] [--from ref --to ref] [--jobs N]
// Films are encoded as 1 s closed-GOP segments cached under out/.cache/<fmt>/ (unchanged segments are reused).
// --from/--to render only the segments of that range (engine/cli/lib/exporter.mjs renderRange) and splice them into
// the last full film of the same quality by stream copy.
import { join } from 'node:path';
import { parseArgs, runCli } from './lib/args.mjs';
import { loadProject, pickFormats } from './lib/project.mjs';
import { missingPrepared } from './lib/prepare.mjs';
import { startServer } from './lib/server.mjs';
import { launch } from './lib/browser.mjs';
import { preset, renderFormat, pool } from './lib/video.mjs';
import { renderRange } from './lib/exporter.mjs';
import { isNotImplemented } from '../notimpl.js';

const USAGE = 'npx reelcode render <project> [--quality draft|final] [--formats 9x16,1x1,4x5,16x9|all] [--variant id] [--cutdown id] [--fps N] [--sub N] [--crf N] [--preset P] [--from ref] [--to ref] [--jobs N] [--quiet]';
const SPEC = {
  quality: { type: 'string', enum: ['draft', 'final'] }, formats: { type: 'list' }, format: { type: 'list' },
  variant: { type: 'string' }, cutdown: { type: 'string' },
  fps: { type: 'number' }, sub: { type: 'number' }, crf: { type: 'number' }, preset: { type: 'string' },
  from: { type: 'string' }, to: { type: 'string' },
  jobs: { type: 'number', default: 3 }, quiet: { type: 'boolean', default: false },
};

runCli(USAGE, async () => {
  const a = parseArgs(process.argv.slice(2), SPEC, { positionals: [1, 1] });
  const P = loadProject(a._[0], { variant: a.variant, cutdown: a.cutdown });
  const pending = missingPrepared(P);
  if (pending.length) throw new Error(`${P.rel(P.dir)}: ${pending.length} generated file(s) missing (${pending.slice(0, 3).join(', ')}); run make once, it runs project.prepare`);
  if (P.errors.length) throw new Error(`${P.name}: project is invalid\n  ${P.errors.join('\n  ')}`);
  const quality = a.quality || P.base.quality || 'draft';
  const q = preset(quality, a);
  const formats = pickFormats(P, a.formats || a.format);
  const range = a.from !== undefined || a.to !== undefined;
  const srv = await startServer();
  let browser;
  try { browser = await launch(); } catch (e) { await srv.close(); throw e; }
  try {
    const one = (format) => (range
      ? renderRange({ P, format, q, quality, base: srv.base, browser, from: a.from, to: a.to, cacheDir: join(P.outDir(), '.cache', format) })
      : renderFormat({ P, format, q, quality, base: srv.base, browser,
        onProgress: a.quiet ? null : ({ sec, duration }) => process.stderr.write(`[${format}] ${sec.toFixed(0)}s / ${duration.toFixed(1)}s\n`) }));
    let results;
    try { results = await pool(formats, a.jobs, one); }
    catch (e) { if (range && isNotImplemented(e)) throw new Error(`--from/--to: range renders are ${e.message}`); throw e; }
    for (const r of results) {
      if (range) {
        console.log(`wrote ${P.rel(r.range)} (${r.frames} frames, ${r.fps}fps, ${r.from.toFixed(2)}s-${r.to.toFixed(2)}s, ${r.rendered} rendered + ${r.cached} cached segments)`);
        console.log(r.full ? `spliced into ${P.rel(r.full)}` : 'no cached full film of this quality to splice into (run render or make once without --from/--to)');
      } else console.log(`wrote ${P.rel(r.out)} (${r.frames} frames, ${r.fps}fps${r.sub ? ` sub ${r.sub}` : ''}${r.duration !== undefined ? `, ${r.duration.toFixed(2)}s` : ''}${r.seconds !== undefined ? `, rendered in ${r.seconds.toFixed(1)}s` : ''}${r.cached !== undefined ? `, ${r.cached}/${r.segments} segments cached` : ''})`);
    }
  } finally {
    await browser.close();
    await srv.close();
  }
});
