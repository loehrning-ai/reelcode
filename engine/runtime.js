// runtime.js: boot(), theme, timeline compile, transitions, seek, cues, report, hash/diff.
// The film is a pure function of time: seek(t) repaints from a clean state and keeps nothing between frames.
import * as M from './motion.js';
import * as L from './layout.js';
import * as T from './text.js';
import * as D from './draw.js';
import * as C from './chart.js';
import * as K from './cursor.js';
import * as N from './noise.js';
import * as A from './assets.js';
import * as G from './beat.js';
import { applyCutdown } from './cutdown.js';
import { fetchJSON, readQuery, resolveForPage } from './load.js';
import { isNotImplemented } from './notimpl.js';

export const SFX = ['click', 'pop', 'thump', 'whoosh', 'riser', 'swish', 'tick'];
const TRANSITIONS = ['cut', 'push', 'wipe', 'iris', 'slats'];
const NAME = /^[a-z0-9_][a-z0-9_-]{0,63}$/;

// ---------- theme ----------
const hexRgb = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
const rgbHex = (c) => `#${c.map((v) => Math.round(Math.max(0, Math.min(255, v))).toString(16).padStart(2, '0')).join('').toUpperCase()}`;
export const mixHex = (a, b, p) => rgbHex(hexRgb(a).map((v, i) => v + (hexRgb(b)[i] - v) * p));

/** Build the theme from a resolved brand. Exactly two font roles, no shadow or glow keys. */
export function makeTheme(brand, F) {
  const c = brand.colors;
  const colors = Object.freeze({
    bg: c.bg.toUpperCase(), fg: c.fg.toUpperCase(), accent: c.accent.toUpperCase(),
    muted: (c.muted || mixHex(c.fg, c.bg, 0.45)).toUpperCase(),
    surface: (c.surface || mixHex(c.bg, c.fg, 0.08)).toUpperCase(),
  });
  const font = (f, w, tr) => Object.freeze({ family: f.family, weight: f.weight ?? w, tracking: f.tracking ?? tr });
  const theme = {
    colors,
    fonts: Object.freeze({ display: font(brand.fonts.display, 800, -0.03), ui: font(brand.fonts.ui, 400, 0.02) }),
    radius: (brand.radius ?? 28) * F.u,
    springs: Object.freeze({ ...M.DEFAULT_SPRINGS, ...(brand.springs || {}) }),
    /** rgb() string between two theme keys, for animated colour changes (never a fade to nothing). */
    mix: (a, b, p) => {
      const x = hexRgb(T.paint(theme, a)), y = hexRgb(T.paint(theme, b)), q = M.clamp(p);
      return `rgb(${x.map((v, i) => Math.round(v + (y[i] - v) * q)).join(',')})`;
    },
  };
  if (brand.multiAccent && c.accent2) theme.accent2 = c.accent2.toUpperCase();
  return Object.freeze(theme);
}

