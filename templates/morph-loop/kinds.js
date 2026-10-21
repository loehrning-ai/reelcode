// kinds.js: the UI states the morph-loop container can become. Each kind gives
//   geom(G, s)            rest size {w, h, r} (and default fill, optional dock) from the UI scale S, never raw pixels
//   hot(b, s, G)          where the cursor acts to leave this state (canvas px, rest box b)
//   park(b, s, G, cur, k) optional: where the cursor rests (default: hovering just off the hotspot)
//   parkSteps(s)          optional: local beats where the park moves to step k (the cursor drags the content)
//   taps(s, nb)           optional: local beats of in-state clicks (cursor taps hot, press pulse, click sfx)
//   exit                  optional: after its last tap the cursor leaves the frame (it comes back for the next change)
//   lift(b, s, G)         optional: the rect the container closes on when the NEXT state enters with `via: lift`
//                         ({x, y, w, h, r, fill}); fill is a theme key or 'on' (the text colour on this state's fill)
//   punch: {at}           optional: on local beat `at` the container blooms full-bleed (a camera push-in); draw gets
//                         c.zp in [0, 1] (0 = rest, 1 = full-bleed) and lays its hero out against the frame
//   draw(c)               content inside the container, a pure function of c.lt (seconds since the state began)
//   events(s, nb) / sfx(s, nb)   local beats, derived from content only (identical in every format)
// Springs: UI parts use UI (tiny overshoot); type uses TYPE (critically damped, no overshoot).
export const UI = [0.32, 0.77];
export const TYPE = [0.36, 1];
const DRAW = [0.66, 1];
const SLAM = [0.28, 0.57];

const sum = (c, d = 0, s = TYPE) => c.M.clamp(c.M.sp(c.lt - d, s), 0, 1);
const say = (c, str, x, y, o = {}) => c.T.drawText(c.ctx, c.theme, String(str), x, y, { role: 'ui', size: c.U, color: c.on, log: c.log, ...o });
const capOf = (c, role, size, weight) => c.T.measure(c.ctx, c.theme, role, 'H', size, weight).cap;
const wOf = (G, role, str, size, weight) => G.T.measure(G.ctx, G.theme, role, String(str), size, weight).w;
const stroke = (c, color, width) => { c.ctx.strokeStyle = c.T.paint(c.theme, color); c.ctx.lineWidth = width; c.ctx.lineCap = 'round'; c.ctx.lineJoin = 'round'; };
const fmtOpts = (s) => ({ fmt: s.fmt || 'int', decimals: s.decimals || 0, prefix: s.prefix || '', suffix: s.suffix || '' });
const lerp = (a, b, p) => a + (b - a) * p;
/** Typing speed: 1/8 beat per char, faster for long strings, always on the 1/16 grid. */
export const charBeats = (len, nb, lead = 1.75) => Math.max(1 / 16, Math.min(1 / 8, Math.floor(((nb - lead) / Math.max(1, len)) * 16) / 16));
const typed = (c, str, start, cb) => {
  const t0 = start * c.spb, dt = cb * c.spb;
  return c.lt < t0 ? 0 : Math.min(str.length, Math.floor((c.lt - t0) / dt) + 1);
};
/** Keep the tail of str that fits in width (an ellipsis marks the cut). */
const tail = (c, str, size, width) => {
  let s = str;
  while (s.length > 1 && c.T.measure(c.ctx, c.theme, 'ui', s.length < str.length ? `…${s}` : s, size).w > width) s = s.slice(1);
  return s.length < str.length ? `…${s}` : s;
};

// ---------- card ----------
/** Card layout at rest: title, counter, delta chip (stacked under the title in 9:16, 4:5 and 16:9; beside it in 1:1). */
function cardLayout(G, b, s) {
  const { S, U, T, ctx, theme, F } = G, pad = 1.1 * S, stack = F.orient !== 's';
  const full = T.counterText(Number(s.value), 1, { ...fmtOpts(s), from: s.from || 0 }), w100 = T.measure(ctx, theme, 'display', full, 100).w;
  const cw = s.delta ? T.measure(ctx, theme, 'ui', s.delta, U, 700).w + 1.2 * S : 0, ch = 1.7 * S;
  const room = b.w - 2 * pad - (cw && !stack ? cw + 0.6 * S : 0);
  const size = Math.max(U, Math.min((stack ? 3.2 : 2.7) * S, (room / w100) * 100)), base = b.y + b.h - pad;
  const vcap = T.measure(ctx, theme, 'display', 'H', size).cap, tcap = T.measure(ctx, theme, 'ui', 'H', U).cap;
  const chip = !s.delta ? null : stack ? { x: b.x + pad, y: b.y + pad + tcap + 0.6 * S, w: cw, h: ch } : { x: b.x + b.w - pad - cw, y: base - vcap / 2 - ch / 2, w: cw, h: ch };
  // the punch-in: the counter fills ~94% of the safe width (height-capped), centred on the box, chip under it
  const size1 = Math.min((0.94 * F.safe.w / w100) * 100, F.pick({ v: 0.15, s: 0.22, h: 0.34 }) * F.h);
  return { pad, full, w100, cw, ch, size, size1, base, tcap, chip, stack };
}

