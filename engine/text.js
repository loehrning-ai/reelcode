// text.js: font probe, fitting, wrapping, drawing and kinetic type. Every drawn text box is
// logged (in canvas pixels, after the current transform) so lint can check safe areas and size.
import { sp, drop as dropM } from './motion.js';

// ---------- per-frame log (reset by runtime.seek) ----------
const LOG = { texts: [], overflow: [], discs: 0, build: [], media: [], painted: new Set() };
let LOG_PHASE = 'build';
let QUIET = 0;
/**
 * quiet(fn): run fn with the text log switched off (no text boxes, no overflow records), return its result.
 * Use it for drawing into an offscreen buffer (whose transform is not the frame's) or for trial layouts;
 * log the resting slot yourself with logText / logRest.
 */
export function quiet(fn) {
  QUIET++;
  try { return fn(); } finally { QUIET--; }
}
export function resetLog(phase = 'frame') { LOG.texts = []; LOG.overflow = []; LOG.discs = 0; LOG.media = []; LOG.painted = new Set(); LOG_PHASE = phase; }
export const logDisc = (n = 1) => { LOG.discs += n; };
export function getLog() {
  return { texts: LOG.texts.slice(), overflow: [...LOG.build, ...LOG.overflow], discs: LOG.discs, media: LOG.media.slice() };
}
function logOverflow(s, size, min) {
  if (QUIET) return;
  const list = LOG_PHASE === 'build' ? LOG.build : LOG.overflow;
  if (!list.some((o) => o.s === s && o.min === min)) list.push({ s, size, min });
}
function txBox(ctx, b) {
  const m = typeof ctx.getTransform === 'function' ? ctx.getTransform() : null;
  if (!m || m.isIdentity) return { box: b, k: 1 };
  const pts = [[b.x, b.y], [b.x + b.w, b.y], [b.x, b.y + b.h], [b.x + b.w, b.y + b.h]]
    .map(([x, y]) => [m.a * x + m.c * y + m.e, m.b * x + m.d * y + m.f]);
  const xs = pts.map((p) => p[0]), ys = pts.map((p) => p[1]);
  const x = Math.min(...xs), y = Math.min(...ys);
  return { box: { x, y, w: Math.max(...xs) - x, h: Math.max(...ys) - y }, k: Math.sqrt(Math.abs(m.a * m.d - m.b * m.c)) };
}
/**
 * logText(ctx, s, box, size, role, bleed?, extra?): record a text box (canvas pixels after the transform).
 * extra (optional): {color (the painted fill string), rest (true when box is a resting slot, not the drawn spot)}.
 */
export function logText(ctx, s, b, size, role, bleed = false, extra) {
  if (QUIET) return -1;
  const { box, k } = txBox(ctx, b);
  const e = { s, box, size: size * k, role, bleed: !!bleed };
  if (extra && extra.color) e.color = extra.color;
  if (extra && extra.rest) e.rest = true;
  LOG.texts.push(e);
  return LOG.texts.length - 1;
}

/**
 * logMedia(ctx, box, kind): record where photo / footage pixels were drawn this frame (canvas pixels after the
 * transform). Lint's look heuristics (the frame-border check) skip these pixels: a pole at the edge of a clip is
 * footage, not a border. engine/media.js drawMedia logs every image and clip frame it draws.
 */
export function logMedia(ctx, b, kind = 'media') {
  if (QUIET) return;
  LOG.media.push({ kind, box: txBox(ctx, b).box });
}

// ---------- ink switch (lint text QA) ----------
let INK = true;
/**
 * setInk(on): with ink off, drawText lays out and logs as usual but paints no glyphs, so a lint pass can read the
 * pixels BEHIND every text box. Lint only; default on; returns the previous value.
 */
export function setInk(on) { const was = INK; INK = !!on; return was; }
export const inkOn = () => INK;
let INK_SKIP = -1;
/**
 * skipInk(i): paint every text except the one that becomes log entry i of the frame (getLog().texts[i]); -1 = none.
 * Lint only: comparing a frame with and without one text's glyphs tells whether that text shows at all (it may sit
 * under an opaque panel). Returns the previous value.
 */
