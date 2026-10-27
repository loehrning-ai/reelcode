// lint.mjs: static bans, schema/assets, boot, cues, cadence, layout, determinism, loop and pixel heuristics.
// npx reelcode lint projects/Y [--fast] [--format F|all] [--variant id] [--cutdown id] [--framemd5] [--strict-text] [--no-textqa]
//      -> <rendition out>/lint.json (projects/Y/out/lint.json without variants/cutdowns)
import { readdirSync, existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { parseArgs, runCli } from './lib/args.mjs';
import { loadProject, pickFormats } from './lib/project.mjs';
import { missingPrepared } from './lib/prepare.mjs';
import { startServer, STUDIO_ROOT } from './lib/server.mjs';
import { launch, openPage } from './lib/browser.mjs';
import { lintFiles, lintSource, lintHtml, templateModules } from './lib/static.mjs';
import { framemd5 } from './lib/ffmpeg.mjs';
import { textQA, issueLine } from './lib/textqa.mjs';
import { FORMATS } from '../layout.js';

const USAGE = 'npx reelcode lint <project> [--fast] [--format 9x16|1x1|4x5|16x9|all] [--variant id] [--cutdown id] [--framemd5] [--strict-text] [--no-textqa]';
const SPEC = { fast: { type: 'boolean', default: false }, format: { type: 'list', default: ['all'] }, formats: { type: 'list' }, framemd5: { type: 'boolean', default: false },
  variant: { type: 'string' }, cutdown: { type: 'string' },
  'strict-text': { type: 'boolean', default: false }, textqa: { type: 'boolean', default: true } };
const PAGE_CODE_SKIP = new Set(['out', 'audio', 'assets', 'node_modules']);
const SCENE_ENGINE = new Set(['blocks.js', 'media.js', 'captions.js']);
const CAP_KEYS = ['zoom', 'pieces', 'assemble', 'to', 'drag'];

/** Bespoke page code: every *.js in the project folder (not out/, audio/, assets/). */
function pageModules(dir, top = true) {
  const out = [];
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    if (e.name.startsWith('.') || (top && PAGE_CODE_SKIP.has(e.name))) continue;
    const p = join(dir, e.name);
    if (e.isDirectory()) out.push(...pageModules(p, false)); else if (e.isFile() && /\.m?js$/.test(e.name)) out.push(p);
  }
  return out.sort();
}

/** A bespoke HTML page: CSS rules on the whole file, the JS bans on its inline <script> bodies (line numbers kept). */
function lintPageHtml(path) {
  const src = readFileSync(path, 'utf8'), file = path.slice(STUDIO_ROOT.length + 1), blank = (x) => x.replace(/[^\n]/g, ' ');
  let js = '', i = 0;
  for (const m of src.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/g)) {
    const body = m.index + m[0].indexOf('>') + 1;
    js += blank(src.slice(i, body)) + m[1];
    i = body + m[1].length;
  }
  js += blank(src.slice(i));
  return [...lintHtml(src, file), ...lintSource(js, { file })];
}

function staticChecks(P, R) {
  const eng = join(STUDIO_ROOT, 'engine');
  const files = readdirSync(eng).filter((f) => f.endsWith('.js')).map((f) => ({ path: join(eng, f), scene: SCENE_ENGINE.has(f) }));
  files.push({ path: join(eng, 'page.html'), html: true });
  if (P.templateDir) files.push(...templateModules(P.templateDir).map((path) => ({ path, scene: true })));
  if (P.page) files.push(...pageModules(P.dir).map((path) => ({ path })));
  const found = lintFiles(files, STUDIO_ROOT);
  if (P.page) found.push(...lintPageHtml(join(P.dir, P.page)));
  for (const e of found) R.error(`static ${e.file}:${e.line}: ${e.msg}`);
}

