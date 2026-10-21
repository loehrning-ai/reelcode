// kit.js: shared pieces of the lower-third cards. A card is built once per format from G (the per-format kit) and
// drawn as a pure function of the scene frame f. Every text sits on an opaque plate, starts only once its plate is
// open, and stops logging the moment the plate starts to close (so lint's contrast check always reads the plate).
// Plates open with 'snap' (a broadcast overshoot) and close with 'stiff' (no bounce); type uses TYPE (no overshoot).
export const TYPE = [0.31, 1];
export const OPEN = 'snap';
export const CLOSE = 'stiff';

/** Per-format kit: sizes from T.readable(F), the plate inks by WCAG contrast, the card floor above the caption lane. */
export function makeKit(api) {
  const { F, T, M, D, theme, ctx, media } = api;
  const U = T.readable(F);
  const ink = media.inkFor(theme);
  const c = theme.colors, ratio = (a, b) => media.contrast(c[a], c[b]);
  // second tier (role / sub): surface plate with the main ink when it reads, else the main plate
  const tier = ratio('surface', ink.ink) >= 4.5 ? 'surface' : ink.plate;
  // accent chips: accent plate with whichever of fg/bg reads best on it; fg/bg inverted chip when neither reaches 4.5
  const onAccent = T.bestOn(theme, c.accent);
  const chip = ratio('accent', onAccent) >= 4.5 ? { plate: 'accent', ink: onAccent } : { plate: ink.ink, ink: ink.plate };
  const quoteMark = ratio('accent', ink.plate) >= 3 ? 'accent' : ink.ink;
  const rail = F.fmt === '9x16' ? Math.max(0, 150 * F.u - (F.w - F.safe.x - F.safe.w)) : 0;   // 9x16 action rail
  const floor = Number.isFinite(api.captionTop) ? Math.min(F.safe.y + F.safe.h, api.captionTop) : F.safe.y + F.safe.h;
  return Object.freeze({
    F, T, M, D, theme, ctx, U, ink, tier, chip, quoteMark, floor,
    left: F.safe.x, right: F.safe.x + F.safe.w - rail, top: F.safe.y,
    pad: Math.round(U * 0.45), bar: Math.max(6, Math.round(10 * F.u)), gap: Math.round(U * 0.2),
  });
}

/** fitText at the origin (wraps before it shrinks, never below U), then moved so its box starts at (x, y). */
export function fitAt(G, str, { role = 'display', size: size0, width, lines = 1, leading = 1.05, min, balance = lines > 1 }) {
  let size = size0;
  const opts = (w) => ({ role, box: { x: 0, y: 0, w, h: size * (1 + (lines - 1) * leading) + 0.5 }, max: size, min: min ?? G.U, lines: lines > 1 ? 'auto' : 1, leading });
  let ft = G.T.fitText(G.ctx, G.theme, str, opts(width));
  if (!balance || ft.lines.length < 2 || ft.overflow) return ft;
  // A one-word last line: accept up to 15 % less size if that saves the line.
  if (!/\s/.test(ft.lines[ft.lines.length - 1].s.trim())) {
    for (let k = 0.97; k >= 0.85; k -= 0.03) {
      const t = G.T.tryFit(G.ctx, G.theme, str, { ...opts(width), max: size * k, min: size * k });
      if (!t.overflow && t.lines.length < ft.lines.length && size * k >= (min ?? G.U)) { size *= k; ft = G.T.fitText(G.ctx, G.theme, str, opts(width)); break; }
    }
  }
  // Balanced rag: the narrowest width that keeps the same size and line count (no one-word last line).
  let lo = width * 0.4, hi = width;
  for (let i = 0; i < 14; i++) {
    const mid = (lo + hi) / 2, t = G.T.tryFit(G.ctx, G.theme, str, opts(mid));
    if (!t.overflow && t.size === ft.size && t.lines.length === ft.lines.length) hi = mid; else lo = mid;
  }
  return hi < width ? G.T.fitText(G.ctx, G.theme, str, opts(Math.ceil(hi) + 1)) : ft;
}

/**
 * slate(G, f): the review backdrop of a transparent render: a coarse muted/surface checkerboard (the editor's
 * transparency grid) so the opaque plates read in draft.mp4 and on the contact sheets. Not drawn in the alpha
 * export (?alpha=1, where the background is cleared) or when a demo clip sits behind the graphics.
 */