// ---------- timeline ----------
/** compile(built, grid, resolved) -> {scenes, persistent, loop, totalBeats, events, cues, poster}; throws on contract errors. */
export function compile(built, grid, resolved = {}) {
  if (!built || !Array.isArray(built.scenes) || !built.scenes.length) throw new Error('timeline: build() must return {scenes:[...]} with at least one scene');
  const total = grid.totalBeats, ids = new Set();
  const fills = built.scenes.filter((s) => s.beats === 'fill');
  if (fills.length > 1) throw new Error('timeline: only one scene may use beats:"fill"');
  for (const s of built.scenes) {
    if (typeof s.id !== 'string' || !s.id) throw new Error('timeline: every scene needs a string id');
    if (ids.has(s.id)) throw new Error(`timeline: duplicate scene id "${s.id}"`);
    ids.add(s.id);
    if (typeof s.draw !== 'function') throw new Error(`timeline: scene "${s.id}" has no draw(f)`);
    if (s.beats !== 'fill' && !(s.beats > 0)) throw new Error(`timeline: scene "${s.id}" beats must be > 0 or "fill"`);
  }
  const fixed = built.scenes.reduce((a, s) => a + (s.beats === 'fill' ? 0 : s.beats), 0);
  const fillBeats = total - fixed;
  if (!fills.length && Math.abs(fixed - total) > 1e-6) throw new Error(`timeline: scenes sum to ${fixed} beats, project needs ${total}`);
  if (fills.length && fillBeats < 2) throw new Error(`timeline: fill scene "${fills[0].id}" gets ${fillBeats} beats (needs >= 2); scenes sum to ${fixed}, project needs ${total}`);
  let at = 0;
  const dropped = [];
  const scenes = built.scenes.map((s, index) => {
    const beats = s.beats === 'fill' ? fillBeats : s.beats;
    const tr = s.transition && s.transition.type !== 'cut' && index > 0 ? { beats: 1, ...s.transition } : null;
    if (s.transition && !TRANSITIONS.includes(s.transition.type)) throw new Error(`timeline: scene "${s.id}" transition "${s.transition.type}" (use ${TRANSITIONS.join(', ')})`);
    if (tr && (tr.beats <= 0 || tr.beats > beats)) throw new Error(`timeline: scene "${s.id}" transition beats must be in (0, ${beats}]`);
    // events / sfx may be functions of the scene's real length (beats): a 'fill' scene, or a scene a cutdown
    // extended, then places its cues against the length it actually gets instead of a planned one.
    const list = (v, what) => {
      const r = typeof v === 'function' ? v(beats) : (v || []);
      if (!Array.isArray(r)) throw new Error(`timeline: scene "${s.id}" ${what} must be an array (or a function of the scene beats returning one)`);
      return r;
    };
    const evs = list(s.events, 'events'), sfxs = list(s.sfx, 'sfx');
    // A 'fill' scene planned with static lists does not know its length: drop its events/sfx past the real end (reported).
    const keep = (ref) => s.beats !== 'fill' || G.parseAt(ref, grid) <= beats + 1e-9;
    const kevs = evs.filter(keep), ksfx = sfxs.filter((m) => keep(m.at));
    if (kevs.length < evs.length || ksfx.length < sfxs.length)
      dropped.push(`timeline: fill scene "${s.id}" gets ${beats} beats; dropped ${evs.length - kevs.length} event(s) and ${sfxs.length - ksfx.length} sfx past its end (pass events/sfx as functions of the scene beats to place them yourself)`);
    const out = Object.freeze({ ...s, index, beats, start: at, end: at + beats, transition: tr, events: kevs, sfx: ksfx });
    at += beats;
    return out;
  });
  const sec = (b) => grid.beat(b);
  const evBeats = [];
  for (const s of scenes) {
    evBeats.push(s.start);
    for (const e of s.events || []) {
      const b = s.start + G.parseAt(e, grid);
      if (b < s.start - 1e-9 || b > s.end + 1e-9) throw new Error(`timeline: scene "${s.id}" event ${JSON.stringify(e)} is outside the scene`);
      evBeats.push(b);
    }
  }
  const events = [...new Set(evBeats.map((b) => +sec(b).toFixed(4)))].sort((a, b) => a - b);
  const loop = built.loop !== undefined ? !!built.loop : !!resolved.loop;
  // Poster precedence: project.poster (or template.json defaults.poster) > build().poster > default.
  // The default sits late in the last scene (start + 75% of it, at least 1 beat, at most beats - 0.5), so the
  // end card has landed instead of showing only its first element.
  const lastSc = scenes[scenes.length - 1];
  const posterBeat = resolved.poster !== undefined ? G.parseAt(resolved.poster, grid)
    : built.poster !== undefined ? G.parseAt(built.poster, grid)
      : lastSc.start + Math.max(Math.min(1, lastSc.beats), Math.min(lastSc.beats - 0.5, M.quant(lastSc.beats * 0.75)));
  return { scenes, persistent: built.persistent || [], loop, totalBeats: total, events, warnings: dropped,
    cues: deriveCues(scenes, grid, resolved.audio || {}, loop), poster: M.clamp(sec(posterBeat), 0, sec(total)) };
}