function walkCaps(v, out, key) {
  if (Array.isArray(v)) v.forEach((x) => walkCaps(x, out, key));
  else if (v && typeof v === 'object') for (const [k, x] of Object.entries(v)) walkCaps(x, out, k);
  else if (typeof v === 'string' && CAP_KEYS.includes(key)) out.add(v);
}

function schemaChecks(P, R) {
  for (const e of P.errors) R.error(`schema ${e}`);
  const b = P.base;
  for (const [id, p] of Object.entries(b.assets || {})) if (!existsSync(join(P.dir, String(p)))) R.error(`assets: ${id} -> ${p} is missing`);
  (Array.isArray(b.fonts) ? b.fonts : []).forEach((f, i) => { if (f && f.file && !existsSync(join(P.dir, f.file))) R.error(`assets: fonts[${i}] ${f.file} is missing`); });
  if (b.brand && b.brand.logo && !existsSync(b.brand.logo.startsWith('brands/') ? join(STUDIO_ROOT, b.brand.logo) : join(P.dir, b.brand.logo))) R.error(`assets: brand.logo ${b.brand.logo} is missing`);
  const aj = join(P.dir, 'assets', 'assets.json');
  const json = existsSync(aj) ? JSON.parse(readFileSync(aj, 'utf8')) : null;
  const req = P.template.requires || [];
  if (req.includes('screens') && !(json && Object.keys(json.screens || {}).length)) R.error('assets: template requires screens; run npx reelcode capture fixture:mock-product ' + P.rel(P.dir) + ' --apply-brand');
  if (req.includes('logo') && !(b.brand && b.brand.logo) && !(json && json.logo)) R.error('assets: template requires a logo');
  if (json) {
    for (const [id, s] of Object.entries(json.screens || {})) if (!existsSync(join(P.dir, s.file))) R.error(`assets: screen ${id} file ${s.file} is missing`);
    const rects = new Set(Object.values(json.screens || {}).flatMap((s) => Object.keys(s.rects || {})));
    const caps = new Set(); walkCaps(b.content, caps);
    for (const c of caps) if (!rects.has(c) && !(json.screens || {})[c]) R.error(`assets: content references capture id "${c}" that is not in assets.json`);
  }
}

function cadence(info, R) {
  const pts = [...info.events, info.duration];
  for (let i = 1; i < pts.length; i++) {
    const gap = pts[i] - pts[i - 1];
    const msg = `cadence: nothing new for ${gap.toFixed(2)}s (${pts[i - 1].toFixed(2)}s -> ${pts[i].toFixed(2)}s)`;
    if (gap > 4.0 + 1e-6) R.error(msg); else if (gap > 3.0 + 1e-6) R.warn(msg);
  }
  for (const s of info.scenes) if (!s.events && s.beats > 4) R.warn(`cadence: scene "${s.id}" lasts ${s.beats} beats with no events`);
}

