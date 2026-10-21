// chart.js: data-driven charts. Every scale is computed from the data; nothing is hand-placed.
import { sp, clamp, easeInOutCubic } from './motion.js';
import { fitText, drawText, counterText, readable, measure, paint } from './text.js';
import { fillBox, line as strokeLine, disc } from './draw.js';

/** scaleLinear([d0, d1], [r0, r1]) -> fn(v); fn.invert(r) */
export function scaleLinear([d0, d1], [r0, r1]) {
  const k = d1 === d0 ? 0 : (r1 - r0) / (d1 - d0);
  const fn = (v) => r0 + (v - d0) * k;
  fn.invert = (r) => (k ? d0 + (r - r0) / k : d0);
  fn.domain = [d0, d1]; fn.range = [r0, r1];
  return fn;
}

/** scaleBand(keys, [r0, r1], pad) -> {pos(key|i) -> start, bw, step} */
export function scaleBand(keys, [r0, r1], pad = 0.2) {
  const n = Math.max(1, keys.length);
  const step = (r1 - r0) / (n + pad), bw = step * (1 - pad);
  const pos = (k) => { const i = typeof k === 'number' ? k : keys.indexOf(k); return r0 + step * pad + i * step; };
  return { pos, bw, step };
}

/** Round-number ticks covering [min, max]. */
export function niceTicks(min, max, n = 5) {
  if (min === max) { max = min + 1; }
  const raw = (max - min) / Math.max(1, n);
  const mag = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= raw) || 10 * mag;
  const lo = Math.floor(min / step) * step, hi = Math.ceil(max / step) * step;
  const out = [];
  for (let v = lo; v <= hi + step * 1e-9; v += step) out.push(Math.round(v / step) * step);
  return out;
}

const valueAxis = (box, axis) => (axis === 'x' || axis === 'y' ? axis : box.h >= box.w ? 'y' : 'x');
const isHi = (d, i, highlight) => highlight !== undefined && (highlight === i || highlight === d.label);
const fmtOf = (o) => ({ fmt: o.fmt || 'int', decimals: o.decimals || 0, suffix: o.unit || '', prefix: o.prefix || '',
  ...(o.locale ? { locale: o.locale } : {}), ...(o.currency ? { currency: o.currency } : {}) });

/**
 * bars(f, {data:[{label, value}], box, at, stagger, axis:'long'|'x'|'y', highlight, unit, fmt, decimals, locale, currency, spring})
 * Bars grow one after another on the beat stagger. Returns {rects, last} (last = beat the final bar starts).
 */