// ---------- chart / tooltip ----------
function chartPlot(b, s, S, U) {
  const pad = 1.0 * S, data = s.data || [];
  const plot = { x: b.x + pad, y: b.y + pad + U * 1.9, w: b.w - 2 * pad, h: b.h - 2 * pad - U * 3.6 };
  const vals = data.map((d) => d.value), lo = Math.min(0, ...vals), hi = Math.max(...vals) || 1;
  const pts = data.map((d, i) => [plot.x + (plot.w * i) / Math.max(1, data.length - 1), plot.y + plot.h - ((d.value - lo) / (hi - lo)) * plot.h]);
  return { plot, pts, pad };
}
const hiIndex = (s) => Math.min((s.data || []).length - 1, s.highlight ?? (s.data || []).length - 1);
/** Scrub dot: rides the drawn line, then the cursor drags it toward the highlight on the SCRUB beats. */
const SCRUB = [2, 3];
const scrubSteps = (s, last) => { const hi = hiIndex(s); return [last, hi > 0 && hi - 1 !== last ? hi - 1 : Math.min(last, hi + 1), hi]; };
function scrub(c, { plot, pts }) {
  const { M, D, ctx, S, spb, s } = c, last = pts.length - 1;
  if (last < 1) return;
  const st = scrubSteps(s, last);
  const keys = [[0, st[0]]].concat(SCRUB.map((b, k) => [b * spb, st[k + 1], UI]).filter((k) => k[0] < (c.nb - 0.5) * spb));
  const f = M.clamp(M.seq(c.lt, keys, UI), 0, last), i0 = Math.floor(Math.min(f, last - 1e-6)), u = f - i0;
  const x = pts[i0][0] + (pts[i0 + 1][0] - pts[i0][0]) * u, y = pts[i0][1] + (pts[i0 + 1][1] - pts[i0][1]) * u;
  const k = M.clamp(M.sp(c.lt - 1.5 * spb, UI), 0, 1.06);
  if (k <= 0.01) return;
  D.fillBox(ctx, { x: x - c.F.u * 1.5, y: y + (plot.y + plot.h - y) * (1 - k), w: 3 * c.F.u, h: (plot.y + plot.h - y) * k }, c.faint);
  D.disc(ctx, x, y, 0.42 * S * k, c.on);
  D.disc(ctx, x, y, 0.2 * S * k, c.g.fill);
}

/** Chart body: bars rise from the baseline (the counter's digits "drop" into them), the line draws edge to edge.
 *  axisOut in [0, 1] slides the axis row down out of the container (the tooltip replaces it). */
function drawChart(c, p, axisOut = 0) {
  const { ctx, D, M, S, U, b, s } = c;
  const { plot, pts, pad } = chartPlot(b, s, S, U);
  const e = sum(c, 0.05);
  if (s.title) say(c, s.title, b.x + pad, b.y + pad + capOf(c, 'ui', U) + (1 - e) * 0.5 * S, { color: c.mute });
  for (let k = 0; k < 3; k++) {
    const y = plot.y + (plot.h * k) / 2, g = M.clamp(M.sp(c.lt - 0.08 * k, UI), 0, 1.02);
    D.fillBox(ctx, { x: plot.x, y: y - c.F.u, w: plot.w * g, h: 2 * c.F.u }, c.faint);
  }
  const data = s.data || [], bw = Math.min(1.6 * S, (plot.w / Math.max(1, data.length - 1)) * 0.46), base = plot.y + plot.h;
  pts.forEach(([x, y], i) => {
    const g = M.clamp(M.sp(c.lt - 0.04 - 0.045 * i, UI), 0, 1.04), bx = M.clamp(x - bw / 2, plot.x, plot.x + plot.w - bw);
    if (g > 0.01) D.fillBox(ctx, { x: bx, y: base - (base - y) * g, w: bw, h: (base - y) * g }, c.theme.mix(c.mark, c.g.fill, 0.8), 0.25 * S);
  });
  if (axisOut < 0.98 && data.length) {
    const dy = axisOut * 3 * U, lab = (i, align) => say(c, data[i].label, align === 'l' ? plot.x : plot.x + plot.w, b.y + b.h - pad + dy, { color: c.mute, align, log: c.log && axisOut < 0.01 });
    lab(0, 'l'); lab(data.length - 1, 'r');
  }
  if (p <= 0 || pts.length < 2) return { plot, pts };
  const tip = D.line(ctx, pts, { color: c.mark, width: 0.16 * S, progress: p });
  D.disc(ctx, tip[0], tip[1], 0.26 * S, c.mark);
  return { plot, pts };
}
/** Tooltip bubble at rest: above the point inside the plot, else left / right / below; never over the title. */
function tipLayout(G, b, s) {
  const { S, U, T, ctx, theme } = G, { plot, pts } = chartPlot(b, s, S, U), i = hiIndex(s);
  if (!pts[i]) return null;
  const [px, py] = pts[i], vs = U * 1.5, ls = U * 1.12;
  const val = T.counterText(Number(s.data[i].value), 1, fmtOpts(s)), lab = s.data[i].label;
  const bw = Math.max(T.measure(ctx, theme, 'ui', val, vs, 700).w, T.measure(ctx, theme, 'ui', lab, ls).w) + 1.6 * S, bh = U * 4.1;
  const cl = (v, a, z) => Math.min(Math.max(v, a), z);
  // the axis row slides out, so the bubble may use the plot plus that row
  const bot = plot.y + plot.h + U * 2.2, cx = cl(px - bw / 2, plot.x, plot.x + plot.w - bw), cy = cl(py - bh / 2, plot.y, bot - bh);
  const opts = [[py - bh - 0.6 * S >= plot.y, cx, py - bh - 0.6 * S], [px - bw - 0.9 * S >= plot.x, px - bw - 0.9 * S, cy],
    [px + 0.9 * S + bw <= plot.x + plot.w, px + 0.9 * S, cy], [py + 0.6 * S + bh <= bot, cx, py + 0.6 * S], [true, cx, plot.y]];
  const [, bx, by] = opts.find((o) => o[0]);
  return { px, py, bx, by, bw, bh, val, lab, vs, ls, plot, pts };
}