export function skipInk(i) { const was = INK_SKIP; INK_SKIP = Number.isInteger(i) ? i : -1; return was; }
/** Did the last painted frame draw glyphs attributed to log entry i (drawText's own entry, or its `inkOf`)? */
export const paintedInk = (i) => LOG.painted.has(i);

// ---------- colour contrast (WCAG 2.x) ----------
/** [r, g, b] (0-255) from '#rgb', '#rrggbb[aa]' or 'rgb()/rgba()'; null when it cannot be parsed. */
export function parseColor(c) {
  if (Array.isArray(c)) return c.slice(0, 3).map(Number);
  const str = String(c).trim();
  let m = /^#([0-9a-f]{3})$/i.exec(str);
  if (m) return [...m[1]].map((h) => parseInt(h + h, 16));
  m = /^#([0-9a-f]{6})(?:[0-9a-f]{2})?$/i.exec(str);
  if (m) return [0, 2, 4].map((i) => parseInt(m[1].slice(i, i + 2), 16));
  m = /^rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)/i.exec(str);
  if (m) return [m[1], m[2], m[3]].map(Number);
  return null;
}
const lin = (v) => { const x = v / 255; return x <= 0.04045 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4; };
/** WCAG relative luminance of an sRGB colour (array or string). */
export function luminance(c) {
  const [r, g, b] = parseColor(c) || [0, 0, 0];
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}
/** WCAG contrast ratio (1..21) between two colours (arrays or strings). */
export function contrastRatio(a, b) {
  const x = luminance(a), y = luminance(b);
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
}
/** WCAG AA minimum for a size: 3 for large text (>= 48 px on a 1080 frame), else 4.5. */
export const contrastNeed = (size, u = 1) => (size / (u || 1) >= 48 ? 3 : 4.5);
/** The theme key among candidates (default fg, bg) with the best contrast against a colour. */
export function bestOn(theme, against, keys = ['fg', 'bg']) {
  let best = keys[0], score = -1;
  for (const k of keys) { const r = contrastRatio(paint(theme, k), against); if (r > score) { score = r; best = k; } }
  return best;
}

/**
 * readableOn(theme, key, bgKey, size, {u=1, margin=0.3}) -> a colour for paint(): `key` when its WCAG contrast on
 * `bgKey` (a theme key or colour) clears AA for the size (4.5, or 3 at >= 48 px on a 1080 frame) plus `margin` for
 * anti-aliasing (lint's text QA measures real pixels); otherwise `key` mixed toward the theme's best text key on
 * that background just far enough to pass (theme.mix, an rgb() string). Colours stay theme-derived. u = F.u.
 */
export function readableOn(theme, key, bgKey, size, { u = 1, margin = 0.3 } = {}) {
  const bg = paint(theme, bgKey), need = contrastNeed(size, u) + margin;
  if (contrastRatio(paint(theme, key), bg) >= need) return key;
  const to = bestOn(theme, bg, ['fg', 'bg']);
  if (typeof theme.mix !== 'function') return to;
  for (let p = 0.05; p < 1; p += 0.05) {
    const c = theme.mix(key, to, p);
    if (contrastRatio(c, bg) >= need) return c;
  }
  return to;
}

/**
 * plateOn(theme, fillKey, size, {u=1}) -> {text, fill}: a filled plate (pill, chip) with text on it. The text takes
 * fg or bg, whichever reads better on the fill; when neither passes AA at this size, the FILL (not the text) moves
 * away from the text colour until it does.
 */
export function plateOn(theme, fillKey, size, { u = 1 } = {}) {
  const text = bestOn(theme, paint(theme, fillKey), ['fg', 'bg']);
  return { text, fill: readableOn(theme, fillKey, text, size, { u }) };
}