/** SFX whose length can be set (cues.py / sfx.py DEFAULT_DUR); the others are fixed one-shots. */
export const SFX_SIZED = ['whoosh', 'swish', 'riser'];
/** A scene sfx `dur` (time ref: number = beats, "s0.8" = seconds) -> seconds for cues.json; whoosh/swish/riser only. */
function sfxDur(m, s, grid) {
  if (!SFX_SIZED.includes(m.sfx)) throw new Error(`cues: scene "${s.id}" sfx "${m.sfx}" has a fixed length; dur applies to ${SFX_SIZED.join(', ')}`);
  const sec = G.parseAt(m.dur, grid) * grid.spb;
  if (!(sec >= 0.05 && sec <= 8)) throw new Error(`cues: scene "${s.id}" ${m.sfx} dur ${JSON.stringify(m.dur)} is ${sec.toFixed(3)}s (use 0.05-8 s)`);
  return +sec.toFixed(6);
}

/** Cues are derived from the timeline (never hand-written) and are identical across formats. */
export function deriveCues(scenes, grid, audio, loop) {
  const raw = [];
  for (const s of scenes) {
    let i = 0;
    for (const m of s.sfx || []) {
      if (!SFX.includes(m.sfx)) throw new Error(`cues: scene "${s.id}" uses unknown sfx "${m.sfx}" (use ${SFX.join(', ')})`);
      const c = { beat: s.start + G.parseAt(m.at, grid), sfx: m.sfx, gain_db: m.gain_db ?? -6, pan: m.pan ?? 0, id: `${s.id}:${i++}`, tier: m.tier };
      if (m.dur !== undefined && m.dur !== null) c.dur = sfxDur(m, s, grid);
      raw.push(c);
    }
    if (s.transition) raw.push({ beat: s.start, sfx: s.transition.beats <= 0.5 ? 'swish' : 'whoosh', gain_db: -8, pan: 0, id: `${s.id}:${i++}` });
  }
  if (loop) raw.push({ beat: grid.totalBeats, sfx: 'riser', gain_db: -10, pan: 0, id: 'loop:0' });
  const density = audio.sfxDensity || 'normal';
  const keep = (c) => {
    if (audio.sfx === false) return false;
    if (c.tier === 'busy' && density !== 'busy') return false;
    if (density === 'sparse') return c.sfx === 'click' || (Math.abs(c.beat - Math.round(c.beat)) < 1e-9 && Math.round(c.beat) % 4 === 0);
    return true;
  };
  const cues = raw.filter(keep).map(({ tier, ...c }) => ({ ...c, beat: +c.beat.toFixed(6) })).sort((a, b) => a.beat - b.beat || (a.id < b.id ? -1 : 1));
  return { bpm: grid.bpm, totalBeats: grid.totalBeats, loop, cues };
}

// ---------- frame ----------
function cleanState(ctx) {
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.globalAlpha = 1; ctx.globalCompositeOperation = 'source-over'; ctx.filter = 'none';
  ctx.shadowBlur = 0; ctx.shadowColor = 'transparent'; ctx.letterSpacing = '0px'; ctx.setLineDash([]);
  ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic'; ctx.lineCap = 'butt'; ctx.lineJoin = 'miter';
}

/** The clock of the active scene, for persistent layers: {id, index, beats, start, end (beats), t0 (s), lt, lb, p, since(at), inTransition, prev}. */
function sceneClock(S, sc, B, t, inTransition) {
  const t0 = S.grid.beat(sc.start), lt = t - t0, lb = B - sc.start;
  const prev = inTransition ? S.tl.scenes[sc.index - 1] : null;
  return Object.freeze({ id: sc.id, index: sc.index, beats: sc.beats, start: sc.start, end: sc.end, t0, lt, lb,
    p: M.clamp(lb / sc.beats), since: (at) => lt - (S.grid.beat(sc.start + G.parseAt(at, S.grid)) - t0),
    inTransition: !!inTransition, prev: prev ? prev.id : null });
}