async function layoutChecks(s, fmt, R) {
  const spec = FORMATS[fmt], safe = { x: spec.safe.l, y: spec.safe.t, w: spec.w - spec.safe.l - spec.safe.r, h: spec.h - spec.safe.t - spec.safe.b };
  const minSize = (spec.w < spec.h ? 0.028 : 0.035) * spec.h, W = spec.w, H = spec.h;
  let maxDiscs = 0;
  const times = [...new Set([...s.info.beatTimes, ...s.info.beatTimes.map((t) => t + 30 / s.info.bpm)])].filter((t) => t < s.info.duration).sort((a, b) => a - b);
  for (const t of times) {
    await s.seek(t);
    const r = await s.report();
    maxDiscs = Math.max(maxDiscs, r.discs);
    for (const o of r.overflow) R.error(`layout [${fmt}]: "${o.s}" does not fit at min size ${o.min.toFixed(1)}px`, `ov:${fmt}:${o.s}`);
    if (r.inTransition) continue;
    for (const x of r.texts) {
      const b = x.box, at = `at t=${t.toFixed(2)} (${r.scene})`;
      if (!x.bleed && (b.x < safe.x - 2 || b.y < safe.y - 2 || b.x + b.w > safe.x + safe.w + 2 || b.y + b.h > safe.y + safe.h + 2))
        R.error(`layout [${fmt}]: "${x.s}" leaves the safe area ${at}`, `safe:${fmt}:${x.s}`);
      if (x.size < minSize - 0.5) R.warn(`readability [${fmt}]: "${x.s}" is ${x.size.toFixed(1)}px (< ${minSize.toFixed(1)}px) ${at}`, `read:${fmt}:${x.s}`);
      const nx = b.x < 0.04 * W || b.x + b.w > 0.96 * W, ny = b.y < 0.04 * H || b.y + b.h > 0.96 * H;
      if (nx && ny && !x.bleed) R.warn(`corner label [${fmt}]: "${x.s}" sits in a corner ${at}`, `corner:${fmt}:${x.s}`);
    }
  }
  if (maxDiscs > 40) R.warn(`particles [${fmt}]: ${maxDiscs} discs in one frame (generic particle burst?)`);
}

/**
 * Readability section (lib/textqa.mjs): for every text at rest, WCAG contrast against the real pixels behind its box,
 * safe area / canvas clipping (unless bleed:true) and the 9x16 28 px phone floor. Findings are warnings and are
 * listed per format in lint.json textqa; --strict-text makes them errors.
 */
async function textChecks(s, fmt, R, strict) {
  const q = await textQA(s, fmt);
  R.textqa[fmt] = q;
  for (const i of q.issues) (strict ? R.error : R.warn).call(R, issueLine(fmt, i), `tq:${fmt}:${i.kind}:${i.text}:${i.box.x}:${i.box.y}`);
}

function sampleTimes(info) {
  const d = info.duration, S = [0];
  for (const sc of info.scenes) { S.push((sc.start + sc.end) / 2); if (sc.start > 0) S.push(sc.start - 1 / 60, sc.start + 1 / 60); }
  S.push(d - 1 / 60);
  return S.map((t) => Math.min(Math.max(0, t), d));
}

async function determinism(s, fmt, ctx, R, a) {
  const S = sampleTimes(s.info), ref = [];
  for (const t of S) ref.push(await s.seekHash(t));
  const bad = new Set();
  for (let i = S.length - 1; i >= 0; i--) if ((await s.seekHash(S[i])) !== ref[i]) bad.add(i);
  for (let i = 1; i < S.length; i++) { await s.seek(S[0]); if ((await s.seekHash(S[i])) !== ref[i]) bad.add(i); }
  const fresh = await openPage({ browser: ctx.browser, base: ctx.base, project: ctx.name, format: fmt, quiet: true, ...ctx.pageOpts });
  try {
    for (let i = 0; i < S.length; i++) if ((await fresh.seekHash(S[i])) !== ref[i]) bad.add(i);
    if (a.framemd5) {
      const shots = async (sess) => { const out = []; for (const t of S) { await sess.seek(t); out.push(await sess.shot()); } return out; };
      const [m1, m2] = [await framemd5(await shots(s)), await framemd5(await shots(fresh))];
      m1.forEach((h, i) => { if (h !== m2[i]) R.error(`nondeterministic [${fmt}] at t=${S[i].toFixed(4)} (framemd5 of screenshots differs)`); });
      R.info.framemd5 = (R.info.framemd5 || 0) + m1.length;
    }
  } finally { await fresh.close(); }
  for (const i of [...bad].sort((x, y) => x - y)) R.error(`nondeterministic [${fmt}] at t=${S[i].toFixed(4)}`);
  R.info.hashes = (R.info.hashes || 0) + S.length;
}

