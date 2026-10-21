// lib.js: data-story helpers local to this template: springs, locale number formatting, the per-shot claim block,
// the camera (geometry zooms, labels stay screen-space and readable) and the hand-off rect carried across cuts.
// Pure functions of build-time layout and f; no state between frames.

/** Critically damped: type never overshoots. */
export const TYPE = [0.32, 1];
/** Lightly underdamped (about 1% overshoot): UI shapes, chips, bars, rows. */
export const UI = [0.28, 0.81];
/** Critically damped spring that is ~99% settled after `sec` seconds (counts, draw-ons, value tweens). */
export const smooth = (sec) => [(2 * Math.PI * Math.max(0.05, sec)) / 7, 1];

export const FMTS = ['int', 'pct', 'money', 'compact', 'x'];

/** Number options shared by every point: {fmt, decimals, unit, prefix, currency}. */
export const numOpts = (o = {}) => ({ fmt: o.fmt || 'int', decimals: o.decimals ?? 0, unit: o.unit || '', prefix: o.prefix || '', currency: o.currency || 'USD' });

/** Validate the locale once; Intl throws a RangeError on a malformed tag. */
export function checkLocale(locale) {
  try { return Intl.NumberFormat.supportedLocalesOf([locale])[0] || locale; }
  catch (e) { throw new Error(`content.locale: "${locale}" is not a valid BCP 47 locale (${e.message})`); }
}

/** makeFmt(locale) -> fmt(value, {fmt, decimals, unit, prefix, currency}) using Intl grouping and decimals. */
export function makeFmt(locale) {
  return (v, o = {}) => {
    const d = o.decimals ?? 0, base = { minimumFractionDigits: d, maximumFractionDigits: d };
    const kind = o.fmt || 'int';
    let s;
    if (kind === 'pct') s = (v / 100).toLocaleString(locale, { ...base, style: 'percent' });
    else if (kind === 'money') s = v.toLocaleString(locale, { ...base, style: 'currency', currency: o.currency || 'USD' });
    else if (kind === 'compact') s = v.toLocaleString(locale, { ...base, notation: 'compact' });
    else if (kind === 'x') s = `${v.toLocaleString(locale, base)}×`;
    else s = v.toLocaleString(locale, base);
    return `${o.prefix || ''}${s}${o.unit || ''}`;
  };
}

const norm = (s) => String(s).toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '');

/** Unit indices of a fit whose word matches `word` (for kinetic accent). */
export function accentUnits(api, fit, word) {
  if (!word) return [];
  const units = api.T.kineticUnits(api.ctx, api.theme, fit, 'word');
  const w = norm(word);
  return units.map((u, i) => (norm(u.s) === w ? i : -1)).filter((i) => i >= 0);
}

/**
 * fitText with a rag rule: once fitText picks a size, the box is narrowed (binary search, same size and
 * line count) until the lines balance, and a single-word last line (a widow) is rebalanced away when a
 * narrower box can do it without adding a line.
 */
export function balancedFit(api, str, opts) {
  const { ctx, theme, T } = api;
  const fit = T.fitText(ctx, theme, str, opts);
  const n = fit.lines.length;
  if (n < 2 || fit.overflow) return fit;
  const wrap = (w) => T.wrapText(ctx, theme, str, { role: opts.role || 'display', size: fit.size, width: w, weight: opts.weight });
  const widow = (lines) => lines[lines.length - 1].trim().split(/\s+/).length < 2;
  const ok = (w) => wrap(w).length === n;
  let lo = opts.box.w * 0.4, hi = opts.box.w;
  for (let i = 0; i < 18; i++) { const m = (lo + hi) / 2; if (ok(m)) hi = m; else lo = m; }
  let w = hi + 1;
  for (let k = 0; k < 12 && widow(wrap(w)) && w < opts.box.w; k++) w = Math.min(opts.box.w, w * 1.06);
  if (wrap(w).length !== n) w = opts.box.w;
  const box = opts.align === 'r' ? { ...opts.box, x: opts.box.x + opts.box.w - w, w } : { ...opts.box, w };
  return T.fitText(ctx, theme, str, { ...opts, max: fit.size, min: fit.size, box });
}

/**
 * The claim of one shot. Every shot sets it at its own position and scale (the shots do not share a header):
 * `box`, `scale` (x readable), `valign`, `align`. The accent word is set in the accent and underlined.
 * `at` (local beats) is when it lands: shots entered by a hand-off morph set it one beat in, after the carried mark
 * has settled, so the moving mark never crosses a headline. -16 = composed on the cut.
 */