function makeFrame(S, sc, B, t, persistentScene) {
  const startBeat = sc ? sc.start : 0;
  const t0 = S.grid.beat(startBeat);
  const lt = t - t0, lb = B - startBeat;
  const secOf = (at) => S.grid.beat(startBeat + G.parseAt(at, S.grid)) - t0;
  const scene = persistentScene || { id: sc.id, index: sc.index, beats: sc.beats };
  return Object.freeze({
    t, lt, lb, p: M.clamp(lb / (sc ? sc.beats : S.tl.totalBeats)),
    since: (at) => lt - secOf(at),
    hit: (at, len = 0.08, s = 'snap') => M.pulse(lt, secOf(at), len, s),
    on: (at, s = 'med') => M.sp(lt - secOf(at), s),
    ctx: S.ctx, F: S.F, theme: S.theme, data: S.data, assets: S.assets, grid: S.grid, spb: S.grid.spb,
    scene, fmt: S.F.fmt,
  });
}

function drawScene(S, sc, B, t) {
  S.ctx.save();
  try { sc.draw(makeFrame(S, sc, B, t)); } catch (e) { throw new Error(`scene "${sc.id}" at t=${t.toFixed(4)}: ${e.message}`); } finally { S.ctx.restore(); }
}

/** Paint frame t. Returns {scene, lb, inTransition}. */
export function seekState(S, tIn) {
  const { ctx, F, grid, tl } = S;
  const t = M.clamp(Number(tIn) || 0, 0, S.duration);
  const B = grid.at(t);
  let idx = 0;
  for (let i = 0; i < tl.scenes.length; i++) if (tl.scenes[i].start <= B + 1e-9) idx = i;
  const sc = tl.scenes[idx], tr = sc.transition;
  T.resetLog('frame');
  cleanState(ctx);
  // The frame background: painted in the brand bg, or cleared in the transparent (alpha) render.
  const ground = () => { if (S.alpha) ctx.clearRect(0, 0, F.w, F.h); else { ctx.fillStyle = S.theme.colors.bg; ctx.fillRect(0, 0, F.w, F.h); } };
  ground();
  const inT = !!tr && B < sc.start + tr.beats;
  if (inT) {
    const prev = tl.scenes[idx - 1];
    const p = M.easeInOutCubic((t - grid.beat(sc.start)) / (grid.beat(sc.start + tr.beats) - grid.beat(sc.start)));
    if (tr.type === 'push') {
      const [dx, dy] = D.dirVec(tr.dir || 'l');
      ctx.save(); ctx.translate(dx * p * F.w, dy * p * F.h); drawScene(S, prev, B, t); ctx.restore();
      ctx.save(); ctx.translate(-dx * (1 - p) * F.w, -dy * (1 - p) * F.h);
      if (!S.alpha) { ctx.fillStyle = S.theme.colors.bg; ctx.fillRect(0, 0, F.w, F.h); }
      drawScene(S, sc, B, t); ctx.restore();
    } else {
      drawScene(S, prev, B, t);
      ctx.save(); ctx.beginPath(); D.mask(ctx, tr.type, p, F, tr); ctx.clip();
      ground(); drawScene(S, sc, B, t); ctx.restore();
    }
  } else drawScene(S, sc, B, t);
  for (const layer of tl.persistent) {
    ctx.save(); cleanState(ctx);
    try { layer.draw(makeFrame(S, null, B, t, sceneClock(S, sc, B, t, inT))); }
    catch (e) { throw new Error(`persistent "${layer.id}" at t=${t.toFixed(4)}: ${e.message}`); }
    finally { ctx.restore(); }
  }
  if (S.captions) {
    ctx.save(); cleanState(ctx);
    try { S.captions(ctx, t); } catch (e) { throw new Error(`captions at t=${t.toFixed(4)}: ${e.message}`); } finally { ctx.restore(); }
  }
  S.last = { scene: sc.id, lb: B - sc.start, inTransition: inT, t };
  return { scene: sc.id, lb: B - sc.start };
}

