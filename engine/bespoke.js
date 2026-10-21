// bespoke.js: the reelcode bridge (window.__reelcode) for a bespoke page (project.page), so make / render / stills /
// lint drive a one-off film exactly like a template film.
//
// A bespoke page is projects/<p>/<page>.html. Its contract:
//   - a <canvas id="c">, sized from ?w=&h= (or ?format=), and window.seek(t) that paints frame t as a pure function
//     of t (no Math.random/Date.now/timers/rAF/CSS transitions; lint scans the page and its *.js);
//   - optionally window.reelcodeTimeline = {events:[s], scenes:[{id, start, end}], cues:[{beat, sfx, gain_db, pan, id}], poster: s}
//     before seek is defined (cadence lint and cues use it; without events the cadence lint fails).
// Minimal pages only define window.seek; openPage() then calls adopt(). Pages that want the resolved project and
// grid call `await mount({draw(ctx, t, c) {...}, events, scenes, cues, poster})` instead.
import * as G from './beat.js';
import { PAGE_TEMPLATE } from './schema.js';
import { fetchJSON, readQuery, resolveForPage } from './load.js';
import { fnv1a } from './runtime.js';

const clamp = (x, a, b) => Math.min(b, Math.max(a, x));

/** The page's reelcode context: query, resolved project (rendition), beat grid, duration, canvas size. */
export async function context(search = location.search) {
  const q = readQuery(search);
  const project = await fetchJSON(`/projects/${q.name}/project.json`);
  const r = await resolveForPage(project, PAGE_TEMPLATE, q.format, q);
  const res = r.resolved;
  const beats = await fetchJSON(`/projects/${q.name}/${r.dirs.audio}/beats.json`, true);
  const grid = G.makeGrid(beats || { bpm: res.bpm || 120 }, res.duration || 16);
  // the bundled families are declared in /engine/fonts/fonts.css; load the brand's two before the first frame
  const fonts = (res.brand && res.brand.fonts) || {};
  await Promise.all(['display', 'ui'].filter((r) => fonts[r] && fonts[r].family)
    .map((r) => document.fonts.load(`${fonts[r].weight || 400} 100px ${fonts[r].family}`).catch(() => [])));
  await document.fonts.ready;
  return Object.freeze({ ...q, project: res, cutdown: r.cutdown, dirs: r.dirs, grid, duration: grid.beat(grid.totalBeats),
    W: q.w || 1080, H: q.h || 1920 });
}

// @lint-allow-begin guard
function installGuard() {
  const ban = (name) => () => { throw new Error(`determinism: ${name} is banned in render mode`); };
  Math.random = ban('Math.random');
  Date.now = ban('Date.now');
  try { performance.now = ban('performance.now'); } catch { /* left to the static lint */ }
  window.setTimeout = ban('setTimeout');
  window.setInterval = ban('setInterval');
  window.requestAnimationFrame = ban('requestAnimationFrame');
}
// @lint-allow-end

function readPixels(cv) {
  const c2 = cv.getContext('2d', { willReadFrequently: true });
  if (c2) return c2.getImageData(0, 0, cv.width, cv.height).data;
  const off = new OffscreenCanvas(cv.width, cv.height), o = off.getContext('2d');
  o.drawImage(cv, 0, 0);
  return o.getImageData(0, 0, cv.width, cv.height).data;
}

/**
 * adopt({seek?, timeline?}) -> Promise<__reelcode>: wrap the page's window.seek in the reelcode bridge.
 * Sets window.__reelcode synchronously (status 'booting'), then 'ready' or 'error'.
 */