/** Pixel heuristics (warnings): centred lone title in the first second, frame borders. */
async function pixelChecks(s, fmt, R) {
  await s.seek(Math.min(1, s.info.duration));
  const r = await s.report();
  const lone = await s.page.evaluate((texts) => {
    const cv = document.getElementById('c'), ctx = cv.getContext('2d'), W = cv.width, H = cv.height;
    if (texts.length !== 1) return false;
    const b = texts[0].box, cx = b.x + b.w / 2, cy = b.y + b.h / 2;
    if (Math.abs(cx - W / 2) > 0.1 * W || Math.abs(cy - H / 2) > 0.1 * H) return false;
    const d = ctx.getImageData(0, 0, W, H).data, bg = [d[0], d[1], d[2]];
    let ink = 0, n = 0;
    for (let y = 0; y < H; y += 4) for (let x = 0; x < W; x += 4) {
      if (x >= b.x - 8 && x <= b.x + b.w + 8 && y >= b.y - 8 && y <= b.y + b.h + 8) continue;
      const i = (y * W + x) * 4; n++;
      if (Math.abs(d[i] - bg[0]) + Math.abs(d[i + 1] - bg[1]) + Math.abs(d[i + 2] - bg[2]) > 30) ink++;
    }
    return ink / n < 0.005;
  }, r.texts);
  if (lone) R.warn(`banned look [${fmt}]: a single centred title and nothing else in the first second`);
  // Frame borders: a uniform band along an edge that differs from the frame and from what is just inside it.
  // Footage is not a border (pixels inside logged media boxes are skipped: a pole at the edge of a clip), and a
  // border persists: a band must still be there half a beat later, so a panel whose spring is a hair short of
  // closing (a sliver that is gone a few frames on) is not flagged.
  const spb = 60 / s.info.bpm;
  for (const t of s.info.beatTimes.filter((_, i) => i % 2 === 0)) {
    const hits = await edgeBands(s, t);
    if (!Object.values(hits).some((f) => f > 0.8)) continue;
    const t2 = Math.min(t + spb / 2, Math.max(0, s.info.duration - 1 / 30));
    const again = t2 > t + 1e-6 ? await edgeBands(s, t2) : hits;
    for (const [e, f] of Object.entries(hits)) if (f > 0.8 && again[e] > 0.8) R.warn(`banned look [${fmt}]: uniform band along the ${e} edge at t=${t.toFixed(2)} (frame border?)`, `edge:${fmt}:${e}`);
  }
}

/** Share (0..1) of each edge's samples that form a uniform band at time t; edges that are mostly footage read 0. */
async function edgeBands(s, t) {
  await s.seek(t);
  return s.page.evaluate(() => {
    const cv = document.getElementById('c'), ctx = cv.getContext('2d'), W = cv.width, H = cv.height;
    const media = ((window.__reelcode.report() || {}).media || []).map((m) => m.box);
    const inMedia = (x, y) => media.some((b) => x >= b.x - 1 && x <= b.x + b.w + 1 && y >= b.y - 1 && y <= b.y + b.h + 1);
    const d = ctx.getImageData(0, 0, W, H).data, px = (x, y) => { const i = (y * W + x) * 4; return [d[i], d[i + 1], d[i + 2]]; };
    const dist = (a, b) => Math.abs(a[0] - b[0]) + Math.abs(a[1] - b[1]) + Math.abs(a[2] - b[2]);
    const bg = px(Math.floor(W / 2), Math.floor(H / 2));
    // xy(k, depth) -> [x, y] of the k-th sample along an edge, depth px inside it
    const edge = (n, xy) => {
      let hit = 0, used = 0;
      const ref = px(...xy(Math.floor(n / 2), 3));
      for (let k = 0; k < n; k += 4) {
        const [bx, by] = xy(k, 3), [ix, iy] = xy(k, 18);
        if (inMedia(bx, by) || inMedia(ix, iy)) continue;
        used++;
        const band = px(bx, by), inner = px(ix, iy);
        if (dist(band, bg) > 30 && dist(band, inner) > 30 && dist(band, ref) < 24) hit++;
      }
      return used >= 0.25 * Math.ceil(n / 4) ? hit / used : 0;
    };
    return { t: edge(W, (k, dd) => [k, dd]), b: edge(W, (k, dd) => [k, H - 1 - dd]), l: edge(H, (k, dd) => [dd, k]), r: edge(H, (k, dd) => [W - 1 - dd, k]) };
  });
}