/** Draw captions once at boot (mid-film, then restored by the first seek) so a stub fails at boot, not on a frame. */
function c2dProbe(ctx, draw, duration) {
  ctx.save(); cleanState(ctx);
  try { draw(ctx, duration / 2); } finally { ctx.restore(); }
}

/** FNV-1a 32-bit over RGBA bytes. */
export function fnv1a(data) {
  let h = 0x811c9dc5;
  for (let i = 0; i < data.length; i++) { h ^= data[i]; h = Math.imul(h, 0x01000193); }
  return (h >>> 0).toString(16).padStart(8, '0');
}

// ---------- boot ----------
/** A logo path is project-relative (assets/...) or a brand preset file (brands/<id>/...), served from the studio root. */
const assetUrl = (base, p) => (p.startsWith('brands/') ? `/${p}` : base + p);

async function loadAssets(name, resolved, template) {
  const base = `/projects/${name}/`;
  const declared = Object.fromEntries(Object.entries(resolved.assets || {}).map(([id, p]) => [id, base + p]));
  const images = await A.loadImages(declared);
  const json = await fetchJSON(`${base}assets/assets.json`, true);
  const screens = {};
  if (json && json.screens) {
    const imgs = await A.loadImages(Object.fromEntries(Object.entries(json.screens).map(([id, s]) => [id, base + s.file])));
    for (const [id, s] of Object.entries(json.screens)) screens[id] = Object.freeze({ id, img: imgs[id], w: s.w, h: s.h, rects: s.rects || {} });
  }
  // A captured logo is a small PNG; when capture also wrote the SVG, use that (crisp at end-card size).
  let logoPath = resolved.brand.logo || (json && json.logo && json.logo.file);
  const svg = json && json.logo && json.logo.svg;
  if (svg && (!resolved.brand.logo || resolved.brand.logo === json.logo.file)) logoPath = svg;
  let logo = null;
  if (logoPath) {
    try { logo = (await A.loadImages({ logo: assetUrl(base, logoPath) })).logo; }
    catch (e) { if (logoPath !== svg) throw e; logo = (await A.loadImages({ logo: assetUrl(base, resolved.brand.logo || json.logo.file) })).logo; }
  }
  const req = template.requires || [];
  if (req.includes('screens') && !Object.keys(screens).length) throw new Error(`assets: template "${template.id}" requires screens; run npx reelcode capture fixture:mock-product projects/${name} --apply-brand`);
  if (req.includes('logo') && !logo) throw new Error(`assets: template "${template.id}" requires a logo (brand.logo or assets.json logo)`);
  A.setRegistry({ images, screens, logo, json });
  return Object.freeze({ images, screens, logo, json, image: A.image, screen: A.screen });
}

/** {grid, buildGrid}: grid is the rendition's (cutdown) grid; buildGrid plans the full film (same beats, full length). */
async function loadGrid(name, resolved, fx, audioDir, fullDuration) {
  const beats = await fetchJSON(`/projects/${name}/${audioDir}/beats.json`, true);
  const music = (resolved.audio && resolved.audio.music) || 'synth';
  if (!beats && music !== 'synth' && music !== 'none') throw new Error(`grid: audio.music is a supplied track (${music}) but ${audioDir}/beats.json is missing; run make --only audio first`);
  if (beats && resolved.bpm && Math.abs(beats.bpm - resolved.bpm) > 0.01) fx.warnings.push(`grid: beats.json bpm ${beats.bpm} differs from project bpm ${resolved.bpm}; using beats.json`);
  const src = beats || { bpm: resolved.bpm || 120 };
  const grid = G.makeGrid(src, resolved.duration || 16);
  const full = fullDuration || resolved.duration || 16;
  return { grid, buildGrid: Math.abs(full - (resolved.duration || 16)) > 1e-9 ? G.makeGrid(src, full) : grid };
}