export async function adopt(opts = {}) {
  const fx = (window.__reelcode = { status: 'booting', errors: [], warnings: [] });
  try {
    const c = await context();
    const cv = document.getElementById('c');
    if (!cv) throw new Error('bespoke page: no <canvas id="c">');
    if (cv.width !== c.W || cv.height !== c.H) { cv.width = c.W; cv.height = c.H; }
    const paint = opts.seek || window.seek;
    if (typeof paint !== 'function') throw new Error('bespoke page: window.seek(t) is not defined');
    const own = Object.fromEntries(Object.entries(opts.timeline || {}).filter(([, v]) => v !== undefined));
    const tl = { ...(window.reelcodeTimeline || {}), ...own };
    const D = c.duration, g = c.grid;
    const scenes = (tl.scenes && tl.scenes.length ? tl.scenes : [{ id: 'page', start: 0, end: D }]).map((s) => ({
      id: String(s.id), start: s.start, end: s.end, startBeat: g.at(s.start), beats: g.at(s.end) - g.at(s.start),
      transition: { type: 'cut', beats: 0 }, events: (tl.events || []).filter((e) => e > s.start && e < s.end).length }));
    const events = [...new Set([0, ...(tl.events || []).filter((e) => e >= 0 && e <= D)])].sort((a, b) => a - b);
    const cues = { bpm: g.bpm, totalBeats: g.totalBeats, loop: !!c.project.loop, cues: (tl.cues || []).slice() };
    const poster = clamp(tl.poster !== undefined ? tl.poster : c.project.poster !== undefined ? g.beat(G.parseAt(c.project.poster, g)) : D * 0.75, 0, D);
    let last = null;
    const seek = (t) => { const x = clamp(Number(t) || 0, 0, D); paint(x); last = { scene: (scenes.find((s) => x >= s.start && x < s.end) || scenes[scenes.length - 1]).id, t: x }; return { scene: last.scene, lb: g.at(x) }; };
    Object.assign(fx, {
      format: c.format, W: cv.width, H: cv.height, duration: D, bpm: g.bpm, loop: !!c.project.loop, poster, mode: c.mode, bespoke: true,
      seek,
      timeline: () => ({ duration: D, bpm: g.bpm, totalBeats: g.totalBeats, loop: !!c.project.loop, scenes, events: events.slice(), poster,
        measured: g.measured, beatTimes: Array.from({ length: g.totalBeats }, (_, i) => +g.beat(i).toFixed(6)) }),
      time: (ref) => clamp(typeof ref === 'string' && /^-?\d+(\.\d+)?$/.test(ref) ? Number(ref) : g.beat(G.parseAt(ref, g)), 0, D),
      cues: () => JSON.parse(JSON.stringify(cues)),
      report: () => ({ texts: [], overflow: [], discs: 0, inTransition: false, lb: last ? g.at(last.t) : 0, ...(last || {}) }),
      hash: () => fnv1a(readPixels(cv)),
      diff: (tA, tB, thr = 8) => {
        seek(tA); const a = readPixels(cv); seek(tB); const b = readPixels(cv);
        let n = 0;
        for (let i = 0; i < a.length; i += 4) if (Math.abs(a[i] - b[i]) > thr || Math.abs(a[i + 1] - b[i + 1]) > thr || Math.abs(a[i + 2] - b[i + 2]) > thr) n++;
        return n / (cv.width * cv.height);
      },
      context: c,
    });
    seek(poster);
    if (c.mode === 'render') installGuard();
    window.seek = (t) => fx.seek(t);
    fx.status = 'ready';
  } catch (e) { fx.errors.push(String(e && e.message ? e.message : e)); fx.status = 'error'; }
  return fx;
}

/**
 * mount({draw(ctx, t, c), events, scenes, cues, poster}) -> Promise<__reelcode>
 * For pages that want the reelcode context: sizes #c, then window.seek(t) = draw(ctx, t, c) and adopts the bridge.
 * events/scenes/cues/poster may be values or functions of c (to place them on c.grid).
 * c = context() (project, grid, duration, W, H, format, variant, cutdown).
 */
export async function mount({ draw, events, scenes, cues, poster } = {}) {
  window.__reelcode = { status: 'booting', errors: [], warnings: [] };
  const c = await context();
  const cv = document.getElementById('c');
  cv.width = c.W; cv.height = c.H;
  const ctx = cv.getContext('2d');
  const seek = (t) => { ctx.setTransform(1, 0, 0, 1, 0, 0); draw(ctx, t, c); };
  const val = (v) => (typeof v === 'function' ? v(c) : v);
  return adopt({ seek, timeline: { events: val(events), scenes: val(scenes), cues: val(cues), poster: val(poster) } });
}
