// captions.js: burned-in captions, drawn by the runtime after every persistent layer (owner: captions).
// Contract: a pure function of t. No state between frames (the layout memo is a pure cache), no globalAlpha fades
// (house rule), colours from theme keys, sizes from F / T.readable(F), every word drawn through T.drawText so lint
// checks safe area, size and contrast. The runtime calls drawCaptions only when resolved.captions.enabled is true.
//
// Look: the brand UI font on a solid plate, at most 2 lines per page, auto-wrapped, sitting in the bottom of the safe
// area (above the platform UI zones in 9x16/4x5; clear of the 9x16 action rail). The spoken word gets an accent pill
// that springs from the previous word; glyphs over the pill take the colour that reads best on the accent (clipped to
// the pill, so the colour follows the pill pixel for pixel), glyphs off it stay fg.
// Word times are estimated proportionally to characters within a segment; long segments page every 2 lines.
import { sp, clamp, lerp } from './motion.js';
import { parseAt } from './beat.js';

/** Caption styles: k = size over T.readable(F); plate = solid backing; weight = UI font weight (null = brand). */
export const CAPTION_STYLES = Object.freeze({
  clean: Object.freeze({ k: 1.15, plate: 'bg', weight: null, upper: false }),
  bold: Object.freeze({ k: 1.45, plate: 'bg', weight: 700, upper: true }),
  plain: Object.freeze({ k: 1.15, plate: null, weight: null, upper: false }),
});

/**
 * Per-format caption zone (canvas px): side margin and the bottom edge. 9x16 keeps clear of the right-hand action
 * rail and of the bottom 400 px of platform UI (the safe area's bottom); 4x5 keeps above the feed caption overlay.
 */
export function captionZone(F) {
  const s = F.safe;
  const side = F.fmt === '9x16' ? Math.max(s.x, 150 * F.u) : F.fmt === '16x9' ? Math.max(s.x, F.w * 0.15) : s.x;
  return Object.freeze({ x: side, w: F.w - 2 * side, bottom: s.y + s.h });
}

/**
 * captionTop(F, cfg) -> y (canvas px) of the top of the caption lane, or null when captions are off.
 * The lane is the tallest page the style can draw (2 lines at full size, plate padding) plus a half-line gap.
 * Templates keep bottom-anchored text above it (the runtime passes it as api.captionTop).
 */
export function captionTop(F, cfg) {
  if (!cfg || !cfg.enabled) return null;
  const style = styleOf(cfg);
  const size = Math.max(Math.ceil((F.orient === 'v' ? 0.028 : 0.035) * F.h), Math.round((F.orient === 'v' ? 0.028 : 0.035) * F.h * style.k));
  const lane = size * (0.75 + 1.22) + (0.42 + 0.5) * size + 0.5 * size;
  return Math.floor(captionZone(F).bottom - lane);
}

/** Character weight of a word for time estimation (a space counts as one character). */
const weightOf = (w) => [...w].length + 1;

/**
 * wordTimes(text, start, end) -> [{w, start, end}]: word times estimated proportionally to characters.
 */
export function wordTimes(text, start, end) {
  const words = String(text).split(/\s+/).filter(Boolean);
  const total = words.reduce((a, w) => a + weightOf(w), 0) || 1;
  let acc = 0;
  return words.map((w) => {
    const a = start + ((end - start) * acc) / total;
    acc += weightOf(w);
    return { w, start: a, end: start + ((end - start) * acc) / total };
  });
}

const checkSeg = (s, i) => {
  if (!s || typeof s.text !== 'string' || !s.text.trim()) throw new Error(`captions: segment ${i} needs non-empty text`);
  if (!Number.isFinite(s.start) || !Number.isFinite(s.end) || !(s.end > s.start)) throw new Error(`captions: segment ${i} ("${s.text}") needs start < end in seconds (got ${s.start}..${s.end})`);
};

/**
 * segmentsFromLines(lines, grid, duration) -> [{text, start, end}] (seconds)
 * Manual caption lines [{text, at, end?}] (time refs) to segments; a missing end runs to the next line's start
 * (or the film end). Lines must be in time order and inside the film.
 */
export function segmentsFromLines(lines, grid, duration) {
  if (!Array.isArray(lines)) throw new Error('captions: lines must be an array');
  const sec = (ref) => grid.beat(parseAt(ref, grid));
  const starts = lines.map((l, i) => {
    if (!l || typeof l.text !== 'string' || !l.text.trim()) throw new Error(`captions: lines[${i}] needs text`);
    if (l.at === undefined) throw new Error(`captions: lines[${i}] ("${l.text}") needs at`);
    return sec(l.at);
  });
  starts.forEach((st, i) => {
    if (i > 0 && st < starts[i - 1] - 1e-9) throw new Error(`captions: lines[${i}] ("${lines[i].text}") starts before lines[${i - 1}] (keep lines in time order)`);
  });
  return lines.map((l, i) => {
    const start = starts[i];
    const next = i + 1 < lines.length ? starts[i + 1] : duration;
    const end = l.end !== undefined ? sec(l.end) : next;
    if (start < -1e-9 || start >= duration - 1e-9) throw new Error(`captions: lines[${i}] ("${l.text}") at ${start.toFixed(3)}s is outside the film (0..${duration.toFixed(3)}s)`);
    const seg = { text: l.text.trim(), start: +start.toFixed(6), end: +Math.min(end, duration).toFixed(6) };
    checkSeg(seg, i);
    return seg;
  });
}