// ---------- fonts ----------
const roleOf = (theme, role) => {
  const r = theme.fonts[role];
  if (!r) throw new Error(`text: unknown font role "${role}" (use display or ui)`);
  return r;
};
export const firstFamily = (stack) => String(stack).split(',')[0].trim();
export const fontString = (theme, role, size, weight) => {
  const r = roleOf(theme, role);
  return `${weight || r.weight} ${Math.max(0.5, size).toFixed(2)}px ${r.family}`;
};

/** {display, ui}: true when the FIRST family of each stack renders (width differs from fallback). */
export function probeFonts(ctx, theme) {
  const probe = (f) => { ctx.font = f; return ctx.measureText('MAKE IT MOVE 0123 abcxyz').width; };
  const ok = (role) => {
    const r = roleOf(theme, role), fam = firstFamily(r.family);
    return ['monospace', 'serif'].some((fb) => probe(`${r.weight} 100px ${fam}, ${fb}`) !== probe(`${r.weight} 100px ${fb}`));
  };
  return { display: ok('display'), ui: ok('ui') };
}

export function setFont(ctx, theme, role, size, weight) {
  ctx.font = fontString(theme, role, size, weight);
  ctx.letterSpacing = `${(roleOf(theme, role).tracking || 0) * size}px`;
}

const capMemo = new Map();
/** {w, cap, asc, desc}: w excludes the trailing letter-spacing. */
export function measure(ctx, theme, role, str, size, weight) {
  setFont(ctx, theme, role, size, weight);
  const m = ctx.measureText(str);
  const trail = str.length ? (roleOf(theme, role).tracking || 0) * size : 0;
  const key = fontString(theme, role, 100, weight);
  if (!capMemo.has(key)) {
    setFont(ctx, theme, role, 100, weight);
    const h = ctx.measureText('H').actualBoundingBoxAscent;
    capMemo.set(key, Number.isFinite(h) && h > 0 ? h / 100 : 0.7);
    setFont(ctx, theme, role, size, weight);
  }
  const asc = Number.isFinite(m.actualBoundingBoxAscent) ? m.actualBoundingBoxAscent : 0.8 * size;
  const desc = Number.isFinite(m.actualBoundingBoxDescent) ? m.actualBoundingBoxDescent : 0.2 * size;
  return { w: m.width - trail, cap: capMemo.get(key) * size, asc, desc };
}

/** Readable minimum font size for phone viewing (the lint warning threshold) times k. */
export const readable = (F, k = 1) => Math.ceil((F.orient === 'v' ? 0.028 : 0.035) * F.h * k);

// ---------- wrapping and fitting ----------
/** Greedy word wrap; '\n' forces a break. Only a single unbreakable word may exceed width. */
export function wrapText(ctx, theme, str, { role = 'ui', size, width, weight }) {
  const out = [];
  for (const para of String(str).split('\n')) {
    let line = '';
    for (const word of para.split(/\s+/).filter(Boolean)) {
      const next = line ? `${line} ${word}` : word;
      if (line && measure(ctx, theme, role, next, size, weight).w > width) { out.push(line); line = word; }
      else line = next;
    }
    out.push(line);
  }
  return out;
}

function layoutAt(ctx, theme, str, o, size) {
  const lines = o.lines === 'auto' ? wrapText(ctx, theme, str, { role: o.role, size, width: o.box.w, weight: o.weight })
    : String(str).split('\n');
  const widths = lines.map((l) => measure(ctx, theme, o.role, l, size, o.weight).w);
  const cap = measure(ctx, theme, o.role, 'H', size, o.weight).cap;
  const lh = size * o.leading;
  const h = cap + (lines.length - 1) * lh;
  const fits = Math.max(...widths) <= o.box.w + 0.01 && h <= o.box.h + 0.01;
  return { lines, widths, cap, lh, h, fits };
}

/**
 * fitText(ctx, theme, str, {role, box, max, min, lines:1|'auto', leading, align, valign})
 *  -> {size, cap, lines:[{s, x (left edge), y (baseline), w}], overflow, box, role}
 */
