// stills.mjs: contact / phone / strip / seam / poster sheets for the critique loop (no video render).
// npx reelcode stills projects/Y --format 9x16|all --sheet contact|phone|strip|seam|poster|all [--at t]
//      [--every beat|bar|<s>] [--cols 6] [--tag r1] [--variant id] [--cutdown id]
// contact = one tile per beat on the beat grid (bars, then 2 bars ... beyond 64 tiles);
// strip = 12 frames spanning the busiest scene boundary (a real transition when there is one).
import { mkdirSync, mkdtempSync, rmSync, copyFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseArgs, runCli, UsageError } from './lib/args.mjs';
import { loadProject, pickFormats } from './lib/project.mjs';
import { missingPrepared } from './lib/prepare.mjs';
import { startServer } from './lib/server.mjs';
import { launch, openPage } from './lib/browser.mjs';
import { tile } from './lib/ffmpeg.mjs';
import { SHEETS, sheetTimes, tileW, contactTimes, busiestBoundary, STRIP_FRAMES } from './lib/sheets.mjs';

const USAGE = 'npx reelcode stills <project> [--format 9x16|1x1|4x5|16x9|all] [--sheet contact|phone|strip|seam|poster|all] [--at t] [--every beat|bar|<s>] [--cols 6] [--tag rN] [--variant id] [--cutdown id]';
const SPEC = {
  format: { type: 'list', default: ['all'] }, formats: { type: 'list' }, sheet: { type: 'list', default: ['contact'] },
  at: { type: 'string' }, every: { type: 'string' }, cols: { type: 'number' }, tag: { type: 'string' },
  variant: { type: 'string' }, cutdown: { type: 'string' },
};

function note(sheet, info, a) {
  if (a.at !== undefined) return '';
  if (sheet === 'contact' && (!a.every || a.every === 'beat')) { const c = contactTimes(info); return `, one per ${c.unit}`; }
  if (sheet === 'strip') { const b = busiestBoundary(info); return b ? `, ${STRIP_FRAMES} frames across ${info.scenes[b.index - 1].id} -> ${info.scenes[b.index].id} (${b.transition.type})` : ', mid-film'; }
  return '';
}

async function makeSheet(s, P, format, sheet, a) {
  const dir = P.outDir(format);
  mkdirSync(dir, { recursive: true });
  // A private temp folder per sheet and run: never wipe a folder another sheet or process may be using.
  const frames = mkdtempSync(join(dir, `_frames-${sheet}-`));
  try {
    const at = a.at !== undefined ? await s.page.evaluate((r) => window.__reelcode.time(r), a.at) : undefined;
    let times;
    try { times = sheetTimes(sheet, s.info, { every: a.every, at }); } catch (e) { throw new UsageError(e.message); }
    const files = [];
    for (const [i, t] of times.entries()) {
      const f = join(frames, `${String(i).padStart(4, '0')}.png`);
      await s.seek(t); await s.shot(f); files.push(f);
    }
    const out = join(dir, `${sheet}.png`);
    let desc;
    if (sheet === 'poster') { copyFileSync(files[0], out); desc = `${s.W}x${s.H}`; }
    else {
      const w = tileW(s.W, s.H, sheet), h = Math.round((w * s.H) / s.W);
      const cols = sheet === 'seam' ? 4 : sheet === 'strip' ? times.length : sheet === 'phone' ? 4 : a.cols || 6;
      const r = await tile({ frames: files, cols, width: w, height: h, out });
      desc = `${r.cols}x${r.rows} tiles of ${w}x${h}${note(sheet, s.info, a)}`;
    }
    const written = [out];
    if (a.tag) { const tagged = join(dir, `${sheet}_${a.tag}.png`); copyFileSync(out, tagged); written.push(tagged); }
    for (const w of written) console.log(`wrote ${P.rel(w)} (${times.length} frame${times.length > 1 ? 's' : ''}, ${desc}; t=${times.map((t) => +t.toFixed(3)).join(',')})`);
    return written;
  } finally {
    rmSync(frames, { recursive: true, force: true });
  }
}

runCli(USAGE, async () => {
  const a = parseArgs(process.argv.slice(2), SPEC, { positionals: [1, 1] });
  if (a.tag && !/^[A-Za-z0-9_-]{1,32}$/.test(a.tag)) throw new UsageError('--tag must be letters, digits, - or _');
  const sheets = a.sheet.includes('all') ? SHEETS : a.sheet;
  for (const sh of sheets) if (!SHEETS.includes(sh)) throw new UsageError(`unknown sheet "${sh}" (use ${SHEETS.join(', ')} or all)`);
  const P = loadProject(a._[0], { variant: a.variant, cutdown: a.cutdown });
  const pending = missingPrepared(P);
  if (pending.length) throw new Error(`${P.rel(P.dir)}: ${pending.length} generated file(s) missing (${pending.slice(0, 3).join(', ')}); run make once, it runs project.prepare`);
  if (P.errors.length) throw new Error(`${P.name}: project is invalid\n  ${P.errors.join('\n  ')}`);
  const formats = pickFormats(P, a.formats || a.format);
  const srv = await startServer();
  const browser = await launch();
  try {
    for (const format of formats) {
      const s = await openPage({ browser, base: srv.base, project: P.name, format, ...P.pageOpts });
      try { for (const sheet of sheets) await makeSheet(s, P, format, sheet, a); } finally { await s.close(); }
    }
  } finally { await browser.close(); await srv.close(); }
});