// ---------- layout (pure; memoized per segment list, frame and style) ----------
const MEMO = new WeakMap();

function measureWord(T, ctx, theme, s, size, weight) { return T.measure(ctx, theme, 'ui', s, size, weight || undefined).w; }

/** Greedy wrap of word objects into lines no wider than width; returns [[wordIdx...]]. */
function wrapWords(T, ctx, theme, words, size, weight, width) {
  const lines = [];
  let cur = [];
  for (let i = 0; i < words.length; i++) {
    const trial = [...cur, i].map((j) => words[j].w).join(' ');
    if (cur.length && measureWord(T, ctx, theme, trial, size, weight) > width) { lines.push(cur); cur = [i]; } else cur.push(i);
  }
  if (cur.length) lines.push(cur);
  return lines;
}

/**
 * layoutSegment(ctx, api, seg) -> {size, pages:[{start, end, lines:[{words:[{w, x, y, width, start, end}]}], plate}]}
 * Size starts at style.k x readable(F) and shrinks (not below readable(F)) until the longest word fits the zone.
 */
export function layoutSegment(ctx, api, seg) {
  const { F, theme, T } = api;
  const style = styleOf(api.captions);
  const zone = captionZone(F);
  const padX = 0.45, padTop = 0.42, padBot = 0.5;
  const text = style.upper ? seg.text.toUpperCase() : seg.text;
  const words = wordTimes(text, seg.start, seg.end);
  const min = T.readable(F);
  let size = Math.max(min, Math.round(T.readable(F, style.k)));
  const inner = (sz) => zone.w - 2 * padX * sz;
  while (size > min && Math.max(...words.map((w) => measureWord(T, ctx, theme, w.w, size, style.weight))) > inner(size)) size = Math.max(min, size - 2);
  const lines = wrapWords(T, ctx, theme, words, size, style.weight, inner(size));
  const cap = T.measure(ctx, theme, 'ui', 'H', size, style.weight || undefined).cap;
  const lh = size * 1.22, tracking = (theme.fonts.ui.tracking || 0) * size;
  const pages = [];
  for (let p = 0; p < lines.length; p += 2) {
    const group = lines.slice(p, p + 2);
    const blockH = cap + (group.length - 1) * lh;
    const bottom = zone.bottom - padBot * size;
    const y0 = bottom - blockH + cap; // first baseline
    let maxW = 0;
    const out = group.map((idxs, li) => {
      const lineStr = idxs.map((j) => words[j].w).join(' ');
      const lw = measureWord(T, ctx, theme, lineStr, size, style.weight);
      maxW = Math.max(maxW, lw);
      const x0 = zone.x + (zone.w - lw) / 2;
      let acc = '';
      return { words: idxs.map((j) => {
        const x = x0 + (acc ? measureWord(T, ctx, theme, `${acc} `, size, style.weight) + tracking : 0);
        acc = acc ? `${acc} ${words[j].w}` : words[j].w;
        return Object.freeze({ ...words[j], i: j, x, y: y0 + li * lh, width: measureWord(T, ctx, theme, words[j].w, size, style.weight) });
      }) };
    });
    const first = out[0].words[0], lastLine = out[out.length - 1].words, last = lastLine[lastLine.length - 1];
    const pw = maxW + 2 * padX * size;
    pages.push(Object.freeze({ start: first.start, end: last.end, lines: out,
      plate: Object.freeze({ x: zone.x + (zone.w - pw) / 2, y: y0 - cap - padTop * size, w: pw, h: blockH + (padTop + padBot) * size }) }));
  }
  return Object.freeze({ size, cap, pages, style });
}

function styleOf(cfg) {
  const id = (cfg && cfg.style) || 'clean';
  const s = CAPTION_STYLES[id];
  if (!s) throw new Error(`captions: unknown style "${id}" (use ${Object.keys(CAPTION_STYLES).join(', ')})`);
  return s;
}

function layoutsFor(ctx, api) {
  let byKey = MEMO.get(api.segments);
  if (!byKey) { byKey = new Map(); MEMO.set(api.segments, byKey); }
  const key = `${api.F.fmt}|${(api.captions && api.captions.style) || 'clean'}|${api.theme.fonts.ui.family}|${api.segments.length}`;
  if (!byKey.has(key)) {
    api.segments.forEach(checkSeg);
    byKey.set(key, api.T.quiet(() => api.segments.map((s) => layoutSegment(ctx, api, s))));
  }
  return byKey.get(key);
}