export function fitText(ctx, theme, str, opts) {
  const o = { role: 'display', lines: 1, leading: 1.0, align: 'l', valign: 't', weight: undefined, ...opts };
  if (!o.box) throw new Error('text: fitText needs a box');
  const max = o.max || o.box.h, min = o.min || Math.min(max, 8);
  let lo = min, hi = max, best = null;
  const top = layoutAt(ctx, theme, str, o, max);
  if (top.fits) best = { size: max, L: top };
  else {
    for (let i = 0; i < 24 && hi - lo > 0.25; i++) {
      const mid = (lo + hi) / 2, L = layoutAt(ctx, theme, str, o, mid);
      if (L.fits) { best = { size: mid, L }; lo = mid; } else hi = mid;
    }
  }
  let overflow = false;
  if (!best) { best = { size: min, L: layoutAt(ctx, theme, str, o, min) }; overflow = !best.L.fits; }
  if (overflow) logOverflow(String(str), best.size, min);
  const { size, L } = best;
  const y0 = o.valign === 'c' ? o.box.y + (o.box.h - L.h) / 2 : o.valign === 'b' ? o.box.y + o.box.h - L.h : o.box.y;
  const lines = L.lines.map((s, i) => {
    const w = L.widths[i];
    const x = o.align === 'c' ? o.box.x + (o.box.w - w) / 2 : o.align === 'r' ? o.box.x + o.box.w - w : o.box.x;
    return { s, x, y: y0 + L.cap + i * L.lh, w };
  });
  const bx = Math.min(...lines.map((l) => l.x)), bw = Math.max(...lines.map((l) => l.x + l.w)) - bx;
  return Object.freeze({ size, cap: L.cap, lh: L.lh, lines, overflow, role: o.role, weight: o.weight,
    box: { x: bx, y: y0, w: bw, h: L.h } });
}

/** fitText without logging an overflow: for trying a layout at build time. Same result shape. */
export const tryFit = (ctx, theme, str, opts) => quiet(() => fitText(ctx, theme, str, opts));