/** Optional v2 features: a NotImplemented stub (or a failure to load) disables the feature with a warning. */
async function loadCaptions(name, resolved, audioDir, fx) {
  const cap = resolved.captions;
  if (!cap || !cap.enabled) return null;
  try {
    const mod = await import('./captions.js');
    let segments = [];
    if ((cap.source || 'voiceover') === 'voiceover') {
      const vo = await fetchJSON(`/projects/${name}/${audioDir}/voiceover.json`, true);
      if (!vo) { fx.warnings.push(`captions: ${audioDir}/voiceover.json is missing (run make); no captions drawn`); return null; }
      segments = vo.segments || [];
    }
    return { mod, segments };
  } catch (e) { fx.warnings.push(`captions: disabled (${e.message})`); return null; }
}

async function loadClipsFor(name, resolved, fx) {
  if (!resolved.clips || !Object.keys(resolved.clips).length) return {};
  try { return await (await import('./media.js')).loadClips(`/projects/${name}/`, resolved.clips); }
  catch (e) { if (isNotImplemented(e)) { fx.warnings.push(`clips: ${e.message}; clips skipped`); return {}; } throw e; }
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

// @lint-allow-begin preview
function preview(fx) {
  const cv = document.getElementById('c');
  cv.style.cssText = 'max-width:100vw;max-height:calc(100vh - 48px);margin:0 auto;';
  const bar = document.createElement('div');
  bar.style.cssText = 'position:fixed;left:0;right:0;bottom:0;height:48px;display:flex;gap:12px;align-items:center;padding:0 16px;background:#111;color:#ddd;font:13px "JetBrains Mono",monospace';
  bar.innerHTML = '<button id="pl">play</button><input id="sc" type="range" min="0" step="0.001" style="flex:1"><span id="tm"></span>';
  document.body.appendChild(bar);
  const sc = bar.querySelector('#sc'), tm = bar.querySelector('#tm'), pl = bar.querySelector('#pl');
  sc.max = String(fx.duration);
  const show = (t) => { fx.seek(t); sc.value = String(t); tm.textContent = `${t.toFixed(2)}s  ${fx.report().scene || ''}`; };
  let playing = false, t0 = 0, from = 0;
  const tick = (now) => {
    if (!playing) return;
    let t = from + (now - t0) / 1000;
    if (t > fx.duration) { if (fx.loop) { from = 0; t0 = now; t = 0; } else { t = fx.duration; playing = false; pl.textContent = 'play'; } }
    show(t); requestAnimationFrame(tick);
  };
  pl.onclick = () => { playing = !playing; pl.textContent = playing ? 'pause' : 'play'; from = Number(sc.value); t0 = performance.now(); requestAnimationFrame(tick); };
  sc.oninput = () => { playing = false; pl.textContent = 'play'; show(Number(sc.value)); };
  show(fx.poster || 0);
}
// @lint-allow-end

/**
 * Load the brand's two families before the first frame. The bundled families (engine/fonts/fonts.css) load from the
 * engine; any other family must be installed on the machine. A family that does not render is a boot error, never
 * a silent fallback: a film in the wrong typeface is a wrong film.
 */
async function loadFonts(ctx, theme, fx) {
  const roles = ['display', 'ui'];
  await Promise.all(roles.map((role) => document.fonts.load(T.fontString(theme, role, 100)).catch(() => [])));
  await document.fonts.ready;
  const ok = T.probeFonts(ctx, theme);
  const missing = roles.filter((role) => !ok[role]);
  if (!missing.length) return;
  const bundled = await fetchJSON('/engine/fonts/fonts.json').then((j) => Object.keys(j.families)).catch(() => []);
  for (const role of missing) {
    fx.errors.push(`font missing: ${role} "${T.firstFamily(theme.fonts[role].family)}" is neither bundled nor installed here; ` +
      `install it, or use a bundled family (${bundled.join(', ')})`);
  }
  throw new Error(fx.errors.pop());
}

export async function boot() {
  const fx = (window.__reelcode = { status: 'booting', errors: [], warnings: [] });
  const fail = (msg) => { fx.errors.push(String(msg)); fx.status = 'error'; };
  window.addEventListener('error', (e) => { if (fx.status === 'booting') fail(e.message); });
  window.addEventListener('unhandledrejection', (e) => { if (fx.status === 'booting') fail(e.reason && e.reason.message || e.reason); });
  try { await bootInner(fx); } catch (e) { fail(e && e.message ? e.message : e); }
}

async function bootInner(fx) {
  const q = readQuery(location.search);
  const { name, format, mode, variant, cutdown } = q;
  // ?alpha=1 (the prores-alpha export): the background is cleared instead of painted; templates read api.alpha.
  const alpha = q.alpha === true;
  if (alpha) window.__reelcodeAlphaNative = true;
  if (!NAME.test(name)) throw new Error(`boot: bad or missing ?project= (${JSON.stringify(name)})`);
  if (!L.FORMATS[format]) throw new Error(`boot: unknown format "${format}" (use ${L.FORMAT_IDS.join(', ')})`);
  if (!['render', 'preview'].includes(mode)) throw new Error(`boot: unknown mode "${mode}"`);
  const project = await fetchJSON(`/projects/${name}/project.json`);
  if (typeof project.page === 'string') throw new Error(`boot: project "${name}" uses a bespoke page (${project.page}); open /projects/${name}/${project.page}`);
  if (!project.template || !NAME.test(project.template)) throw new Error('project.template: is required');
  const template = await fetchJSON(`/templates/${project.template}/template.json`);
  const { resolved, cutdown: cut, fullDuration, dirs } = await resolveForPage(project, template, format, { variant, cutdown });

  const F = L.frame(format);
  const cv = document.getElementById('c');
  cv.width = F.w; cv.height = F.h;
  const ctx = cv.getContext('2d');
  const theme = makeTheme(resolved.brand, F);
  ctx.__theme = theme;
  M.setSprings(theme.springs);

  await loadFonts(ctx, theme, fx);

  const assets = await loadAssets(name, resolved, template);
  const { grid, buildGrid } = await loadGrid(name, resolved, fx, dirs.audio, fullDuration);
  const captions = await loadCaptions(name, resolved, dirs.audio, fx);
  const clips = await loadClipsFor(name, resolved, fx);
  const mod = await import(`/templates/${project.template}/scene.js`);
  const tpl = mod.default;
  if (!tpl || typeof tpl.build !== 'function') throw new Error(`template "${project.template}": scene.js must export default {id, build(api)}`);

  T.resetLog('build');
  const data = Object.freeze(resolved.content);
  // Number formatting defaults (counterText, charts, blocks): content.locale / content.currency when given.
  T.setNumberFormat({ locale: 'en-US', currency: 'USD' });
  if (data && (typeof data.locale === 'string' || typeof data.currency === 'string'))
    T.setNumberFormat({ ...(typeof data.locale === 'string' ? { locale: data.locale } : {}), ...(typeof data.currency === 'string' ? { currency: data.currency } : {}) });
  // In a cutdown, build() plans the FULL film on api.grid (= buildGrid) and the engine keeps a subset of its scenes
  // (cutdown.js); draw code must read f.grid (the cutdown grid). api.cutdown lets a template plan the cut itself.
  const api = Object.freeze({ F, data, theme, grid: buildGrid, assets, ctx, project: Object.freeze(resolved), seed: resolved.seed ?? 7,
    variant: dirs.variant, cutdown: cut ? Object.freeze({ ...cut, totalBeats: grid.totalBeats }) : null, clips,
    // y of the burned-in caption lane (null when captions are off): keep bottom-anchored text above it
    captionTop: captions ? captions.mod.captionTop(F, resolved.captions) : null,
    // true in the transparent render (prores-alpha): the runtime clears the background; skip preview-only backdrops
    alpha,
    warn: (m) => fx.warnings.push(String(m)), M, L, T, D, C, K, N, A, G, B: await import('./blocks.js'), media: await import('./media.js') });
  const built = cut ? applyCutdown(tpl.build(api), grid.totalBeats, cut) : tpl.build(api);
  const tl = compile(built, grid, resolved);
  for (const w of tl.warnings) fx.warnings.push(w);
  const S = { ctx, F, theme, grid, data, assets, tl, duration: grid.beat(tl.totalBeats), last: null, captions: null, alpha };
  if (captions) {
    const capApi = Object.freeze({ F, theme, T, grid, captions: Object.freeze(resolved.captions), segments: captions.segments });
    try {
      if ((resolved.captions.source || 'voiceover') === 'manual') capApi.segments.push(...captions.mod.segmentsFromLines(resolved.captions.lines || [], grid, S.duration));
      S.captions = (c2d, t) => captions.mod.drawCaptions(c2d, capApi, t);
      T.quiet(() => { c2dProbe(ctx, S.captions, S.duration); });
    } catch (e) {
      S.captions = null;
      if (!isNotImplemented(e)) throw new Error(`captions: ${e.message}`);
      fx.warnings.push(`captions: ${e.message}; captions skipped`);
    }
  }
  T.resetLog('frame');

  Object.assign(fx, {
    format, W: F.w, H: F.h, duration: S.duration, bpm: grid.bpm, loop: tl.loop, poster: tl.poster, mode, alpha,
    seek: (t) => seekState(S, t),
    timeline: () => ({ duration: S.duration, bpm: grid.bpm, totalBeats: tl.totalBeats, loop: tl.loop,
      scenes: tl.scenes.map((s) => ({ id: s.id, start: grid.beat(s.start), end: grid.beat(s.end), startBeat: s.start, beats: s.beats,
        transition: s.transition ? { type: s.transition.type, beats: s.transition.beats } : { type: 'cut', beats: 0 }, events: (s.events || []).length })),
      events: tl.events.slice(), poster: tl.poster, measured: grid.measured, variant: dirs.variant, cutdown: dirs.cutdown,
      cut: built.cut ? { kept: built.cut.kept, dropped: built.cut.dropped, extended: built.cut.extended, by: built.cut.by } : null,
      beatTimes: Array.from({ length: tl.totalBeats }, (_, i) => +grid.beat(i).toFixed(6)) }),
    /** Seconds for a CLI time: a numeric string is seconds; otherwise a ref (number = beats, "b3", "bar2", "s1.5"). */
    time: (ref) => M.clamp(typeof ref === 'string' && /^-?\d+(\.\d+)?$/.test(ref) ? Number(ref) : grid.beat(G.parseAt(ref, grid)), 0, S.duration),
    cues: () => JSON.parse(JSON.stringify(tl.cues)),
    report: () => ({ ...T.getLog(), ...(S.last || {}) }),
    hash: () => fnv1a(ctx.getImageData(0, 0, F.w, F.h).data),
    diff: (tA, tB, thr = 8) => {
      seekState(S, tA); const a = ctx.getImageData(0, 0, F.w, F.h).data;
      seekState(S, tB); const b = ctx.getImageData(0, 0, F.w, F.h).data;
      let n = 0;
      for (let i = 0; i < a.length; i += 4) if (Math.abs(a[i] - b[i]) > thr || Math.abs(a[i + 1] - b[i + 1]) > thr || Math.abs(a[i + 2] - b[i + 2]) > thr) n++;
      return n / (F.w * F.h);
    },
  });
  seekState(S, tl.poster);
  if (mode === 'render') installGuard();
  window.seek = (t) => fx.seek(t);
  fx.status = 'ready';
  if (mode === 'preview') preview(fx);
}