/** {seg, page, layout} visible at t, or null. A page holds until the next page (or 0.4 s after its segment ends). */
export function activePage(layouts, segments, t) {
  for (let i = segments.length - 1; i >= 0; i--) {
    const s = segments[i];
    if (t < s.start) continue;
    const next = i + 1 < segments.length ? segments[i + 1].start : Infinity;
    if (t >= Math.min(s.end + 0.4, next)) return null;
    const L = layouts[i];
    let page = L.pages[0];
    for (const p of L.pages) if (p.start <= t + 1e-9) page = p;
    return { seg: i, page, layout: L };
  }
  return null;
}

/**
 * drawCaptions(ctx, api, t) -> void
 * @param {CanvasRenderingContext2D} ctx  the film canvas (clean state; the runtime saves/restores around the call)
 * @param {{F, theme, T, grid, captions, segments}} api  segments: [{text, start, end}] seconds
 * @param {number} t  seconds
 */
export function drawCaptions(ctx, api, t) {
  const { theme, T } = api;
  if (!api.segments || !api.segments.length) return;
  const layouts = layoutsFor(ctx, api);
  const hit = activePage(layouts, api.segments, t);
  if (!hit) return;
  const { page, layout } = hit;
  const { size, cap, style } = layout;
  const words = page.lines.flatMap((l) => l.words);
  if (style.plate) {
    const b = page.plate;
    ctx.fillStyle = T.paint(theme, style.plate);
    ctx.beginPath(); ctx.roundRect(b.x, b.y, b.w, b.h, Math.min(size * 0.38, b.h / 2)); ctx.fill();
  }
  // Active word: the last word whose estimated start has passed (before the first word, none).
  let k = -1;
  for (let i = 0; i < words.length; i++) if (words[i].start <= t + 1e-9) k = i;
  const accent = T.paint(theme, 'accent');
  const onAccent = T.bestOn(theme, accent, ['fg', 'bg']);
  // Pill behind the word only when its text can meet WCAG AA on the accent; otherwise an accent bar under the word
  // (the text stays fg on the plate), so a brand accent never makes the spoken word unreadable.
  const pillMode = T.contrastRatio(T.paint(theme, onAccent), accent) >= T.contrastNeed(size, api.F.u);
  const pill = pillMode
    ? (w) => ({ x: w.x - 0.18 * size, y: w.y - cap - 0.2 * size, w: w.width + 0.36 * size, h: cap + 0.4 * size })
    : (w) => ({ x: w.x, y: w.y + 0.16 * size, w: w.width, h: 0.12 * size });
  let p = 1, pr = null;
  if (k >= 0) {
    const cur = words[k], prev = k > 0 ? words[k - 1] : null;
    p = sp(t - cur.start, 'snap');
    const a = pill(cur);
    let b = a;
    if (prev && prev.y === cur.y) {
      const from = pill(prev);
      b = { x: lerp(from.x, a.x, p), y: a.y, w: lerp(from.w, a.w, p), h: a.h };
    } else {
      const q = clamp(p, 0, 1.2);
      b = { x: a.x + (a.w * (1 - q)) / 2, y: a.y + (a.h * (1 - q)) / 2, w: a.w * q, h: a.h * q };
    }
    if (b.w > 0.5 && b.h > 0.5) {
      pr = { ...b, r: Math.min(size * 0.22, b.h / 2) };
      ctx.fillStyle = accent;
      ctx.beginPath(); ctx.roundRect(b.x, b.y, b.w, b.h, pr.r); ctx.fill();
    }
  }
  // Glyph colour follows the pixels behind it, not a timed fade: every word is drawn in fg, then, clipped to the
  // pill, again in the colour that reads on the accent. While the pill slides between words, the part of a word over
  // it is already in the on-accent colour and the part off it still fg, so no glyph ever sits fg-on-accent (or
  // half-mixed) for a frame. Each word is logged once, in the colour that covers most of it.
  const opts = { role: 'ui', size, weight: style.weight || undefined };
  const share = (w) => (pr && pillMode ? overlapShare({ x: w.x, y: w.y - cap, w: w.width, h: cap }, pr) : 0);
  const shares = words.map(share);
  words.forEach((w, i) => T.drawText(ctx, theme, w.w, w.x, w.y, { ...opts, color: 'fg', log: shares[i] <= 0.5 }));
  if (pr && pillMode && shares.some((x) => x > 0)) {
    ctx.save();
    ctx.beginPath(); ctx.roundRect(pr.x, pr.y, pr.w, pr.h, pr.r); ctx.clip();
    words.forEach((w, i) => { if (shares[i] > 0) T.drawText(ctx, theme, w.w, w.x, w.y, { ...opts, color: onAccent, log: shares[i] > 0.5 }); });
    ctx.restore();
  }
}

/** Share (0..1) of box a covered by box b. */
function overlapShare(a, b) {
  const w = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x), h = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y);
  return w > 0 && h > 0 && a.w > 0 && a.h > 0 ? (w * h) / (a.w * a.h) : 0;
}
