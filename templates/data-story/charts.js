// charts.js: the race and line shots. Each builder takes (api, point, fmt, path) and returns
// {beats, events, sfx, draw(f), handIn(f), handOut}. Each shot lays out its own claim (own position and scale) and
// its own chart; geometry may sit under a camera, labels are always set in screen space at a readable size.
// Timing (events/sfx) depends only on content and the beat length, never on the format.
import { TYPE, UI, smooth, numOpts, claimBlock, camera, pushPull, pill, pillBox } from './lib.js';

export const need = (ok, path, msg) => { if (!ok) throw new Error(`${path}: ${msg}`); };
export const hiIndex = (keys, h) => (h === undefined ? undefined : typeof h === 'number' ? h : keys.indexOf(h));

/**
 * Bar chart race, full bleed: the claim is a big headline across the top, the bars run in from the frame's left edge
 * at double thickness with the names inside them, and the frame label (the year) is a giant ghost numeral behind the
 * bars. The scene opens already moving (the first-to-second frame tween is under way on the cut); on the overtake
 * the camera pushes in on the two leading bar heads, holds, then pulls out to the whole chart for the growth chip.
 */
export function race(api, pt, fmt, path) {
  const { F, ctx, theme, T, M, D } = api;
  const S = F.safe;
  const keys = pt.keys || [], frames = pt.frames || [];
  need(keys.length >= 2 && frames.length >= 2, path, 'race needs keys:[...] (2-8) and frames:[{label, values:[...]}] (2-10)');
  frames.forEach((fr, k) => need(Array.isArray(fr.values) && fr.values.length === keys.length, `${path}.frames[${k}]`, `values must have ${keys.length} numbers (one per key)`));
  const o = numOpts(pt), n = keys.length, K = frames.length, hi = hiIndex(keys, pt.highlight), step = pt.step || 2;
  const ranks = frames.map((fr) => { const order = fr.values.map((v, j) => [v, j]).sort((a, b) => b[0] - a[0] || a[1] - b[1]); const r = []; order.forEach(([, j], i) => { r[j] = i; }); return r; });
  const maxes = frames.map((fr) => Math.max(...fr.values) || 1);
  // Frame k (k >= 1) ticks on whole beats from the cut; LEAD seconds of its tween have already run at the tick, so
  // the cut itself lands on moving bars.
  const at = (k) => (k === 0 ? -step : (k - 1) * step), LEAD = 0.28;
  const claim = claimBlock(api, pt, { x: S.x, y: S.y, w: S.w * F.pick({ v: 1, s: 1, h: 0.66 }), h: S.h * F.pick({ v: 0.2, s: 0.24, h: 0.26 }) },
    { scale: F.pick({ v: 2.5, s: 2.4, h: 2.8 }), valign: 't' });
  const gap = T.readable(F, 0.9);
  const area = { x: S.x, y: claim.box.y + claim.box.h + gap, w: S.w, h: S.y + S.h - (claim.box.y + claim.box.h + gap) };
  const rowH = area.h / n, barH = rowH * 0.74;
  const labSize = Math.max(T.readable(F, 0.8), Math.min(T.readable(F, 1.05), barH * 0.42)), valSize = labSize * 1.08;
  const valW = T.measure(ctx, theme, 'ui', fmt(Math.max(...maxes), o), valSize, 700).w + labSize * 0.9;
  const plotW = S.w - valW, pad = labSize * 0.55;
  const yrSize = Math.min(area.h * 0.62, S.w * F.pick({ v: 0.95, s: 0.8, h: 0.5 }) / (Math.max(...frames.map((fr) => T.measure(ctx, theme, 'display', String(fr.label), 100).w)) / 100));
  const yrCap = T.measure(ctx, theme, 'display', '0', yrSize).cap;
  const vs = smooth(step * api.grid.spb * 0.9);
  const sinceK = (f, k) => f.since(at(k)) + LEAD;
  const tween = (f, list) => list.reduce((acc, v, k) => (k ? acc + (v - list[k - 1]) * M.sp(sinceK(f, k), vs) : acc), list[0]);
  const over = hi === undefined ? -1 : ranks.findIndex((r, k) => k > 0 && r[hi] === 0 && ranks[k - 1][hi] !== 0);
  const v0 = hi === undefined ? 0 : frames[0].values[hi], v1 = hi === undefined ? 0 : frames[K - 1].values[hi];
  const endTxt = v0 > 0 ? `${v1 >= v0 ? '+' : ''}${fmt((v1 / v0 - 1) * 100, { fmt: 'pct' })} since ${frames[0].label}` : '';
  const last = at(K - 1), endAt = last + 1, beats = endAt + 2;
  const events = [...frames.slice(1).map((_, k) => at(k + 1)), ...(over > 0 ? [at(over) + 2] : []), ...(endTxt ? [endAt] : [])];
  const sfx = [...frames.slice(1).map((_, k) => ({ at: at(k + 1), sfx: 'swish', gain_db: -12 })),
    ...(over > 1 ? [{ at: at(over) - 1, sfx: 'riser', gain_db: -11, dur: 1 }] : []),
    ...(over > 0 ? [{ at: at(over), sfx: 'thump', gain_db: -2 }] : []), ...(endTxt ? [{ at: endAt, sfx: 'pop', gain_db: -6 }] : [])];
  const rectOf = (pos, v, mx) => ({ x: F.full.x, y: area.y + pos * rowH + (rowH - barH) / 2, w: S.x - F.full.x + plotW * (v / mx), h: barH });
  // the growth chip sits in the empty right end of the lowest row whose final value label leaves room for it
  const cSize = T.readable(F, 1.0), lastV = frames[K - 1].values, lastR = ranks[K - 1];
  const chipW = endTxt ? pillBox(api, endTxt, cSize, 0, 0).w : 0;
  const rowFree = (r) => { const j = lastR.indexOf(r); return S.x + plotW * (lastV[j] / maxes[K - 1]) + labSize * 0.4 + T.measure(ctx, theme, 'ui', fmt(lastV[j], o), valSize, 700).w + labSize; };
  const chipRow = endTxt ? [...Array(n).keys()].reverse().find((r) => rowFree(r) + chipW <= S.x + S.w) : undefined;
  const chip = chipRow !== undefined ? pillBox(api, endTxt, cSize, S.x + S.w - chipW, area.y + chipRow * rowH + rowH / 2) : null;
  const focusOf = () => [S.x + plotW * 0.9, area.y + rowH];
  const camAt = (f) => camera(focusOf(), focusOf(), over > 0 ? pushPull(f, M, at(over) - 0.5, at(over) + 2, 0.5) : 0, 1.32);
  const hk = hi === undefined ? 0 : hi;
  const state = (f, j) => {
    const pos = ranks.slice(1).reduce((acc, r, k) => acc + (r[j] - ranks[k][j]) * M.sp(sinceK(f, k + 1), UI), ranks[0][j]);
    return { pos, v: tween(f, frames.map((fr) => fr.values[j])) };
  };
  // outgoing hand-off: in the last half beat the highlight bar collapses toward its head into a dot (its value keeps
  // riding the head); the next shot (the line) opens with its pen tip exactly on that dot.
  const RETRACT = 0.5, endRect = rectOf(ranks[K - 1][hk], frames[K - 1].values[hk], maxes[K - 1]);
  const dotR = Math.max(10 * F.u, barH * 0.3);
  const handOut = hi === undefined ? null : { kind: 'disc', cx: endRect.x + endRect.w - dotR, cy: endRect.y + endRect.h / 2, r: dotR };
  const retract = (f) => (hi === undefined ? 0 : M.easeInOutCubic(M.clamp((f.lb - (beats - RETRACT)) / RETRACT)));
  const collapse = (r, q) => { const w = r.w + (dotR * 2 - r.w) * q, h = r.h + (dotR * 2 - r.h) * q; return { x: r.x + r.w - w, y: r.y + (r.h - h) / 2, w, h }; };
  return { beats, events, sfx, handOut,
    draw(f) {
      const rq = retract(f);
      claim.draw(f);
      const mx = tween(f, maxes), cam = camAt(f);
      const hp = over > 0 ? M.clamp(M.sp(f.since(at(over)), UI)) : hi !== undefined ? 1 : 0;
      const kNow = frames.reduce((acc, _, i) => (sinceK(f, i) >= 0 ? i : acc), 0);
      const rows = keys.map((key, j) => ({ key, j, ...state(f, j) }));
      // geometry under the camera, clipped below the headline
      D.withClip(ctx, (c) => c.rect(F.full.x, area.y - gap * 0.5, F.full.w, F.full.h - area.y + gap * 0.5), () => {
        ctx.save(); cam.apply(ctx);
        const p = kNow === 0 ? 1 : M.clamp(M.sp(sinceK(f, kNow), TYPE)), off = yrCap * 1.25, yb = S.y + S.h, yx = S.x + S.w;
        const ghost = theme.mix('bg', 'fg', 0.14);
        D.withClip(ctx, (c) => c.rect(F.full.x, yb - yrCap - yrSize * 0.03, F.full.w, yrCap + yrSize * 0.06), () => {
          if (kNow > 0 && p < 0.999) T.drawText(ctx, theme, String(frames[kNow - 1].label), yx, yb - p * off, { role: 'display', size: yrSize, align: 'r', color: ghost, log: false });
          T.drawText(ctx, theme, String(frames[kNow].label), yx, yb + (1 - p) * off, { role: 'display', size: yrSize, align: 'r', color: ghost, log: false });
        });
        rows.forEach((r) => {
          r.col = r.j === hi ? theme.mix('fg', 'accent', hp) : hi !== undefined ? theme.mix('fg', 'muted', hp * 0.6) : 'fg';
          const rr = r.j === hk && rq > 0 ? collapse(rectOf(r.pos, r.v, mx), rq) : rectOf(r.pos, r.v, mx);
          D.fillBox(ctx, rr, r.col, r.j === hk && rq > 0 ? rr.h / 2 : Math.min(barH * 0.18, theme.radius * 0.3));
        });
        ctx.restore();
      });
      // labels in screen space: names stick inside the visible bar, values ride the heads; hidden when off the safe area
      rows.forEach((r) => {
        const sr = cam.rect(rectOf(r.pos, r.v, mx)), mid = sr.y + sr.h / 2 + labSize * 0.36;
        if (mid - labSize * 0.75 < area.y || mid > S.y + S.h) return;
        const head = sr.x + sr.w, nw = T.measure(ctx, theme, 'ui', r.key, labSize, 700).w;
        const vTxt = fmt(r.v, o), vw = T.measure(ctx, theme, 'ui', vTxt, valSize, 700).w;
        // a head pushed past the safe edge (camera push) carries its value inside the bar, in the bar's ink
        const pushed = head + labSize * 0.4 + vw > S.x + S.w;
        const vx = pushed ? Math.min(head, S.x + S.w) - pad - vw : head + labSize * 0.4;
        const inside = head - S.x >= nw + pad * 2 && (!pushed || vx - pad >= S.x + pad + nw) && !(r.j === hk && rq > 0);
        if (inside) T.drawText(ctx, theme, r.key, S.x + pad, mid, { role: 'ui', size: labSize, weight: 700, color: 'bg' });
        T.drawText(ctx, theme, vTxt, vx, mid, { role: 'ui', size: valSize, weight: 700, color: pushed ? 'bg' : r.j === hi ? theme.mix('fg', 'accent', hp) : 'fg' });
        if (!inside && !pushed && !(r.j === hk && rq > 0) && vx + vw + pad + nw <= S.x + S.w) T.drawText(ctx, theme, r.key, vx + vw + pad, mid, { role: 'ui', size: labSize, color: 'muted' });
      });
      if (chip) pill(api, f, chip, endTxt, cSize, endAt);
    } };
}