export function bars(f, o) {
  const { data, box, at = 0, stagger = 0.25, highlight, spring = 'med' } = o;
  const { ctx, theme, F } = f;
  const ax = valueAxis(box, o.axis || 'long');
  const L = Math.min(readable(F, 1.05), box[ax === 'y' ? 'w' : 'h'] / data.length * 0.42);
  const max = niceTicks(0, Math.max(...data.map((d) => d.value), 0), 4).slice(-1)[0];
  const t0 = f.since(at), spb = f.grid.spb, hasHi = highlight !== undefined;
  const rects = [];
  if (ax === 'y') {
    const plot = { x: box.x, y: box.y + L * 1.6, w: box.w, h: box.h - L * 3.4 };
    const band = scaleBand(data.map((d) => d.label), [plot.x, plot.x + plot.w], 0.28);
    const sy = scaleLinear([0, max], [0, plot.h]);
    data.forEach((d, i) => {
      const p = sp(t0 - i * stagger * spb, spring), x = band.pos(i), hgt = sy(d.value) * Math.max(0, p);
      const r = { x, y: plot.y + plot.h - hgt, w: band.bw, h: hgt };
      rects.push(r);
      const hi = isHi(d, i, highlight);
      const lab = fitText(ctx, theme, d.label, { role: 'ui', box: { x: x - band.step * 0.12, y: plot.y + plot.h + L * 0.5, w: band.step * 0.96, h: L }, max: L, min: L * 0.6, align: 'c' });
      drawText(ctx, theme, lab.lines[0].s, lab.lines[0].x, lab.lines[0].y, { role: 'ui', size: lab.size, color: hi ? 'fg' : 'muted' });
      if (p <= 0) return;
      fillBox(ctx, r, hi ? 'accent' : hasHi ? 'muted' : 'fg', Math.min(band.bw * 0.08, theme.radius * 0.3));
      drawText(ctx, theme, counterText(d.value, clamp(p), fmtOf(o)), x + band.bw / 2, r.y - L * 0.45, { role: 'ui', size: L, align: 'c', color: hi ? 'accent' : 'fg',
        rest: [x + band.bw / 2, plot.y + plot.h - sy(d.value) - L * 0.45] });
    });
  } else {
    const labW = Math.min(box.w * 0.34, Math.max(...data.map((d) => measure(ctx, theme, 'ui', d.label, L).w)) + L);
    const valW = measure(ctx, theme, 'ui', counterText(max, 1, fmtOf(o)), L).w + L * 0.6;
    const plot = { x: box.x + labW, y: box.y, w: box.w - labW - valW, h: box.h };
    const band = scaleBand(data.map((d) => d.label), [plot.y, plot.y + plot.h], 0.3);
    const sx = scaleLinear([0, max], [0, plot.w]);
    data.forEach((d, i) => {
      const p = sp(t0 - i * stagger * spb, spring), y = band.pos(i), wid = sx(d.value) * Math.max(0, p);
      const r = { x: plot.x, y, w: wid, h: band.bw };
      rects.push(r);
      const hi = isHi(d, i, highlight), base = y + band.bw / 2 + L * 0.36;
      const lab = fitText(ctx, theme, d.label, { role: 'ui', box: { x: box.x, y: base - L, w: labW - L * 0.5, h: L }, max: L, min: L * 0.6 });
      drawText(ctx, theme, lab.lines[0].s, box.x, base, { role: 'ui', size: lab.size, color: hi ? 'fg' : 'muted' });
      if (p <= 0) return;
      fillBox(ctx, r, hi ? 'accent' : hasHi ? 'muted' : 'fg', Math.min(band.bw * 0.12, theme.radius * 0.3));
      drawText(ctx, theme, counterText(d.value, clamp(p), fmtOf(o)), r.x + r.w + L * 0.4, base, { role: 'ui', size: L, color: hi ? 'accent' : 'fg',
        rest: [r.x + sx(d.value) + L * 0.4, base] });
    });
  }
  return { rects, last: at + stagger * (data.length - 1), axis: ax };
}

/** Draw-on progress 0..1 of a line chart at local seconds dt (easing over `beats`, or a spring). */
const lineProgress = (dt, beats, spb, spring) => (spring ? clamp(sp(dt, spring)) : easeInOutCubic(dt / (beats * spb)));

/**
 * line(f, {series:[[x, y]...], box, at, beats, highlight (index), color, unit, fmt, drawBy:'x'|'length', spring?})
 * The path draws on over `beats` (easeInOutCubic, or `spring` when given); a disc leads at the tip.
 * drawBy 'x' (default) advances the tip through the data's x domain, so the time the tip reaches a point is
 * the same in every format (lineReach() gives it); 'length' is the old arc-length draw (aspect dependent).
 * Returns {tip, p}.
 */
export function line(f, o) {
  const { series, box, at = 0, beats = 4, highlight, color = 'accent', drawBy = 'x', spring } = o;
  const { ctx, theme, F } = f;
  const L = readable(F, 1.0);
  const xs = series.map((s) => s[0]), ys = series.map((s) => s[1]);
  const ticks = niceTicks(Math.min(0, ...ys), Math.max(...ys), 3);
  const plot = { x: box.x, y: box.y + L * 1.8, w: box.w, h: box.h - L * 1.8 };
  const x0 = Math.min(...xs), x1 = Math.max(...xs);
  const sx = scaleLinear([x0, x1], [plot.x, plot.x + plot.w]);
  const sy = scaleLinear([ticks[0], ticks[ticks.length - 1]], [plot.y + plot.h, plot.y]);
  const grow = sp(f.since(at), 'stiff');
  for (const tv of ticks) {
    const y = sy(tv);
    fillBox(ctx, { x: plot.x, y: y - F.u, w: plot.w * clamp(grow), h: 2 * F.u }, 'surface');
  }
  const pts = series.map(([x, y]) => [sx(x), sy(y)]);
  const p = lineProgress(f.since(at), beats, f.grid.spb, spring);
  if (p <= 0) return { tip: pts[0], p };
  let tip;
  if (drawBy === 'length') tip = strokeLine(ctx, pts, { color, width: 7 * F.u, progress: p });
  else {
    const xt = x0 + (x1 - x0) * p, part = [pts[0]];
    for (let i = 1; i < series.length; i++) {
      if (series[i][0] <= xt) { part.push(pts[i]); continue; }
      const a = series[i - 1], b = series[i], q = b[0] === a[0] ? 1 : (xt - a[0]) / (b[0] - a[0]);
      part.push([sx(xt), sy(a[1] + (b[1] - a[1]) * q)]);
      break;
    }
    tip = part.length > 1 ? strokeLine(ctx, part, { color, width: 7 * F.u, progress: 1 }) : pts[0];
  }
  disc(ctx, tip[0], tip[1], 13 * F.u, color);
  if (highlight !== undefined && series[highlight]) {
    const need = drawBy === 'length' ? highlight / Math.max(1, series.length - 1) : (x1 === x0 ? 0 : (series[highlight][0] - x0) / (x1 - x0));
    if (need <= p + 1e-6) {
      const [hx, hy] = pts[highlight];
      disc(ctx, hx, hy, 18 * F.u, 'fg');
      const txt = counterText(series[highlight][1], 1, fmtOf(o));
      const w = measure(ctx, theme, 'ui', txt, L).w;
      const tx = Math.min(Math.max(hx, box.x + w / 2), box.x + box.w - w / 2);
      drawText(ctx, theme, txt, tx, Math.max(box.y + L, hy - L * 1.1), { role: 'ui', size: L, align: 'c', color: 'fg' });
    }
  }
  return { tip, p };
}