export function claimBlock(api, pt, box, { scale = 2.3, valign = 'b', align = 'l', min = 1.15, at = -16 } = {}) {
  const { F, ctx, theme, T, D, M } = api;
  const fit = balancedFit(api, pt.claim, { role: 'display', box, lines: 'auto', leading: 1.0, align,
    max: T.readable(F, scale), min: T.readable(F, Math.min(min, scale)), valign });
  const accent = accentUnits(api, fit, pt.accent);
  const u = accent.length ? T.kineticUnits(ctx, theme, fit, 'word')[accent[0]] : null;
  const th = Math.max(6 * F.u, fit.size * 0.07);
  const under = u ? { x: u.x, y: u.y + fit.size * 0.13, w: u.w, h: th } : null;
  return { fit, box: fit.box, draw(f) {
    T.kinetic(f, fit, { by: 'word', at, stagger: at > -1 ? 0.08 : 0, from: 'mask', spring: TYPE, accent });
    if (under && f.since(at + 0.25) > 0) D.fillBox(ctx, { ...under, w: under.w * M.clamp(M.sp(f.since(at + 0.25), UI)) }, 'accent');
  } };
}

/**
 * Camera: geometry under it zooms by z = 1 + (Z - 1)·a about `focus`, which travels to `target` as a goes 0 -> 1.
 * At a = 0 it is the identity. Labels are never drawn under it: they are placed at cam.pt(...) in screen space,
 * at their readable size, so lint and text QA see real boxes inside the safe area.
 */
export function camera(focus, target, a, Z) {
  const z = 1 + (Z - 1) * a, cx = focus[0] + (target[0] - focus[0]) * a, cy = focus[1] + (target[1] - focus[1]) * a;
  const pt = (x, y) => [cx + (x - focus[0]) * z, cy + (y - focus[1]) * z];
  return { z, a, pt,
    rect: (r) => { const [x, y] = pt(r.x, r.y); return { ...r, x, y, w: r.w * z, h: r.h * z }; },
    apply(ctx) { ctx.translate(cx, cy); ctx.scale(z, z); ctx.translate(-focus[0], -focus[1]); } };
}

/** 0 -> 1 -> 0: in from `inAt`, back out from `outAt` (local beats), each a spring of `sec` seconds. */
export const pushPull = (f, M, inAt, outAt, sec) => M.clamp(M.sp(f.since(inAt), smooth(sec))) - M.clamp(M.sp(f.since(outAt), smooth(sec)));

/**
 * Hand-off shapes: what a cut carries. Each is the real data mark of a shot, and the incoming shot draws it itself
 * (never an overlay on top of a finished scene):
 *   {kind:'rect', x, y, w, h}                 a bar (axis-aligned)
 *   {kind:'disc', cx, cy, r}                  a pen tip / end dot
 *   {kind:'sector', cx, cy, r0, r1, a0, a1}   a clock wedge (angles in radians, a0 < a1)
 * shapePoly() samples every kind as the same number of perimeter points in the same order (start = the bar's
 * top-left / the wedge's inner start corner / the disc's upper-left, clockwise), so morphShape() is a point-wise lerp:
 * a dot stretches into a track, a straight track bends into a wedge, a wedge flattens into an underline.
 */
const SIDE = 24;
export function shapePoly(s) {
  const out = [];
  const lerp2 = (p, q, u) => [p[0] + (q[0] - p[0]) * u, p[1] + (q[1] - p[1]) * u];
  const side = (fn) => { for (let i = 0; i < SIDE; i++) out.push(fn(i / SIDE)); };
  if (s.kind === 'rect') {
    const A = [s.x, s.y], B = [s.x + s.w, s.y], C = [s.x + s.w, s.y + s.h], Dd = [s.x, s.y + s.h];
    side((u) => lerp2(A, B, u)); side((u) => lerp2(B, C, u)); side((u) => lerp2(C, Dd, u)); side((u) => lerp2(Dd, A, u));
  } else if (s.kind === 'sector') {
    const P = (r, a) => [s.cx + Math.cos(a) * r, s.cy + Math.sin(a) * r];
    // bar top edge (left->right) = ray at a0 (r0->r1); right edge = outer arc a0->a1; bottom = ray at a1 back; left = inner arc back
    side((u) => P(s.r0 + (s.r1 - s.r0) * u, s.a0)); side((u) => P(s.r1, s.a0 + (s.a1 - s.a0) * u));
    side((u) => P(s.r1 - (s.r1 - s.r0) * u, s.a1)); side((u) => P(s.r0, s.a1 - (s.a1 - s.a0) * u));
  } else {
    for (let i = 0; i < SIDE * 4; i++) { const a = -0.75 * Math.PI + (i / (SIDE * 4)) * Math.PI * 2; out.push([s.cx + Math.cos(a) * s.r, s.cy + Math.sin(a) * s.r]); }
  }
  return out;
}
/**
 * Point-wise lerp of two shapes' polygons (p in 0..1). A dot becoming a bar is two-phase instead: the dot travels to
 * the bar's head (first half), then the bar unrolls behind the head to its foot (second half), so no mid-state is a
 * floating segment. A bar taller than wide is vertical (head on top, foot at the bottom); otherwise head on the right.
 */