/**
 * A line that draws itself, filmed: the claim sits under the chart (bottom left), the zero baseline is the bar that
 * was carried across the cut, then the camera zooms in on the pen tip and tracks it while each annotation pops as
 * the tip reaches its point; on the landing the camera pulls out to the whole year and a delta pill lands.
 */
export function lineChart(api, pt, fmt, path, prev) {
  const { F, ctx, theme, T, M, D, C } = api;
  const S = F.safe;
  const data = pt.data || [];
  need(data.length >= 3 && data.every((d) => typeof d.y === 'number'), path, 'line needs data:[{x, y}] (3-24 points)');
  const o = numOpts(pt), n = data.length, ys = data.map((d) => d.y);
  const cBox = { x: S.x, y: S.y + S.h * (1 - F.pick({ v: 0.19, s: 0.2, h: 0.22 })), w: S.w * F.pick({ v: 1, s: 0.9, h: 0.62 }), h: S.h * F.pick({ v: 0.19, s: 0.2, h: 0.22 }) };
  const claim = claimBlock(api, pt, cBox, { scale: F.pick({ v: 2.0, s: 2.0, h: 2.3 }), valign: 'b' }); // no morph crosses it (the camera carries the dot), so it is set on the cut
  const first = data[0].y, lastY = data[n - 1].y;
  const dTxt = first ? `${lastY >= first ? '+' : ''}${fmt((lastY / first - 1) * 100, { fmt: 'pct' })} since ${data[0].x ?? 'start'}` : '';
  const dSize = T.readable(F, 1.0), gap = T.readable(F, 0.8);
  const dBox = dTxt ? pillBox(api, dTxt, dSize, S.x, claim.box.y - gap - dSize * 1.05) : null;
  const box = { x: S.x, y: S.y, w: S.w, h: (dBox ? dBox.y : claim.box.y) - gap - S.y };
  const ticks = C.niceTicks(pt.zero === false ? Math.min(...ys) : Math.min(0, ...ys), Math.max(...ys), 4);
  const tk = T.readable(F, 1.0), tipSize = T.readable(F, 1.25);
  const yLabW = Math.max(...ticks.map((t) => T.measure(ctx, theme, 'ui', fmt(t, o), tk).w)) + tk * 0.7;
  const band = tipSize * 1.6;
  const plot = { x: box.x + yLabW, y: box.y + band, w: box.w - yLabW - tk * 0.5, h: box.h - band - tk * 2.2 };
  const sx = (i) => plot.x + (i / (n - 1)) * plot.w;
  const sy = C.scaleLinear([ticks[0], ticks[ticks.length - 1]], [plot.y + plot.h, plot.y]);
  const pts = data.map((d, i) => [sx(i), sy(d.y)]);
  const yAt = (x) => { const u = M.clamp((x - plot.x) / plot.w) * (n - 1), i = Math.min(n - 2, Math.floor(u)); return pts[i][1] + (pts[i + 1][1] - pts[i][1]) * (u - i); };
  const span = (x0, x1) => { const ys2 = [yAt(x0), yAt(x1), ...pts.filter(([x]) => x >= x0 && x <= x1).map(([, y]) => y)]; return [Math.min(...ys2), Math.max(...ys2)]; };
  const xw = Math.max(...data.map((d) => T.measure(ctx, theme, 'ui', String(d.x ?? ''), tk).w));
  const strideFor = (z) => { const min = Math.max(1, Math.ceil((xw + tk * 1.2) / (plot.w * z / (n - 1)))); return (n % 3 === 0 ? [1, 3, 6, 12] : [1, 2, 4, 8, 12]).concat([n]).find((st) => st >= min) || n; };
  // the line never redraws from zero: on the cut it is already drawn to its third point and the pen is moving
  const drawBeats = pt.drawBeats || 4, start = 0, done = start + drawBeats, p0 = Math.min(2, n - 2) / (n - 1);
  const spr = smooth(drawBeats * api.grid.spb);
  const reach = (i) => { const q = (i / (n - 1) - p0) / (1 - p0); if (q <= 0) return 0; let lo = 0, hi = drawBeats * api.grid.spb * 2; for (let s = 0; s < 40; s++) { const m = (lo + hi) / 2; if (M.sp(m, spr) < q) lo = m; else hi = m; } return Math.max(0.5, Math.ceil((start + hi / api.grid.spb) * 4) / 4); }; // points already drawn on the cut pop at once
  const placed = [], leaders = [];
  const clear = tipSize * 2.1;
  const anns = (pt.annotations || []).map((a, ai) => {
    const i = typeof a.at === 'number' ? a.at : data.findIndex((d) => d.x === a.at);
    need(i >= 0 && i < n, `${path}.annotations[${ai}]`, `at ${JSON.stringify(a.at)} is not a data index or x label`);
    return { a, i };
  });
  const order = anns.map((_, k) => k).sort((p1, p2) => pts[anns[p1].i][1] - pts[anns[p2].i][1] || p1 - p2);
  const notes = [];
  order.forEach((k) => { notes[k] = placeAt(anns[k], clear) || placeAt(anns[k], tipSize * 0.9) || placeAt(anns[k], tipSize * 0.9, true); });
  function placeAt({ a, i }, clr, force = false) {
    const fit = T.fitText(ctx, theme, a.text, { role: 'ui', lines: 'auto', leading: 1.2, max: T.readable(F, 1.0), min: T.readable(F), weight: 700,
      box: { x: 0, y: 0, w: Math.min(plot.w * F.pick({ v: 0.5, s: 0.42, h: 0.36 }), T.readable(F) * 10), h: T.readable(F) * 3.8 } });
    const pd = fit.size * 0.55, cw = fit.box.w + pd * 2, ch = fit.box.h + pd * 2, [px] = pts[i];
    const xMin = plot.x, xMax = box.x + box.w - cw;
    const hits = (c) => placed.some((b) => c.x < b.x + b.w + tk * 0.5 && b.x < c.x + c.w + tk * 0.5 && c.y < b.y + b.h + tk * 0.3 && b.y < c.y + c.h + tk * 0.3)
      || leaders.some((l) => l.x > c.x - tk * 0.3 && l.x < c.x + c.w + tk * 0.3 && c.y < l.y1 && c.y + c.h > l.y0);
    let best = null;
    const below = tk * 1.1, floor = plot.y + plot.h - tk * 0.4, m = Math.min(ch * 0.5, cw * 0.2), stepY = ch * 0.5;
    const crosses = (y0, y1) => placed.some((b) => px > b.x - tk * 0.3 && px < b.x + b.w + tk * 0.3 && Math.max(y0, y1) > b.y && Math.min(y0, y1) < b.y + b.h);
    for (let s = 0; s <= 20; s++) {
      const cx = M.clamp(px - cw / 2 + (s % 2 ? -1 : 1) * Math.ceil(s / 2) * cw * 0.1, Math.max(xMin, px - cw + m), Math.min(xMax, px - m));
      const [top, bot] = span(cx - tk * 0.5, cx + cw + tk * 0.5);
      const py = pts[i][1];
      for (let y = Math.min(top, py) - clr - ch, k = 0; y >= box.y && k < 12; y -= stepY, k++) {
        const c = { x: cx, y, w: cw, h: ch };
        if (hits(c) || crosses(y + ch, py)) continue;
        const cost = Math.abs(cx + cw / 2 - px) * 0.3 + (py - y - ch);
        if (!best || cost < best.cost) best = { c, cost };
        break;
      }
      for (let y = Math.max(bot, py) + below, k = 0; y + ch <= floor && k < 12; y += stepY, k++) {
        const c = { x: cx, y, w: cw, h: ch };
        if (hits(c) || crosses(py, y)) continue;
        const cost = Math.abs(cx + cw / 2 - px) * 0.3 + (y - py) + cw * 0.3;
        if (!best || cost < best.cost) best = { c, cost };
        break;
      }
    }
    if (!best && !force) return null;
    const chip = best ? best.c : { x: M.clamp(px - cw / 2, xMin, xMax), y: box.y, w: cw, h: ch };
    placed.push(chip);
    const anchor = [M.clamp(px, chip.x + ch * 0.4, chip.x + chip.w - ch * 0.4), chip.y > pts[i][1] ? chip.y : chip.y + chip.h];
    leaders.push({ x: px, y0: Math.min(pts[i][1], anchor[1]), y1: Math.max(pts[i][1], anchor[1]) });
    return { i, fit, pad: pd, chip, at: reach(i), anchor };
  }
  const pillAt = done + 1;
  const beats = Math.max(8, Math.ceil(Math.max(pillAt, ...notes.map((a) => a.at)) + 2));
  const events = [start, ...notes.map((a) => a.at), done, ...(dBox ? [pillAt] : [])].sort((a, b) => a - b);
  const sfx = [{ at: start, sfx: 'swish', gain_db: -12 }, ...notes.map((a) => ({ at: a.at, sfx: 'pop', gain_db: -7 })), { at: done, sfx: 'thump', gain_db: -4 },
    ...(dBox ? [{ at: pillAt, sfx: 'pop', gain_db: -6 }] : [])];
  const endsHigh = lastY >= Math.max(...ys);
  const tipOf = (p) => { const seg = Math.min(n - 2, Math.floor(p * (n - 1))), q = p * (n - 1) - seg; return { seg, q, xy: [plot.x + p * plot.w, pts[seg][1] + (pts[seg + 1][1] - pts[seg][1]) * q] }; };
  const target = [plot.x + plot.w * 0.55, plot.y + plot.h * 0.5];
  const progress = (f) => p0 + (1 - p0) * M.clamp(M.sp(f.since(start), spr));
  // camera: pushed in on the pen from the first frame, with the pen tip on screen exactly where the carried dot was
  // (prev disc centre), drifting to the framing target, then pulling out to the whole series on the landing
  const pIn = prev && prev.kind === 'disc' ? [prev.cx, prev.cy] : target;
  const drift = (f) => M.clamp(M.sp(f.since(0), smooth(1.6 * api.grid.spb)));
  const camAt = (f) => { const m = drift(f); return camera(tipOf(progress(f)).xy, [pIn[0] + (target[0] - pIn[0]) * m, pIn[1] + (target[1] - pIn[1]) * m],
    1 - M.clamp(M.sp(f.since(done), smooth(0.55))), F.pick({ v: 2.4, s: 2.2, h: 2.2 })); };
  const th = Math.max(8 * F.u, 6);
  const base = { x: plot.x, y: plot.y + plot.h - th / 2, w: plot.w, h: th };
  const penR = 12 * F.u, r0in = prev && prev.kind === 'disc' ? prev.r : penR, end = pts[n - 1];
  const view = { x: plot.x - tk * 0.2, y: box.y, w: plot.w + tk * 0.7, h: plot.y + plot.h + th - box.y };
  return { beats, events, sfx, handOut: { kind: 'disc', cx: end[0], cy: end[1], r: penR },
    draw(f) {
      claim.draw(f);
      const p = progress(f), cam = camAt(f), tip = tipOf(p);
      D.withClip(ctx, (c) => c.rect(view.x, view.y, view.w, view.h), () => {
        ctx.save(); cam.apply(ctx);
        ticks.forEach((t) => D.fillBox(ctx, { x: plot.x, y: sy(t) - F.u, w: plot.w, h: 2 * F.u }, 'surface'));
        {
          const part = [...pts.slice(0, tip.seg + 1), tip.xy];
          D.fillPoly(ctx, [...part, [tip.xy[0], plot.y + plot.h], [plot.x, plot.y + plot.h]], 'surface');
          D.line(ctx, part, { color: 'accent', width: 7 * F.u / Math.sqrt(cam.z) });
        }
        D.fillBox(ctx, base, 'muted');
        ctx.restore();
      });
      // screen-space labels: y ticks follow the zoom, month labels thin out as it pulls back
      ticks.forEach((t) => {
        const Y = cam.pt(plot.x, sy(t))[1];
        if (Y > box.y + tk && Y < plot.y + plot.h + 2) T.drawText(ctx, theme, fmt(t, o), plot.x - tk * 0.5, Y + tk * 0.36, { role: 'ui', size: tk, align: 'r', color: 'muted' });
      });
      const stride = strideFor(cam.z);
      data.forEach((d, i) => {
        if (i % stride) return;
        const s = String(d.x ?? ''), w = T.measure(ctx, theme, 'ui', s, tk).w, X = cam.pt(pts[i][0], 0)[0];
        if (X < plot.x - 1 || X > plot.x + plot.w + 1) return;
        T.drawText(ctx, theme, s, M.clamp(X, plot.x + w / 2, Math.min(S.x + S.w, plot.x + plot.w + tk * 0.5) - w / 2), plot.y + plot.h + tk * 1.6, { role: 'ui', size: tk, align: 'c', color: 'muted' });
      });
      const P = cam.pt(...tip.xy);
      D.disc(ctx, P[0], P[1], r0in + (penR - r0in) * M.clamp(M.sp(f.since(0), smooth(0.35))), 'accent');
      for (const a of notes) {
        const hp = M.sp(f.since(a.at), UI), P2 = cam.pt(...pts[a.i]);
        if (hp <= 0 || P2[0] < view.x || P2[0] > view.x + view.w || P2[1] < view.y || P2[1] > view.y + view.h) continue;
        const A0 = cam.pt(...a.anchor), c0 = a.chip;
        const cx = M.clamp(A0[0] + c0.x - a.anchor[0], S.x, S.x + S.w - c0.w), cy = M.clamp(A0[1] + c0.y - a.anchor[1], box.y, plot.y + plot.h - c0.h);
        const c = { x: cx, y: cy, w: c0.w, h: c0.h }, A = [A0[0] + cx - (A0[0] + c0.x - a.anchor[0]), A0[1] + cy - (A0[1] + c0.y - a.anchor[1])];
        D.line(ctx, [P2, A], { color: 'fg', width: 3 * F.u, progress: M.clamp(hp), cap: 'butt' });
        D.disc(ctx, P2[0], P2[1], 11 * F.u * M.clamp(hp, 0, 1.1), 'fg');
        const at2 = a.at + 0.25;
        if (f.since(at2) <= 0) continue;
        const g = M.clamp(M.sp(f.since(at2), UI), 0, 1.02);
        ctx.save(); ctx.translate(A[0], A[1]); ctx.scale(g, g); ctx.translate(-A[0], -A[1]);
        D.fillBox(ctx, c, 'fg', Math.min(c.h / 2, theme.radius * 0.5));
        a.fit.lines.forEach((l) => T.drawText(ctx, theme, l.s, c.x + a.pad, c.y + a.pad + (l.y - a.fit.box.y), { role: 'ui', size: a.fit.size, weight: 700, color: 'bg', log: false }));
        ctx.restore();
        a.fit.lines.forEach((l) => T.logText(ctx, l.s, { x: c.x + a.pad, y: c.y + a.pad + (l.y - a.fit.box.y) - a.fit.cap, w: l.w, h: a.fit.cap }, a.fit.size, 'ui'));
      }
      const yv = data[tip.seg].y + (data[tip.seg + 1].y - data[tip.seg].y) * tip.q, txt = fmt(yv, o);
      const tw = T.measure(ctx, theme, 'ui', txt, tipSize, 700).w, lp = M.clamp(M.sp(f.since(done), UI));
      const tx = M.clamp(P[0], S.x + tw / 2, S.x + S.w - tw / 2), ty = M.clamp(P[1] - tipSize * 0.75, box.y + tipSize, plot.y + plot.h);
      T.drawText(ctx, theme, txt, tx, ty, { role: 'ui', size: tipSize, weight: 700, align: 'c', color: endsHigh ? theme.mix('fg', 'accent', lp) : 'fg' });
      if (dBox) pill(api, f, dBox, dTxt, dSize, pillAt);
    } };
}