/**
 * lineReach(series, i, {at=0, beats=4, spring?}, spb) -> local beats at which line() (drawBy 'x') reaches point i.
 * Format independent: use it to place events / sfx on a data point (round with G.q to stay on the 1/16 grid).
 */
export function lineReach(series, i, { at = 0, beats = 4, spring } = {}, spb = 0.5) {
  const xs = series.map((s) => s[0]), x0 = Math.min(...xs), x1 = Math.max(...xs);
  const need = x1 === x0 ? 0 : (series[i][0] - x0) / (x1 - x0);
  if (need <= 0) return at;
  let lo = 0, hi = spring ? 20 : beats * spb;
  if (!spring && need >= 1) return at + beats;
  for (let k = 0; k < 60; k++) { const mid = (lo + hi) / 2; if (lineProgress(mid, beats, spb, spring) >= need) hi = mid; else lo = mid; }
  return at + hi / spb;
}

/** donut(f, {data:[{label, value}], box, at, highlight, beats}) -> {center:[x, y], r} */
export function donut(f, o) {
  const { data, box, at = 0, highlight, beats = 2 } = o;
  const { ctx, F } = f;
  const R = Math.min(box.w, box.h) / 2 * 0.92, cx = box.x + box.w / 2, cy = box.y + box.h / 2;
  const total = data.reduce((a, d) => a + d.value, 0) || 1;
  const sweep = easeInOutCubic(f.since(at) / (beats * f.grid.spb)) * Math.PI * 2;
  let a0 = -Math.PI / 2;
  data.forEach((d, i) => {
    const span = (d.value / total) * Math.PI * 2;
    const end = Math.min(a0 + span, -Math.PI / 2 + sweep);
    if (end > a0) {
      const hi = isHi(d, i, highlight);
      const pop = hi ? sp(f.since(at) - beats * f.grid.spb, 'snap') * 0.07 * R : 0;
      ctx.strokeStyle = paint(f.theme, hi ? 'accent' : i % 2 ? 'surface' : 'muted');
      ctx.lineWidth = R * 0.26; ctx.lineCap = 'butt';
      ctx.beginPath(); ctx.arc(cx, cy, R * 0.86 + pop, a0 + 0.012, end - 0.012); ctx.stroke();
    }
    a0 += span;
  });
  return { center: [cx, cy], r: R * 0.72, u: F.u };
}

/** axis(f, {scale, box, side:'b'|'l', at, ticks, fmt, unit}): tick labels that slide in. */
export function axis(f, o) {
  const { scale, box, side = 'b', at = 0, ticks } = o;
  const { ctx, theme, F } = f;
  const L = readable(F, 0.9), p = sp(f.since(at), 'med');
  if (p <= 0) return;
  const tv = ticks || niceTicks(scale.domain[0], scale.domain[1], 4);
  for (const v of tv) {
    const txt = counterText(v, 1, fmtOf(o));
    if (side === 'b') drawText(ctx, theme, txt, scale(v), box.y + box.h + L * 1.4 + (1 - p) * L, { role: 'ui', size: L, align: 'c', color: 'muted', rest: [scale(v), box.y + box.h + L * 1.4] });
    else drawText(ctx, theme, txt, box.x - L * 0.5 - (1 - p) * L, scale(v) + L * 0.35, { role: 'ui', size: L, align: 'r', color: 'muted', rest: [box.x - L * 0.5, scale(v) + L * 0.35] });
  }
}