runCli(USAGE, async () => {
  const a = parseArgs(process.argv.slice(2), SPEC, { positionals: [1, 1] });
  const P = loadProject(a._[0], { variant: a.variant, cutdown: a.cutdown });
  const pending = missingPrepared(P);
  if (pending.length) throw new Error(`${P.rel(P.dir)}: ${pending.length} generated file(s) missing (${pending.slice(0, 3).join(', ')}); run make once, it runs project.prepare`);
  const seen = new Set();
  const R = { errors: [], warnings: [], info: { fast: a.fast, formats: [] }, textqa: {},
    error(m, key = m) { if (!seen.has(key)) { seen.add(key); this.errors.push(m); } },
    warn(m, key = m) { if (!seen.has('w' + key)) { seen.add('w' + key); this.warnings.push(m); } } };
  staticChecks(P, R);
  schemaChecks(P, R);
  if (!P.errors.length) {
    const formats = pickFormats(P, a.formats || a.format);
    const srv = await startServer(), browser = await launch();
    const cues = {};
    try {
      for (const fmt of formats) {
        let s;
        try { s = await openPage({ browser, base: srv.base, project: P.name, format: fmt, quiet: true, ...P.pageOpts }); }
        catch (e) { for (const line of e.message.split('\n')) R.error(`boot [${fmt}]: ${line}`); continue; }
        try {
          R.info.formats.push(fmt);
          for (const w of s.warnings) R.warn(`boot [${fmt}]: ${w}`);
          for (const e of s.pageErrors) R.error(`pageerror [${fmt}]: ${e}`);
          cues[fmt] = JSON.stringify(await s.cues());
          if (fmt === R.info.formats[0]) { cadence(s.info, R); R.info.duration = s.info.duration; R.info.events = s.info.events.length; }
          await layoutChecks(s, fmt, R);
          if (a.textqa) await textChecks(s, fmt, R, a['strict-text']);
          if (!a.fast) {
            await determinism(s, fmt, { browser, base: srv.base, name: P.name, pageOpts: P.pageOpts }, R, a);
            if (s.info.loop) { const d = await s.diff(0, s.info.duration, 8); if (d > 0.005) R.error(`loop [${fmt}]: last frame differs from frame 0 (${(d * 100).toFixed(2)}% of pixels)`); }
            await pixelChecks(s, fmt, R);
          }
        } catch (e) { R.error(`lint [${fmt}]: ${e.message.split('\n')[0]}`); } finally { await s.close(); }
      }
    } finally { await browser.close(); await srv.close(); }
    const vals = Object.entries(cues);
    for (const [fmt, c] of vals.slice(1)) if (c !== vals[0][1]) R.error(`cues: ${fmt} cues differ from ${vals[0][0]} (cues must be identical across formats)`);
  }
  const out = join(P.outDir(), 'lint.json');
  mkdirSync(P.outDir(), { recursive: true });
  writeFileSync(out, JSON.stringify({ errors: R.errors, warnings: R.warnings, info: R.info, textqa: R.textqa }, null, 2) + '\n');
  for (const e of R.errors) console.log(`error   ${e}`);
  for (const w of R.warnings) console.log(`warning ${w}`);
  console.log(`wrote ${P.rel(out)} (${R.errors.length} errors, ${R.warnings.length} warnings${a.fast ? ', fast' : `, ${R.info.hashes || 0} determinism hashes`})`);
  return R.errors.length ? 1 : 0;
});