// ---------- menu ----------
/** Menu beats: the query types over about 1 beat, then the highlight steps down one row per half beat. */
const menuPlan = (s) => {
  const len = (s.query || '').length, cb = len ? Math.min(0.25, Math.max(1 / 16, Math.floor((1.0 / len) * 16) / 16)) : 0;
  const done = 0.25 + len * cb, h0 = Math.max(1.5, Math.ceil((done + 0.25) * 2) / 2);
  return { cb, done, steps: Array.from({ length: s.selected || 0 }, (_, k) => h0 + k * 0.5) };
};

// ---------- notification ----------
const icOf = (G) => G.F.pick({ v: 1.5, s: 1.6, h: 1.8 }) * G.S;
const toastPad = (G) => G.F.pick({ v: 0.8, s: 0.8, h: 0.9 }) * G.S;

// ---------- field ----------
/** Two-row phone form: a label row with the send disc at its right, the typed value on the full width under it. */
function fieldLayout(G, b) {
  const { S } = G, padX = 0.9 * S, d = 1.5 * S;
  return { padX, d, sx: b.x + b.w - padX - d / 2, sy: b.y + 0.8 * S + d / 2, base: b.y + b.h - 1.0 * S, room: b.w - 2 * padX };
}

// ---------- logo lockup ----------
/** Lockup (frame-relative, inside the safe area): wordmark ~80% of the frame width and the tagline centred around 42% of
 *  the height; the CTA pill big in the thumb zone (~70%) in 9:16 / 4:5 / 1:1; one centred stack in 16:9. */
function lockup(G, s) {
  const { F, T, ctx, theme } = G, sa = F.safe, name = s.label || G.brandName, tag = s.caption || '';
  const w100 = wOf(G, 'display', name, 100);
  const size = Math.min((Math.min(0.8 * F.w, 0.96 * sa.w) / w100) * 100, F.pick({ v: 0.2, s: 0.22, h: 0.3 }) * F.h);
  const tsize = Math.max(T.readable(F, 1.3), Math.min(size * 0.42, ((0.9 * sa.w) / Math.max(1, wOf(G, 'display', tag, 100))) * 100));
  const psize = Math.max(T.readable(F, 1.3), tsize), pw = wOf(G, 'ui', s.then || '', psize, 700) + 2.6 * psize, ph = psize * 2.5;
  const ncap = T.measure(ctx, theme, 'display', 'H', size).cap, tcap = T.measure(ctx, theme, 'display', 'H', tsize).cap;
  const block = ncap + (tag ? 0.55 * size + tcap : 0), cx = F.w / 2, wide = F.orient === 'h';
  const stack = block + (s.then ? 0.9 * tsize + ph : 0);
  const top = wide ? sa.y + (sa.h - stack) / 2 : Math.max(sa.y, 0.42 * F.h - block / 2);
  const nameY = top + ncap, tagY = nameY + 0.55 * size + tcap, under = (tag ? tagY : nameY) + 0.9 * tsize;
  const py = wide ? under : Math.min(sa.y + sa.h - ph, Math.max(under, 0.7 * F.h - ph / 2));
  return { name, tag, size, tsize, psize, ncap, cx, nameY, tagY, tagW: tag ? wOf(G, 'display', tag, tsize) : 0, pill: { x: cx - pw / 2, y: py, w: pw, h: ph } };
}
const tagBeats = (tag) => Math.max(1 / 16, Math.min(1 / 8, Math.floor((0.8 / Math.max(1, tag.length)) * 16) / 16));