// ---------- drawing ----------
/** Resolve a colour argument: a theme key, or an rgb()/rgba() string from theme.mix. Never a hex literal. */
export function paint(theme, c) {
  if (theme.colors[c]) return theme.colors[c];
  if (c === 'accent2' && theme.accent2) return theme.accent2;
  if (typeof c === 'string' && /^rgba?\(/.test(c)) return c;
  throw new Error(`text: colour "${c}" is not a theme key (fg, bg, accent, muted, surface)`);
}

const anchorLeft = (x, w, align) => (align === 'c' ? x - w / 2 : align === 'r' ? x - w : x);

/**
 * Draw str with its baseline at (x, y). align picks the anchor. sx/sy scale about the anchor.
 * rest: [x, y] (same coordinates as x, y; unscaled) logs the box where the text comes to rest instead of
 * where it is now, for text that slides or rises into place (lint then checks the slot, not the flight).
 */
export function drawText(ctx, theme, str, x, y, o = {}) {
  const { role = 'ui', size, color = 'fg', align = 'l', sx = 1, sy = 1, bleed = false, weight, log = true, rest } = o;
  const m = measure(ctx, theme, role, str, size, weight);
  const left = anchorLeft(x, m.w, align);
  ctx.save();
  ctx.translate(x, y); ctx.scale(sx, sy); ctx.translate(left - x, 0);
  setFont(ctx, theme, role, size, weight);
  const fill = paint(theme, color);
  ctx.fillStyle = fill; ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic';
  // the log entry these glyphs belong to: drawText's own, or o.inkOf (a slot logged separately, e.g. kinetic units)
  const logIdx = Number.isInteger(o.inkOf) && o.inkOf >= 0 ? o.inkOf : log && !QUIET ? LOG.texts.length : -2;
  if (logIdx >= 0) LOG.painted.add(logIdx);
  if (INK && logIdx !== INK_SKIP) ctx.fillText(str, 0, 0);
  if (log && !rest) logText(ctx, str, { x: 0, y: -m.cap, w: m.w, h: m.cap }, size, role, bleed, { color: fill });
  ctx.restore();
  if (log && rest) logText(ctx, str, { x: anchorLeft(rest[0], m.w, align), y: rest[1] - m.cap, w: m.w, h: m.cap }, size, role, bleed, { color: fill, rest: true });
  return m;
}

/** Log a text's resting box without drawing it (same anchor rules as drawText). */
export function logRest(ctx, theme, str, x, y, { role = 'ui', size, align = 'l', bleed = false, weight, color } = {}) {
  const m = measure(ctx, theme, role, str, size, weight);
  logText(ctx, str, { x: anchorLeft(x, m.w, align), y: y - m.cap, w: m.w, h: m.cap }, size, role, bleed,
    { color: color ? paint(theme, color) : undefined, rest: true });
  return m;
}

/** Draw a fitText result statically. */
export function drawFit(ctx, theme, fit, { color = 'fg', bleed = false } = {}) {
  if (fit.overflow) logOverflow(fit.lines.map((l) => l.s).join(' '), fit.size, fit.size);
  for (const l of fit.lines) drawText(ctx, theme, l.s, l.x, l.y, { role: fit.role, size: fit.size, color, bleed, weight: fit.weight });
}

function unitsOf(ctx, theme, fit, by) {
  const units = [];
  fit.lines.forEach((l, li) => {
    if (by === 'line') { units.push({ s: l.s, x: l.x, y: l.y, w: l.w, li }); return; }
    const parts = by === 'char' ? [...l.s] : l.s.split(/(\s+)/);
    let acc = '';
    for (const part of parts) {
      // In the drawn line every glyph (the space included) carries trailing letter-spacing; measure() drops the last one.
      const x = l.x + (acc ? measure(ctx, theme, fit.role, acc, fit.size, fit.weight).w + (theme.fonts[fit.role].tracking || 0) * fit.size : 0);
      acc += part;
      if (part.trim()) units.push({ s: part, x, y: l.y, w: measure(ctx, theme, fit.role, part, fit.size, fit.weight).w, li });
    }
  });
  return units;
}

/**
 * kinetic(f, fit, {by:'line'|'word'|'char', at, stagger (beats), from:'below'|'mask'|'drop'|'scale', spring, color, accent:[unit idx]})
 * Units enter one after another; nothing fades. Logged boxes are each unit's resting slot.
 */
export function kinetic(f, fit, o = {}) {
  const { by = 'word', at = 0, stagger = 0.25, from = 'mask', spring = 'med', color = 'fg', accent = [], accentColor = 'accent', bleed = false } = o;
  const { ctx, theme } = f;
  const units = unitsOf(ctx, theme, fit, by);
  const t0 = f.since(at), spb = f.grid.spb;
  if (fit.overflow) logOverflow(fit.lines.map((l) => l.s).join(' '), fit.size, fit.size);
  units.forEach((u, i) => {
    const dt = t0 - i * stagger * spb;
    if (dt <= 0) return;
    const col = accent.includes(i) ? accentColor : color;
    const slot = { x: u.x, y: u.y - fit.cap, w: u.w, h: fit.cap };
    const li = logText(ctx, u.s, slot, fit.size, fit.role, bleed, { color: paint(theme, col), rest: true });
    const opt = { role: fit.role, size: fit.size, color: col, weight: fit.weight, log: false, inkOf: li };
    if (from === 'mask') {
      const p = sp(dt, spring);
      ctx.save(); ctx.beginPath();
      ctx.rect(u.x - fit.size, u.y - fit.cap - fit.size * 0.3, u.w + fit.size * 2, fit.cap + fit.size * 0.62); ctx.clip();
      drawText(ctx, theme, u.s, u.x, u.y + (1 - p) * fit.size * 1.05, opt);
      ctx.restore();
    } else if (from === 'below') {
      drawText(ctx, theme, u.s, u.x, u.y + (1 - sp(dt, spring)) * fit.cap * 0.9, opt);
    } else if (from === 'drop') {
      const d = dropM(dt, Array.isArray(spring) || spring !== 'med' ? spring : 'soft');
      ctx.save(); ctx.translate(u.x + u.w / 2, u.y);
      ctx.scale(1 + d.sq * 0.6, 1 - d.sq * 0.9);
      drawText(ctx, theme, u.s, 0, -(1 - d.p) * fit.cap * 2.2, { ...opt, align: 'c' });
      ctx.restore();
    } else if (from === 'scale') {
      const p = Math.max(0, sp(dt, spring));
      ctx.save(); ctx.translate(u.x + u.w / 2, u.y - fit.cap / 2); ctx.scale(p, p);
      drawText(ctx, theme, u.s, 0, fit.cap / 2, { ...opt, align: 'c' });
      ctx.restore();
    } else throw new Error(`text: kinetic from "${from}" is not supported (no fades: use below, mask, drop or scale)`);
  });
  return units.length;
}

/** The units kinetic() would animate (for planning events and sfx at build time). */
export const kineticUnits = (ctx, theme, fit, by) => unitsOf(ctx, theme, fit, by);

// ---------- numbers ----------
const NUM = { locale: 'en-US', currency: 'USD' };
/**
 * setNumberFormat({locale, currency}): the defaults counterText (and every chart/block that formats numbers)
 * uses. Boot sets it from content.locale / content.currency when they are strings; a template may call it in build().
 */
export function setNumberFormat({ locale, currency } = {}) {
  if (locale !== undefined) {
    try { new Intl.NumberFormat(locale); } catch { throw new Error(`text: bad locale ${JSON.stringify(locale)}`); }
    NUM.locale = locale;
  }
  if (currency !== undefined) {
    if (!/^[A-Z]{3}$/.test(String(currency))) throw new Error(`text: currency must be an ISO 4217 code like "EUR" (got ${JSON.stringify(currency)})`);
    NUM.currency = currency;
  }
  return { ...NUM };
}
export const numberFormat = () => ({ ...NUM });

/**
 * counterText(value, p, {from, fmt, decimals, locale, currency, prefix, suffix})
 * fmt: 'int' | 'pct' | 'money' | 'k' | 'x' | 'compact' (1.2K, 3,4 Mio.) | 'currency' (locale currency, e.g. 1.234 €).
 * 'money' without a currency keeps the legacy "$1,234"; with {currency} it formats like 'currency'.
 */
export function counterText(value, p, o = {}) {
  const { from = 0, fmt = 'int', decimals = 0, locale = NUM.locale, prefix = '', suffix = '' } = o;
  const v = from + (value - from) * Math.min(1, Math.max(0, p));
  const num = (x, d) => x.toLocaleString(locale, { minimumFractionDigits: d, maximumFractionDigits: d });
  const cur = (x, code) => new Intl.NumberFormat(locale, { style: 'currency', currency: code, minimumFractionDigits: decimals, maximumFractionDigits: decimals }).format(x);
  let body;
  if (fmt === 'int') body = num(Math.round(v * 10 ** decimals) / 10 ** decimals, decimals);
  // the locale's percent sign and spacing: 42.5% (en-US), 42,5 % (de-DE)
  else if (fmt === 'pct') body = new Intl.NumberFormat(locale, { style: 'percent', minimumFractionDigits: decimals, maximumFractionDigits: decimals }).format(v / 100);
  else if (fmt === 'money') body = o.currency ? cur(v, o.currency) : `${prefix ? '' : '$'}${num(v, decimals)}`;
  else if (fmt === 'currency') body = cur(v, o.currency || NUM.currency);
  else if (fmt === 'compact') body = new Intl.NumberFormat(locale, { notation: 'compact', minimumFractionDigits: decimals, maximumFractionDigits: decimals }).format(v);
  else if (fmt === 'k') body = `${num(v / 1000, decimals)}k`;
  else if (fmt === 'x') body = `${num(v, decimals)}×`;
  else throw new Error(`text: counter fmt "${fmt}" is not supported`);
  return `${prefix}${body}${suffix}`;
}