export function morphShape(a, b, p) {
  if (a.kind === 'disc' && b.kind === 'rect') {
    const vert = b.h > b.w, th = vert ? b.w : b.h, e = (u) => u * u * (3 - 2 * u);
    const head = vert ? [b.x + b.w / 2, b.y + th / 2] : [b.x + b.w - th / 2, b.y + b.h / 2];
    if (p < 0.5) {
      const u = e(p / 0.5);
      return shapePoly({ kind: 'disc', cx: a.cx + (head[0] - a.cx) * u, cy: a.cy + (head[1] - a.cy) * u, r: a.r + (th / 2 - a.r) * u });
    }
    const u = e((p - 0.5) / 0.5);
    return shapePoly(vert ? { kind: 'rect', x: b.x, y: b.y, w: b.w, h: th + (b.h - th) * u }
      : { kind: 'rect', x: b.x + b.w - th - (b.w - th) * u, y: b.y, w: th + (b.w - th) * u, h: b.h });
  }
  const A = shapePoly(a), B = shapePoly(b);
  return A.map((q, i) => [q[0] + (B[i][0] - q[0]) * p, q[1] + (B[i][1] - q[1]) * p]);
}
/** Bounding box of a polygon (for the hand-off occlusion check). */
export const polyBox = (pts) => { const xs = pts.map((q) => q[0]), ys = pts.map((q) => q[1]); const x = Math.min(...xs), y = Math.min(...ys); return { x, y, w: Math.max(...xs) - x, h: Math.max(...ys) - y }; };
/** Fill a shape (or a polygon) and log its box as a 'handoff' mark so check.mjs can test it against text boxes. */
export function drawShape(api, s, color, log = false) {
  const pts = Array.isArray(s) ? s : shapePoly(s);
  api.D.fillPoly(api.ctx, pts, color);
  if (log) api.T.logMedia(api.ctx, polyBox(pts), 'handoff');
}

/** An accent pill that scales up from its left-centre, box and label together (never an empty box, never clipped text). */
export function pill(api, f, box, txt, size, at, { fill = 'accent', ink = 'bg' } = {}) {
  const { ctx, theme, T, M, D } = api;
  const dt = f.since(at);
  if (dt <= 0) return;
  const g = M.clamp(M.sp(dt, UI), 0, 1.03), ox = box.x, oy = box.y + box.h / 2;
  ctx.save(); ctx.translate(ox, oy); ctx.scale(g, g); ctx.translate(-ox, -oy);
  D.fillBox(ctx, box, fill, box.h / 2);
  T.drawText(ctx, theme, txt, box.x + box.h * 0.5, box.y + box.h / 2 + size * 0.36, { role: 'ui', size, weight: 700, color: ink, log: false });
  ctx.restore();
  T.logText(ctx, txt, { x: box.x + box.h * 0.5, y: box.y + box.h / 2 - size * 0.36, w: box.w - box.h, h: size * 0.72 }, size, 'ui');
}
/** Pill box for a label at `size`, left edge x, vertical centre cy. */
export const pillBox = (api, txt, size, x, cy) => { const h = size * 2.1; return { x, y: cy - h / 2, w: api.T.measure(api.ctx, api.theme, 'ui', txt, size, 700).w + h, h }; };

/**
 * A number that counts from spec.from to spec.value on a critically damped spring, lands on the beat,
 * turns accent and gets underlined. -> {ft, land, draw(f)}
 */
export function bigNumber(api, spec, box, fmt, { at = 0.25, beats = 3, valign = 'c', min, max } = {}) {
  const { F, ctx, theme, T, M, D } = api;
  const from = spec.from ?? 0;
  const ft = T.fitText(ctx, theme, fmt(spec.value, spec), { role: 'display', box, lines: 1, max: max || box.h * 1.5, min: min || T.readable(F, 2), valign });
  const spr = smooth(beats * api.grid.spb * 0.85);
  const land = at + beats;
  const ln = ft.lines[0];
  return { ft, land, draw(f) {
    const p = M.clamp(M.sp(f.since(at), spr));
    const lp = M.clamp(M.sp(f.since(land), UI));
    const enter = Math.max(0, at - 0.5), rise = M.sp(f.since(enter), TYPE);
    if (f.since(enter) <= 0) return;
    D.withClip(ctx, (c) => c.rect(F.full.x, ln.y - ft.cap - ft.size * 0.25, F.full.w, ft.cap + ft.size * 0.5), () =>
      T.drawText(ctx, theme, fmt(from + (spec.value - from) * p, spec), ln.x, ln.y + (1 - rise) * ft.size * 1.1,
        { role: 'display', size: ft.size, color: theme.mix('fg', 'accent', lp) }));
    if (f.since(land) > 0) D.line(ctx, [[ln.x, ln.y + ft.size * 0.12], [ln.x + ln.w, ln.y + ft.size * 0.12]],
      { color: 'accent', width: Math.max(6 * F.u, ft.size * 0.045), progress: M.clamp(M.sp(f.since(land), UI)), cap: 'butt' });
  } };
}

/** Count ticks every half beat between two local beats (quarter beats are tier 'busy'). */
export function countTicks(from, to) {
  const out = [];
  for (let b = from + 0.25; b < to - 1e-9; b += 0.25) out.push({ at: +b.toFixed(4), sfx: 'tick', gain_db: -16, ...(Math.abs((b * 2) % 1) < 1e-9 ? {} : { tier: 'busy' }) });
  return out;
}