export const KINDS = {
  button: {
    beats: 2, need: ['label'], trigger: 'click', glide: true,
    geom: (G, s) => { const h = 2.6 * G.S; return { w: Math.max(wOf(G, 'ui', s.label, G.U * 1.3, 700) + 3 * G.S, Math.min(G.maxW, 9.9 * G.S)), h, r: h / 2, fill: 'accent' }; },
    // right third, past the label's end: the arrow (which extends down-right of its tip) never sits on the text
    hot: (b, s, G) => { const lw = wOf(G, 'ui', s.label, G.U * 1.3, 700), end = b.x + (b.w + lw) / 2;
      return [Math.max(b.x + b.w * 0.7, end + 0.6 * G.S), b.y + b.h * 0.7]; },
    // hover step one beat before the click: the cursor arrives, the pill darkens a step and the label lifts
    events: (s, nb) => (nb >= 2 ? [nb - 1] : []),
    sfx: (s, nb) => (nb >= 2 ? [{ at: nb - 1, sfx: 'tick', gain_db: -12 }] : []),
    draw(c) {
      const size = c.U * 1.3, e = sum(c, 0.04), hv = c.nb >= 2 ? sum(c, (c.nb - 1) * c.spb, UI) : 0;
      if (hv > 0.01) c.D.fillBox(c.ctx, c.b, c.theme.mix(c.g.fill, 'fg', 0.14 * Math.min(1, hv)), c.g.r);   // hover: the fill darkens a step (a colour mix, not opacity)
      say(c, c.s.label, c.b.x + c.b.w / 2, c.b.y + c.b.h / 2 + capOf(c, 'ui', size, 700) / 2 + (1 - e) * 0.6 * c.S - hv * 0.12 * c.S, { size, weight: 700, align: 'c' });
    },
  },
  field: {
    beats: 3, need: ['value'], trigger: 'click',
    // two rows: label + send disc, then the typed value on the full width at ~1.6x UI size; if that exceeds the
    // stage, the value steps down toward readable(F) before anything is cut, so the payoff always reads in full
    geom: (G, s) => {
      const h = 4.6 * G.S, padX = 0.9 * G.S, vsz = G.U * 1.6, vw = wOf(G, 'ui', s.value, vsz);
      const w = Math.min(G.maxW, Math.max(10 * G.S, vw + 2 * padX)), fs = Math.max(G.T.readable(G.F), Math.min(vsz, (0.94 * vsz * (w - 2 * padX)) / vw));
      return { w, h, r: Math.min(G.theme.radius * 1.1, h / 2), fill: 'surface', fs };
    },
    hot: (b, s, G) => { const f = fieldLayout(G, b); return [f.sx, f.sy]; },
    events: (s, nb) => [0.25, 0.25 + charBeats(String(s.value).length, nb, 1.0) * String(s.value).length],
    sfx: (s, nb) => { const v = String(s.value), cb = charBeats(v.length, nb, 1.0);
      return [...v].map((_, i) => ({ at: 0.25 + i * cb, sfx: 'tick', gain_db: -16, ...(i % 2 ? { tier: 'busy' } : {}) })); },
    draw(c) {
      const { b, S, U, M, D, ctx } = c, v = String(c.s.value), cb = charBeats(v.length, c.nb, 1.0), f = fieldLayout(c, b);
      const fs = c.g.fs || U, x0 = b.x + f.padX, ls = U * 0.9, e = sum(c, 0.04);
      say(c, c.s.label || 'Work email', x0, f.sy + capOf(c, 'ui', ls) / 2 + (1 - e) * 0.5 * S, { color: c.mute, size: ls });
      const n = typed(c, v, 0.25, cb), done = 0.25 * c.spb + v.length * cb * c.spb;
      if (!n) say(c, c.s.placeholder || '', x0, f.base, { color: c.mute, size: fs });
      const m = n ? say(c, tail(c, v.slice(0, n), fs, f.room), x0, f.base, { size: fs }) : { w: 0 };
      const ccap = capOf(c, 'ui', fs);
      if (n < v.length || Math.floor(c.lt * 2.4) % 2 === 0) D.fillBox(ctx, { x: x0 + m.w + 0.12 * S, y: f.base - ccap * 1.25, w: 0.1 * S, h: ccap * 1.5 }, c.mark);
      D.fillBox(ctx, { x: x0, y: f.base + 0.45 * S, w: f.room, h: 2 * c.F.u }, c.faint);
      const k = M.clamp(M.sp(c.lt - done, UI), 0, 1.1) * 0.5 + 0.5, r = (f.d / 2) * k, sx = f.sx, sy = f.sy;
      D.fillBox(ctx, { x: sx - r, y: sy - r, w: 2 * r, h: 2 * r }, c.mark, r);
      stroke(c, c.onOf(c.mark), 0.13 * S);
      ctx.beginPath(); ctx.moveTo(sx - r * 0.42, sy); ctx.lineTo(sx + r * 0.38, sy);
      ctx.moveTo(sx + r * 0.05, sy - r * 0.36); ctx.lineTo(sx + r * 0.4, sy); ctx.lineTo(sx + r * 0.05, sy + r * 0.36); ctx.stroke();
    },
  },
  loader: {
    beats: 2, need: [], trigger: 'auto',
    geom: (G) => { const d = Math.max(3.2 * G.S, G.minD); return { w: d, h: d, r: d / 2, fill: 'surface' }; },
    hot: (b) => [b.x + b.w / 2, b.y + b.h / 2],
    draw(c) {
      const { b, ctx, S } = c, R = Math.min(b.w, b.h) * 0.3, cx = b.x + b.w / 2, cy = b.y + b.h / 2;
      stroke(c, c.faint, 0.26 * S); ctx.beginPath(); ctx.arc(cx, cy, R, 0, Math.PI * 2); ctx.stroke();
      const a = c.lt * Math.PI * 2.6, sweep = Math.PI * (0.55 + 0.35 * Math.sin(c.lt * 5.2));
      stroke(c, c.mark, 0.26 * S); ctx.beginPath(); ctx.arc(cx, cy, R, a, a + sweep); ctx.stroke();
    },
  },
  success: {
    beats: 2, need: [], trigger: 'auto',
    geom: (G) => { const d = Math.max(3.8 * G.S, G.minD * 1.12); return { w: d, h: d, r: d / 2, fill: 'accent' }; },
    hot: (b) => [b.x + b.w / 2, b.y + b.h / 2],
    park: (b, s, G, cur) => [b.x + b.w * 0.86, b.y + b.h * 0.86],
    sfx: () => [{ at: 0, sfx: 'pop', gain_db: -4 }],
    draw(c) {
      const { b, S } = c, R = Math.min(b.w, b.h) * 0.3, cx = b.x + b.w / 2, cy = b.y + b.h / 2;
      const pts = [[-0.48, 0.02], [-0.14, 0.36], [0.5, -0.32]].map(([x, y]) => [cx + x * R * 1.2, cy + y * R * 1.2]);
      c.D.line(c.ctx, pts, { color: c.on, width: 0.36 * S, progress: sum(c, 0.06, DRAW) });
    },
  },
  card: {
    // beat 1 (the loop's t=0 with LEAD 1): the cursor taps and the delta chip slams in; beat 2: the count lands and the
    // container punches in full-bleed until the counter fills the frame; the next state pulls back out of it
    beats: 4, need: ['title', 'value'], trigger: 'auto', big: true, exit: true, punch: { at: 2 },
    geom: (G, s) => ({ w: Math.min(G.maxW, 14 * G.S), h: (G.F.orient !== 's' && s.delta ? 8.4 : 6.4) * G.S, r: G.theme.radius * 1.1, fill: 'surface' }),
    hot: (b, s, G) => { const k = cardLayout(G, b, s); return k.chip ? [k.chip.x + k.chip.w * 0.78, k.chip.y + k.chip.h * 0.7] : [b.x + b.w - 1.3 * G.S, b.y + 1.2 * G.S]; },
    taps: (s) => (s.delta ? [1] : []),
    events: (s) => (s.delta ? [1, 2] : [2]),
    sfx: (s) => [...(s.delta ? [{ at: 1, sfx: 'pop', gain_db: -8 }] : []), { at: 2, sfx: 'swish', gain_db: -10 }, { at: 2, sfx: 'thump', gain_db: -8 }],
    draw(c) {
      const { b, S, U, M, D, T, s } = c, z = M.clamp(c.zp || 0, 0, 1), k = cardLayout(c, b, s), e = sum(c, 0.04);
      const cx = b.x + b.w / 2, cy = b.y + b.h / 2, o = { ...fmtOpts(s), from: s.from || 0 };
      const size = lerp(k.size, k.size1, z), vcap = capOf(c, 'display', size), vw = (k.w100 * size) / 100;
      // hero layout (z = 1): counter centred on the box, title above it, chip under it
      const base = lerp(k.base, cy + vcap / 2, z), x = lerp(b.x + k.pad, cx - vw / 2, z);
      const tw = T.measure(c.ctx, c.theme, 'ui', s.title, U).w;
      const ty = lerp(b.y + k.pad + k.tcap, base - vcap - 0.9 * S, z) + (1 - e) * 0.5 * S;
      say(c, s.title, lerp(b.x + k.pad, cx - tw / 2, z), ty, { color: c.mute });
      const p = M.clamp(M.sp(c.lt - 0.12, [0.89, 1]), 0, 1);
      say(c, T.counterText(Number(s.value), p, o), x, base + (1 - e) * 0.6 * S, { role: 'display', size });
      if (!k.chip) return;
      // the chip slams in on beat 1 (starts a hair early so the loop's frame 0 already carries the accent hit)
      const a = M.clamp(M.sp(c.lt - c.spb + 0.1, SLAM), 0, 1.1);
      if (a <= 0.01) return;
      const chip0 = k.chip, chip1 = { x: cx - k.cw / 2, y: base + 0.8 * S, w: k.cw, h: k.ch };
      const g0 = { x: lerp(chip0.x, chip1.x, z), y: lerp(chip0.y, chip1.y, z), w: k.cw, h: k.ch };
      const sc = 1 + 1.3 * (1 - Math.min(1, a)), g = { x: g0.x + g0.w * (1 - sc) / 2, y: g0.y + g0.h * (1 - sc) / 2, w: g0.w * sc, h: g0.h * sc };
      // the chip's fill (not its text) gives way when the accent is too weak for AA under small bold type
      D.fillBox(c.ctx, g, c.ink(c.mark, c.onOf(c.mark), U), g.h / 2);
      if (a > 0.5) say(c, s.delta, g0.x + g0.w / 2, g0.y + k.ch / 2 + (capOf(c, 'ui', U, 700) / 2) * sc, { weight: 700, align: 'c', color: c.onOf(c.mark), sx: sc, sy: sc, log: c.log && sc < 1.02 });
    },
  },
  chart: {
    beats: 4, need: ['data'], trigger: 'hover', big: true,
    geom: (G) => { const w = Math.min(G.maxW, 17 * G.S); return { w, h: Math.min(G.stage.h * 0.9, w * G.F.pick({ v: 1.0, s: 0.66, h: 0.6 })), r: G.theme.radius, fill: 'surface' }; },
    hot: (b, s, G) => chartPlot(b, s, G.S, G.U).pts[hiIndex(s)],
    // the cursor drags the scrub dot: it rests on the dot at each step, so the hover visibly moves it
    park: (b, s, G, cur, k = 0) => { const { pts } = chartPlot(b, s, G.S, G.U), st = scrubSteps(s, pts.length - 1), p = pts[st[Math.min(k, 2)]]; return [p[0] + 0.15 * cur, p[1] + 0.2 * cur]; },
    parkSteps: () => [0.4, ...SCRUB],
    events: (s, nb) => [0.5, ...SCRUB.filter((b) => b < nb - 0.5)],
    sfx: (s, nb) => SCRUB.filter((b) => b < nb - 0.5).map((b) => ({ at: b, sfx: 'tick', gain_db: -14 })),
    draw(c) { scrub(c, drawChart(c, c.M.clamp(c.M.sp(c.lt - 0.25, DRAW), 0, 1))); },
  },
  tooltip: {
    beats: 2, need: ['data'], trigger: 'click', inherit: 'chart',
    geom: (G, s) => KINDS.chart.geom(G, s),
    hot: (b, s, G) => { const L = tipLayout(G, b, s); return L ? [L.bx + L.bw * 0.82, L.by + L.bh * 0.72] : [b.x + b.w / 2, b.y + b.h / 2]; },
    // `lift` out: the container closes on the bubble, which then opens into the next state (tooltip -> search)
    lift: (b, s, G) => { const L = tipLayout(G, b, s); return L ? { x: L.bx, y: L.by, w: L.bw, h: L.bh, r: 0.5 * G.S, fill: 'on' } : null; },
    events: () => [0.5],
    draw(c) {
      const { ctx, D, M, S, U, s } = c, k = M.clamp(M.sp(c.lt - 0.04, UI), 0, 1.06), { pts } = drawChart(c, 1, Math.min(1, k));
      const L = tipLayout(c, c.b, s);
      if (!L || !pts.length) return;
      const { px, py, bx, by, bw, bh, plot } = L;
      D.fillBox(ctx, { x: px - c.F.u * 1.5, y: plot.y + (py - plot.y) * (1 - k), w: 3 * c.F.u, h: plot.h * k }, c.faint);
      D.disc(ctx, px, py, 0.34 * S * Math.min(1, 1 - k * 0.4), c.on);
      // the highlighted point itself grows into the bubble
      const bub = { x: px + (bx - px) * k, y: py + (by - py) * k, w: bw * k, h: bh * k };
      D.fillBox(ctx, bub, c.on, Math.min(0.5 * S, bub.h / 2));
      if (k < 0.5) return;
      const e = sum(c, 0.14), tc = c.onOf(c.on);
      D.withClip(ctx, (x) => x.rect(bub.x, bub.y, bub.w, bub.h), () => {
        say(c, L.val, bx + 0.8 * S, by + U * 1.85 + (1 - e) * 0.5 * S, { size: L.vs, weight: 700, color: tc });
        say(c, L.lab, bx + 0.8 * S, by + U * 3.35 + (1 - e) * 0.5 * S, { size: L.ls, color: tc });
      });
    },
  },
  menu: {
    beats: 3, need: ['items'], trigger: 'click', big: true,
    geom: (G, s) => { const rh = 1.85 * G.S; return { w: Math.min(G.maxW, 14 * G.S), h: Math.min(G.stage.h, rh * (s.items.length + 1) + 0.6 * G.S), r: G.theme.radius, fill: 'surface' }; },
    hot: (b, s, G) => { const rh = 1.85 * G.S; return [b.x + b.w * 0.72, b.y + 0.3 * G.S + rh * (1.5 + (s.selected || 0))]; },
    // park in the right gutter of row k (the highlighted row); parkSteps: local beats where the park moves to row k,
    // the same beats the highlight steps on, so cursor and highlight travel together
    park: (b, s, G, cur, k = s.selected || 0) => { const rh = 1.85 * G.S; return [b.x + b.w - 0.4 * G.S - cur * 0.7, b.y + 0.3 * G.S + rh * (1.5 + k) - cur * 0.15]; },
    parkSteps: (s) => [0.4, ...menuPlan(s).steps],
    // `lift` change: the container closes on the selected row, which then becomes the next state
    lift: (b, s, G) => { const rh = 1.85 * G.S, y = b.y + 0.3 * G.S + rh * (1 + (s.selected || 0)) + 0.12 * G.S;
      return { x: b.x + 0.3 * G.S, y, w: b.w - 0.6 * G.S, h: rh - 0.24 * G.S, r: 0.5 * G.S }; },
    events: (s) => { const m = menuPlan(s); return [0.25, m.done, ...m.steps]; },
    sfx: (s) => { const m = menuPlan(s);
      return [...(s.query || '')].map((_, i) => ({ at: 0.25 + i * m.cb, sfx: 'tick', gain_db: -18, tier: 'busy' })).concat(m.steps.map((b) => ({ at: b, sfx: 'tick', gain_db: -11 }))); },
    draw(c) {
      const { b, S, U, M, D, ctx, s } = c, rh = 1.85 * S, top = b.y + 0.3 * S, x0 = b.x + 0.9 * S, cap = capOf(c, 'ui', U);
      const m = menuPlan(s);
      const keys = [[0, 0]].concat(m.steps.map((sb, k) => [sb * c.spb, k + 1, UI]));
      const hy = top + rh * (1 + M.seq(c.lt, keys, UI));
      D.fillBox(ctx, { x: b.x + 0.3 * S, y: hy + 0.12 * S, w: b.w - 0.6 * S, h: rh - 0.24 * S }, c.faint, 0.5 * S);
      D.fillBox(ctx, { x: b.x + 0.3 * S, y: hy + 0.42 * S, w: 0.16 * S, h: rh - 0.84 * S }, c.mark, 0.08 * S);
      const icx = x0 + 0.35 * S, icy = top + rh / 2;
      stroke(c, c.mute, 0.12 * S); ctx.beginPath(); ctx.arc(icx, icy - 0.08 * S, 0.3 * S, 0, Math.PI * 2);
      ctx.moveTo(icx + 0.22 * S, icy + 0.14 * S); ctx.lineTo(icx + 0.45 * S, icy + 0.37 * S); ctx.stroke();
      const q = s.query || '', n = q ? typed(c, q, 0.25, m.cb) : 0;
      say(c, n ? tail(c, q.slice(0, n), U, b.w - 2.6 * S) : (s.placeholder || ''), x0 + 1.2 * S, icy + cap / 2, { color: n ? c.on : c.mute });
      D.fillBox(ctx, { x: b.x, y: top + rh - c.F.u, w: b.w, h: 2 * c.F.u }, c.faint);
      s.items.forEach((it, k) => {
        const e = sum(c, 0.06 + k * 0.05);
        say(c, it, x0 + 0.4 * S, top + rh * (k + 1.5) + cap / 2 + (1 - e) * 0.6 * S);
      });
    },
  },
  notification: {
    // in 9:16 / 4:5 / 1:1 the toast docks full-width at the top of the safe area, like a phone banner
    beats: 2, need: ['title'], trigger: 'click', big: true,
    geom: (G, s) => {
      const w = G.F.orient === 'h' ? Math.min(G.stage.w * 0.96, 16 * G.S) : G.stage.w;
      const body = s.body ? G.T.wrapText(G.ctx, G.theme, s.body, { role: 'ui', size: G.U, width: w - 2.4 * G.S - icOf(G) }).slice(0, 2) : [];
      return { w, h: Math.max(icOf(G) + 2 * toastPad(G), 2.4 * G.S + G.U * 1.25 * body.length + G.U * 1.3), r: 1.0 * G.S, fill: 'fg', dock: 'n', body };
    },
    hot: (b, s, G) => [b.x + toastPad(G) + icOf(G) * 0.7, b.y + b.h / 2 + icOf(G) * 0.2],   // on the icon, off the title/body text
    // `lift` out: the container closes on the icon, which then grows into the next state (icon -> CTA pill)
    // the disc is as tall as the toast, so the transfer object stays big on screen
    lift: (b, s, G) => { const d = b.h, cx = b.x + toastPad(G) + icOf(G) / 2; return { x: cx - d / 2, y: b.y, w: d, h: d, r: d / 2, fill: 'accent' }; },
    sfx: () => [{ at: 0, sfx: 'pop', gain_db: -8 }],
    draw(c) {
      const { b, S, U, M, D, ctx, T, theme, s } = c, pad = toastPad(c), ic = icOf(c);
      const k = M.clamp(M.sp(c.lt - 0.08, UI), 0, 1.08), icx = b.x + pad + ic / 2, icy = b.y + b.h / 2;
      D.fillBox(ctx, { x: icx - (ic / 2) * k, y: icy - (ic / 2) * k, w: ic * k, h: ic * k }, c.mark, 0.5 * S * k);
      D.disc(ctx, icx, icy, 0.32 * S * k, c.onOf(c.mark));
      const tx = b.x + pad * 2 + ic, box = { x: tx, y: b.y, w: b.x + b.w - pad - tx, h: U * 1.5 }, lh = U * 1.4;
      const fitT = T.fitText(ctx, theme, s.title, { role: 'ui', box, max: U * 1.3, min: Math.min(U, T.readable(c.F, 1.15)), weight: 700 });
      const rows = [{ s: fitT.lines[0].s, size: fitT.size, weight: 700, color: c.on }, ...c.g.body.map((l) => ({ s: l, size: U, color: c.mute }))];
      const y0 = icy - (lh * (rows.length - 1)) / 2 + fitT.cap / 2;
      rows.forEach((r, k2) => say(c, r.s, tx, y0 + k2 * lh + (1 - sum(c, 0.1 + 0.08 * k2)) * 0.5 * S, { size: r.size, weight: r.weight, color: r.color }));
    },
  },
  logo: {
    // the finale lockup, a 4-beat sequence: beat 0 the container blooms full-bleed and the wordmark slams in; beat 1 the
    // tagline types; beat 2 the wordmark contracts into the CTA pill; then the cursor presses the pill and the container
    // closes on it (`lift`), and the pill opens into state 0 on the loop downbeat
    beats: 4, need: [], trigger: (s) => (s.then ? 'click' : 'auto'), full: true,
    geom: (G) => ({ w: G.F.w * 1.14, h: G.F.h * 1.14, r: G.theme.radius, fill: 'accent' }),
    hot: (b, s, G) => { const k = lockup(G, s); return [k.pill.x + k.pill.w * 0.8, k.pill.y + k.pill.h * 0.68]; },
    lift: (b, s, G) => { if (!s.then) return null; const k = lockup(G, s), ox = b.x + b.w / 2 - G.F.w / 2, oy = b.y + b.h / 2 - G.F.h / 2;
      return { x: k.pill.x + ox, y: k.pill.y + oy, w: k.pill.w, h: k.pill.h, r: k.pill.h / 2, fill: 'surface' }; },
    events: (s, nb) => [1, ...(s.then && nb >= 3 ? [2] : [])],
    sfx: (s, nb) => {
      const tag = s.caption || '', cb = tagBeats(tag);
      return [{ at: 0, sfx: 'thump', gain_db: -1 }, { at: 0, sfx: 'riser', gain_db: -6, dur: 2 }, { at: 0, sfx: 'pop', gain_db: -6 },
        ...[...tag].filter((ch) => ch !== ' ').map((_, i) => ({ at: 1 + i * cb, sfx: 'tick', gain_db: -18, ...(i % 2 ? { tier: 'busy' } : {}) })),
        ...(s.then && nb >= 3 ? [{ at: 2, sfx: 'pop', gain_db: -6 }, { at: 2, sfx: 'swish', gain_db: -12 }] : [])];
    },
    draw(c) {
      const { M, D, ctx, s } = c, k0 = lockup(c, s), on = c.on, ox = c.b.x + c.b.w / 2 - c.F.w / 2, oy = c.b.y + c.b.h / 2 - c.F.h / 2;
      const k = { ...k0, cx: k0.cx + ox, nameY: k0.nameY + oy, tagY: k0.tagY + oy, pill: { ...k0.pill, x: k0.pill.x + ox, y: k0.pill.y + oy } };
      const g = k.pill, pcx = g.x + g.w / 2, pcy = g.y + g.h / 2;
      // wordmark: slams up into place, then (beat 2) contracts into the pill
      const zc = s.then && c.nb >= 3 ? M.clamp(M.sp(c.lt - 2 * c.spb, UI), 0, 1) : 0;
      if (zc < 0.001) {
        const e = M.clamp(M.sp(c.lt - 0.04, SLAM), 0, 1.04), sc = 1 + 0.18 * (1 - Math.min(1, e));
        if (e > 0.02) say(c, k.name, k.cx, k.nameY + (1 - Math.min(1, e)) * k.ncap * 0.6, { role: 'display', size: k.size, align: 'c', color: on, sx: sc, sy: sc, log: c.log && e > 0.999 });
      } else if (zc < 0.9) {
        const z = 1 - zc, y = lerp(k.nameY, pcy + k.ncap * z / 2, zc);
        say(c, k.name, lerp(k.cx, pcx, zc), y, { role: 'display', size: k.size, align: 'c', color: on, sx: z, sy: z, log: false });
      }
      if (k.tag) {   // the tagline types on beat 1
        const n = typed(c, k.tag, 1, tagBeats(k.tag));
        if (n) say(c, k.tag.slice(0, n), k.cx - k.tagW / 2, k.tagY, { role: 'display', size: k.tsize, color: on, log: c.log && n === k.tag.length });
      }
      if (!s.then || c.nb < 3) return;
      const p = M.clamp(M.sp(c.lt - 2 * c.spb - 0.06, UI), 0, 1.08);
      if (p <= 0.01) return;
      const box = { x: g.x + (g.w * (1 - p)) / 2, y: g.y + (g.h * (1 - p)) / 2, w: g.w * p, h: g.h * p };
      D.fillBox(ctx, box, 'surface', box.h / 2);   // the pill is cut from state 0's card stock: it opens into the card
      if (p > 0.6) say(c, s.then, pcx, pcy + capOf(c, 'ui', k.psize, 700) / 2, { size: k.psize, weight: 700, align: 'c', color: c.ink('accent', 'surface', k.psize) });
    },
  },
};