export function slate(G, f) {
  const n = 9, s = Math.ceil(Math.max(G.F.w, G.F.h) / n / 2) * 2;
  for (let y = 0; y * s < G.F.h; y++) for (let x = 0; x * s < G.F.w; x++) G.D.fillBox(f.ctx, { x: x * s, y: y * s, w: s, h: s }, (x + y) % 2 ? 'muted' : 'surface');
}
export const alphaRender = () => typeof location !== 'undefined' && new URLSearchParams(location.search).get('alpha') === '1';
export function shift(ft, x, y) {
  return Object.freeze({ ...ft, lines: ft.lines.map((l) => ({ ...l, x: l.x + x, y: l.y + y })), box: { ...ft.box, x: ft.box.x + x, y: ft.box.y + y } });
}
/** Height a fitted block needs inside a plate: its box plus the descender. */
export const inkH = (ft) => ft.box.h + ft.size * 0.24;

/**
 * life(f, at, out) -> 0..~1.05: the open state of a part that opens at local beat `at` (snap) and closes at `out`
 * (stiff, no bounce). undefined out = never closes.
 */
export function life(G, f, at, out) {
  const i = f.since(at);
  if (i <= 0) return 0;
  const a = Math.max(0, G.M.sp(i, OPEN));
  if (out === undefined) return a;
  const o = f.since(out);
  return o <= 0 ? a : a * (1 - G.M.clamp(G.M.sp(o, CLOSE)));
}
/** True while text may log as resting (it has started and its plate has not started to close). */
export const resting = (f, out) => out === undefined || f.since(out) <= 0;

/**
 * plate(G, box, p, from, color): an opaque rectangle opened to p from one edge ('l' grows rightwards, 'r' leftwards,
 * 'b' upwards, 't' downwards). Returns the drawn box (for clipping its text) or null when closed.
 */
export function plate(G, box, p, from, color) {
  if (!(p > 0.002)) return null;
  const q = Math.max(0, p);
  let b;
  if (from === 'l') b = { x: box.x, y: box.y, w: box.w * q, h: box.h };
  else if (from === 'r') b = { x: box.x + box.w * (1 - q), y: box.y, w: box.w * q, h: box.h };
  else if (from === 't') b = { x: box.x, y: box.y, w: box.w, h: box.h * q };
  else b = { x: box.x, y: box.y + box.h * (1 - q), w: box.w, h: box.h * q };
  G.D.fillBox(G.ctx, b, color);
  return b;
}

/**
 * words(G, f, ft, clip, {at, out, color, by, stagger}): kinetic type inside its plate. Before `out` the units mask up
 * (each logs its resting slot); after it they are drawn still and unlogged, cut by the closing plate.
 */
export function words(G, f, ft, clip, o) {
  if (!clip) return;
  const { ctx, theme, T } = G;
  ctx.save();
  ctx.beginPath(); ctx.rect(clip.x, clip.y, clip.w, clip.h); ctx.clip();
  if (resting(f, o.out)) T.kinetic(f, ft, { by: o.by || 'word', at: o.at, stagger: o.stagger ?? 0.125, from: 'mask', spring: TYPE, color: o.color });
  else for (const l of ft.lines) T.drawText(ctx, theme, l.s, l.x, l.y, { role: ft.role, size: ft.size, color: o.color, weight: ft.weight, log: false });
  ctx.restore();
}

/** A one-line chip (kicker / label / tag): fitted text plus its plate box at (x, y) top-left (or right-aligned). */
export function chipLayout(G, str, x, y, { align = 'l', size } = {}) {
  const s = size || G.U;
  const ft = fitAt(G, str, { role: 'ui', size: s, width: (G.right - G.left) * 0.9 });
  const w = Math.ceil(ft.box.w + G.pad * 1.6), h = Math.ceil(inkH(ft) + G.pad * 0.9);
  const bx = align === 'r' ? x - w : x;
  return Object.freeze({ ft: shift(ft, bx + G.pad * 0.8, y + G.pad * 0.45), box: { x: bx, y, w, h } });
}

/** Local-beat cue helpers (on the 1/16 grid, inside the scene). */
export const cue = (G, at, sfx, gain_db) => ({ at: G.M.quant(at), sfx, gain_db });
export const inScene = (nb) => (m) => (typeof m === 'number' ? m : m.at) >= 0 && (typeof m === 'number' ? m : m.at) < nb;
